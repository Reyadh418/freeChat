import express from 'express';
import { db } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { searchLimiter, convLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Require authentication for all chat routes
router.use(authMiddleware);

// Search users
router.get('/users/search', searchLimiter.middleware(), async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1) {
      return res.json([]);
    }

    // Exclude the authenticated requesting user
    const users = await db.searchUsers(q.trim(), req.user.id);
    res.json(users);
  } catch (err) {
    console.error('[Chat Error]:', err);
    res.status(500).json({ error: 'Failed to search users.' });
  }
});

// Conversations (scoped strictly to authenticated user)
router.get('/conversations', async (req, res) => {
  try {
    const userId = req.user.id;
    const conversations = await db.getUserConversations(userId);
    res.json(conversations);
  } catch (err) {
    console.error('[Chat Error]:', err);
    res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

// Direct chat (initiator is always authenticated user, rate-limited against flooding)
router.post('/conversations/direct', convLimiter.middleware(), async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { targetUsername } = req.body;
    if (!targetUsername) {
      return res.status(400).json({ error: 'Target username is required.' });
    }

    const targetUser = await db.getUserByUsername(targetUsername.trim().toLowerCase());
    if (!targetUser) {
      return res.status(404).json({ error: `User "${targetUsername}" not found.` });
    }

    if (targetUser.id === currentUserId) {
      return res.status(400).json({ error: 'Cannot start a conversation with yourself.' });
    }

    let conv = await db.findDirectConversation(currentUserId, targetUser.id);
    if (!conv) {
      conv = await db.createConversation({
        type: 'direct',
        created_by: currentUserId,
        participantIds: [currentUserId, targetUser.id]
      });
    }

    const participants = await db.getConversationParticipants(conv.id);

    res.json({
      ...conv,
      conversation_participants: participants,
      targetUser: {
        id: targetUser.id,
        username: targetUser.username,
        public_key: targetUser.public_key,
        avatar_color: targetUser.avatar_color,
        status_message: targetUser.status_message,
        last_seen: targetUser.last_seen
      }
    });
  } catch (err) {
    console.error('[Chat Error]:', err);
    res.status(500).json({ error: 'Failed to create conversation.' });
  }
});

// Messages (authorized participants only - IDOR / BOLA defense)
router.get('/conversations/:convId/messages', async (req, res) => {
  try {
    const { convId } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    // Verify requesting user is a legitimate participant
    const isParticipant = await db.isUserInConversation(convId, req.user.id);
    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied. You are not a participant in this conversation.' });
    }

    const messages = await db.getConversationMessages(convId, limit);
    res.json(messages);
  } catch (err) {
    console.error('[Chat Error]:', err);
    res.status(500).json({ error: 'Failed to load messages.' });
  }
});

export default router;

