import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { db } from './config/db.js';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './middleware/auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static assets
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);

// Health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db_mode: db.isSupabase ? 'supabase_cloud' : 'local_sqlite'
  });
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Realtime
const onlineUsers = new Map();

// Socket.IO Handshake Authentication Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || 
    (socket.handshake.headers?.authorization?.startsWith('Bearer ') 
      ? socket.handshake.headers.authorization.substring(7) 
      : null);

  if (!token) {
    return next(new Error('Authentication error: Token required.'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = {
      id: decoded.id,
      username: decoded.username
    };
    next();
  } catch (err) {
    return next(new Error('Authentication error: Invalid or expired token.'));
  }
});

io.on('connection', (socket) => {
  const authenticatedUserId = socket.user.id;

  // Automatically register presence for verified user
  if (!onlineUsers.has(authenticatedUserId)) {
    onlineUsers.set(authenticatedUserId, new Set());
  }
  onlineUsers.get(authenticatedUserId).add(socket.id);

  socket.join(`user:${authenticatedUserId}`);
  // Send current online users list to this user
  socket.emit('online_users_list', Array.from(onlineUsers.keys()));

  io.emit('user_status_change', {
    userId: authenticatedUserId,
    status: 'online',
    lastSeen: new Date().toISOString()
  });

  // Client-initiated sync (only allowed for authenticated user's own ID)
  socket.on('user_connected', () => {
    socket.emit('online_users_list', Array.from(onlineUsers.keys()));
  });

  // Room Authorization Check
  socket.on('join_conversation', async (conversationId, callback) => {
    if (!conversationId) return;

    try {
      const isParticipant = await db.isUserInConversation(conversationId, socket.user.id);
      if (!isParticipant) {
        if (typeof callback === 'function') {
          callback({ error: 'Access denied: not a participant of this conversation.' });
        }
        return;
      }

      socket.join(`conv:${conversationId}`);
      if (typeof callback === 'function') {
        callback({ success: true });
      }
    } catch (err) {
      console.error('[Socket Join Error]:', err);
      if (typeof callback === 'function') {
        callback({ error: 'Failed to join conversation.' });
      }
    }
  });

  socket.on('leave_conversation', (conversationId) => {
    if (!conversationId) return;
    socket.leave(`conv:${conversationId}`);
  });

  // Typing Indicators (enforce verified identity and participant check)
  socket.on('typing_start', async ({ conversationId }) => {
    if (!conversationId) return;
    try {
      const isParticipant = await db.isUserInConversation(conversationId, socket.user.id);
      if (!isParticipant) return;

      socket.to(`conv:${conversationId}`).emit('user_typing', {
        conversationId,
        userId: socket.user.id,
        username: socket.user.username,
        isTyping: true
      });
    } catch (err) {
      console.error('[Socket Typing Error]:', err);
    }
  });

  socket.on('typing_stop', async ({ conversationId }) => {
    if (!conversationId) return;
    try {
      const isParticipant = await db.isUserInConversation(conversationId, socket.user.id);
      if (!isParticipant) return;

      socket.to(`conv:${conversationId}`).emit('user_typing', {
        conversationId,
        userId: socket.user.id,
        username: socket.user.username,
        isTyping: false
      });
    } catch (err) {
      console.error('[Socket Typing Error]:', err);
    }
  });

  // Messages (enforce verified senderId and participant authorization)
  socket.on('send_message', async (messageData, callback) => {
    try {
      const { conversationId, ciphertext, iv, senderPublicKey, mediaUrl, mediaType } = messageData;
      const senderId = socket.user.id; // Enforce verified identity

      if (!conversationId || !ciphertext || !iv) {
        if (typeof callback === 'function') {
          callback({ error: 'Missing payload.' });
        }
        return;
      }

      const isParticipant = await db.isUserInConversation(conversationId, senderId);
      if (!isParticipant) {
        if (typeof callback === 'function') {
          callback({ error: 'Access denied: not a participant of this conversation.' });
        }
        return;
      }

      const savedMessage = await db.saveMessage({
        conversation_id: conversationId,
        sender_id: senderId,
        ciphertext,
        iv,
        sender_public_key: senderPublicKey,
        media_url: mediaUrl,
        media_type: mediaType
      });

      io.to(`conv:${conversationId}`).emit('new_message', savedMessage);

      const participants = await db.getConversationParticipants(conversationId);
      participants?.forEach((p) => {
        const participantId = p.user_id || p.id;
        if (participantId !== senderId) {
          io.to(`user:${participantId}`).emit('conversation_updated', {
            conversationId,
            lastMessage: savedMessage
          });
        }
      });

      if (typeof callback === 'function') {
        callback({ success: true, message: savedMessage });
      }
    } catch (err) {
      console.error('[Socket Error]:', err);
      if (typeof callback === 'function') {
        callback({ error: 'Failed to send message.' });
      }
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    if (authenticatedUserId && onlineUsers.has(authenticatedUserId)) {
      const userSockets = onlineUsers.get(authenticatedUserId);
      userSockets.delete(socket.id);

      if (userSockets.size === 0) {
        onlineUsers.delete(authenticatedUserId);
        await db.updateLastSeen(authenticatedUserId);

        io.emit('user_status_change', {
          userId: authenticatedUserId,
          status: 'offline',
          lastSeen: new Date().toISOString()
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
