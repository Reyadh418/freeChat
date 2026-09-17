import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { db, waitForPendingWrites } from './config/db.js';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './middleware/auth.js';
import { securityHeadersMiddleware, corsOptions, isOriginAllowed } from './middleware/security.js';
import { apiLimiter, socketHandshakeLimiter, socketMessageLimiter, socketTypingLimiter } from './middleware/rateLimiter.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');

// Trust proxy for production environments (Render, Cloudflare, Railway, Nginx)
if (isProd || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  maxHttpBufferSize: 256 * 1024, // 256KB max WebSocket frame to prevent memory exhaustion
  cors: (req, callback) => {
    const origin = req.headers ? req.headers.origin : null;
    const host = req.headers ? (req.headers['x-forwarded-host'] || req.headers.host) : null;
    if (isOriginAllowed(origin, host)) {
      callback(null, {
        origin: true,
        methods: ['GET', 'POST'],
        credentials: true
      });
    } else {
      callback(new Error('CORS policy: Socket connection denied for this origin.'));
    }
  }
});

let isShuttingDown = false;

// Reject new incoming HTTP requests during graceful shutdown draining
app.use((req, res, next) => {
  if (isShuttingDown) {
    res.setHeader('Connection', 'close');
    return res.status(503).json({ error: 'Server is undergoing graceful shutdown.' });
  }
  next();
});

// Middleware
app.use(securityHeadersMiddleware);
app.use(cors(corsOptions));
app.use(compression({
  threshold: 1024 // Only compress responses > 1KB
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Global API rate limiting
app.use('/api', apiLimiter.middleware());

// Static assets with caching headers & immediate HTML/SW revalidation
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath, {
  maxAge: isProd ? '1d' : 0,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // HTML and Service Worker should always be revalidated for immediate update rollout
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);

// Health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db_mode: db.isSupabase ? 'supabase_cloud' : 'local_sqlite',
    uptime: Math.floor(process.uptime()),
    node_env: process.env.NODE_ENV || 'development'
  });
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Central Express error handler (prevents stack trace leakage in production)
app.use((err, req, res, next) => {
  console.error('[Unhandled Express Error]:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    error: isProd ? 'Internal Server Error' : (err.message || 'Internal Server Error')
  });
});

// Realtime
const onlineUsers = new Map();

// Socket.IO Handshake Authentication Middleware
io.use((socket, next) => {
  // Handshake connection rate limiting
  const handshakeLimit = socketHandshakeLimiter.check(socket);
  if (!handshakeLimit.allowed) {
    return next(new Error('Rate limit exceeded: Too many socket connections.'));
  }

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

  // Typing Indicators (enforce verified identity, rate limits, and participant check)
  socket.on('typing_start', async ({ conversationId }) => {
    if (!conversationId) return;
    try {
      const typingLimit = socketTypingLimiter.check(socket.id);
      if (!typingLimit.allowed) return;

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

  // Messages (enforce verified senderId, payload bounds, and participant authorization)
  socket.on('send_message', async (messageData, callback) => {
    try {
      if (!messageData || typeof messageData !== 'object') {
        if (typeof callback === 'function') {
          callback({ error: 'Invalid payload structure.' });
        }
        return;
      }

      // Message emission rate limiting per socket
      const msgLimit = socketMessageLimiter.check(socket.id);
      if (!msgLimit.allowed) {
        if (typeof callback === 'function') {
          callback({ error: 'Rate limit exceeded: You are sending messages too fast. Please slow down.' });
        }
        return;
      }

      const { conversationId, ciphertext, iv, senderPublicKey, mediaUrl, mediaType } = messageData;
      const senderId = socket.user.id; // Enforce verified identity

      // Strict type and size bounds to prevent memory bloat and injection attacks
      if (
        typeof conversationId !== 'string' ||
        conversationId.length < 1 ||
        conversationId.length > 128 ||
        typeof ciphertext !== 'string' ||
        ciphertext.length < 1 ||
        ciphertext.length > 131072 || // Max 128KB ciphertext
        typeof iv !== 'string' ||
        iv.length < 1 ||
        iv.length > 64
      ) {
        if (typeof callback === 'function') {
          callback({ error: 'Invalid message payload format or payload exceeds maximum allowed size.' });
        }
        return;
      }

      if (senderPublicKey && (typeof senderPublicKey !== 'string' || senderPublicKey.length > 2048)) {
        if (typeof callback === 'function') {
          callback({ error: 'Invalid senderPublicKey: must be string under 2KB.' });
        }
        return;
      }

      if (mediaUrl) {
        // Enforce strictly http or https schemes (preventing javascript: or data: script injection)
        if (typeof mediaUrl !== 'string' || mediaUrl.length > 2048 || !/^https?:\/\/[^\s$.?#].[^\s]*$/i.test(mediaUrl)) {
          if (typeof callback === 'function') {
            callback({ error: 'Invalid mediaUrl: must be a valid HTTP or HTTPS URL under 2KB.' });
          }
          return;
        }
      }

      if (mediaType && (typeof mediaType !== 'string' || mediaType.length > 64)) {
        if (typeof callback === 'function') {
          callback({ error: 'Invalid mediaType format.' });
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

// Graceful Shutdown Handlers (Render, Kubernetes, Docker, Railway, Fly.io)
async function handleGracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

  // Force exit fallback timeout after 10s if sockets or connections fail to drain
  const forceExitTimeout = setTimeout(() => {
    console.error('[Server] Forceful shutdown: pending operations timed out.');
    process.exit(1);
  }, 10000);
  if (forceExitTimeout.unref) forceExitTimeout.unref();

  try {
    // 1. Notify connected Socket.IO clients of server restart/shutdown
    io.emit('server_shutdown', { message: 'Server is restarting or shutting down.' });
    await new Promise((resolve) => io.close(resolve));
    console.log('[Server] Socket.IO server closed.');

    // 2. Stop accepting new HTTP requests and close server
    await new Promise((resolve) => server.close(resolve));
    console.log('[Server] HTTP server closed.');

    // 3. Flush any pending serialized write operations to disk
    await waitForPendingWrites();
    console.log('[Server] Pending database operations flushed.');

    console.log('[Server] Graceful shutdown completed cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('[Server] Error during graceful shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
  handleGracefulShutdown('uncaughtException');
});
