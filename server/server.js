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

io.on('connection', (socket) => {
  let authenticatedUserId = null;

  // Presence
  socket.on('user_connected', (userId) => {
    if (!userId) return;
    authenticatedUserId = userId;

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    socket.join(`user:${userId}`);

    io.emit('user_status_change', {
      userId,
      status: 'online',
      lastSeen: new Date().toISOString()
    });
  });

  // Room
  socket.on('join_conversation', (conversationId) => {
    if (!conversationId) return;
    socket.join(`conv:${conversationId}`);
  });

  socket.on('leave_conversation', (conversationId) => {
    if (!conversationId) return;
    socket.leave(`conv:${conversationId}`);
  });

  // Typing
  socket.on('typing_start', ({ conversationId, userId, username }) => {
    socket.to(`conv:${conversationId}`).emit('user_typing', {
      conversationId,
      userId,
      username,
      isTyping: true
    });
  });

  socket.on('typing_stop', ({ conversationId, userId, username }) => {
    socket.to(`conv:${conversationId}`).emit('user_typing', {
      conversationId,
      userId,
      username,
      isTyping: false
    });
  });

  // Messages
  socket.on('send_message', async (messageData, callback) => {
    try {
      const { conversationId, senderId, ciphertext, iv, senderPublicKey, mediaUrl, mediaType } = messageData;

      if (!conversationId || !senderId || !ciphertext || !iv) {
        if (typeof callback === 'function') {
          callback({ error: 'Missing payload.' });
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
