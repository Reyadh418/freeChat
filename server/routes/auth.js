import express from 'express';
import { db } from '../config/db.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, auth_verifier, public_key, encrypted_priv_key, salt, iv, avatar_color } = req.body;

    if (!username || !auth_verifier || !public_key || !encrypted_priv_key || !salt || !iv) {
      return res.status(400).json({ error: 'Missing registration fields.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username must be 3-30 characters long and contain only letters, numbers, underscores, dashes, or dots.' });
    }

    const existingUser = await db.getUserByUsername(cleanUsername);
    if (existingUser) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const user = await db.createUser({
      username: cleanUsername,
      auth_verifier,
      public_key,
      encrypted_priv_key,
      salt,
      iv,
      avatar_color
    });

    const token = generateToken(user);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        public_key: user.public_key,
        avatar_color: user.avatar_color,
        encrypted_priv_key: user.encrypted_priv_key,
        salt: user.salt,
        iv: user.iv
      }
    });
  } catch (err) {
    console.error('[Auth Error]:', err);
    res.status(500).json({ error: 'Failed to register account.' });
  }
});

// Pre-login
router.post('/pre-login', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const user = await db.getUserByUsername(username.trim().toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }

    res.json({
      salt: user.salt,
      iv: user.iv,
      encrypted_priv_key: user.encrypted_priv_key
    });
  } catch (err) {
    console.error('[Auth Error]:', err);
    res.status(500).json({ error: 'Failed to fetch login parameters.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, auth_verifier } = req.body;
    if (!username || !auth_verifier) {
      return res.status(400).json({ error: 'Username and auth verifier are required.' });
    }

    const user = await db.getUserByUsername(username.trim().toLowerCase());
    if (!user || user.auth_verifier !== auth_verifier) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    await db.updateLastSeen(user.id);

    const token = generateToken(user);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        public_key: user.public_key,
        avatar_color: user.avatar_color,
        status_message: user.status_message,
        encrypted_priv_key: user.encrypted_priv_key,
        salt: user.salt,
        iv: user.iv
      }
    });
  } catch (err) {
    console.error('[Auth Error]:', err);
    res.status(500).json({ error: 'Failed to log in.' });
  }
});

// Current Authenticated User Session Verification
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        public_key: user.public_key,
        avatar_color: user.avatar_color,
        status_message: user.status_message,
        last_seen: user.last_seen,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('[Auth Error]:', err);
    res.status(500).json({ error: 'Failed to verify session.' });
  }
});

// Profile
router.get('/user/:username', async (req, res) => {
  try {
    const user = await db.getUserByUsername(req.params.username.trim().toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      id: user.id,
      username: user.username,
      public_key: user.public_key,
      avatar_color: user.avatar_color,
      status_message: user.status_message,
      last_seen: user.last_seen
    });
  } catch (err) {
    console.error('[Auth Error]:', err);
    res.status(500).json({ error: 'Failed to fetch user profile.' });
  }
});

export default router;
