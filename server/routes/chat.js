import express from 'express';
import { db } from '../config/db.js';

const router = express.Router();

// Search users
router.get('/users/search', async (req, res) => {
  try {
    const { q, exclude } = req.query;
    if (!q || q.trim().length < 1) {
      return res.json([]);
    }

    const users = await db.searchUsers(q.trim(), exclude || null);
    res.json(users);
  } catch (err) {
    console.error('[Chat Error]:', err);
    res.status(500).json({ error: 'Failed to search users.' });
  }
});

// Conversations
router.get('/conversations', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required.' });
    }

    const conversations = await db.getUserConversations(userId);
    res.json(conversations);
  } catch (err) {
    console.error('[Chat Error]:', err);
    res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

// Direct chat
router.post('/conversations/direct', async (req, res) => {
  try {
    const { currentUserId, targetUsername } = req.body;
    if (!currentUserId || !targetUsername) {
      return res.status(400).json({ error: 'Current user ID and target username are required.' });
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

// Messages
router.get('/conversations/:convId/messages', async (req, res) => {
  try {
    const { convId } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    const messages = await db.getConversationMessages(convId, limit);
    res.json(messages);
  } catch (err) {
    console.error('[Chat Error]:', err);
    res.status(500).json({ error: 'Failed to load messages.' });
  }
});

export default router;
