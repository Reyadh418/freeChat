import express from 'express';
import crypto from 'crypto';
import { db } from '../config/db.js';
import { generateToken, authMiddleware, JWT_SECRET } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * Hashes client auth verifier server-side with HMAC-SHA256.
 * Ensures that even with database read access, an attacker cannot replay verifiers to log in.
 */
export function hashVerifierServerSide(clientVerifier) {
  return 'v2$' + crypto.createHmac('sha256', JWT_SECRET).update(clientVerifier).digest('base64');
}

/**
 * Timing-safe verifier validation supporting v2 HMAC and v1 legacy fallback.
 */
export function verifyAuthVerifier(storedVerifier, clientVerifier) {
  if (!storedVerifier || !clientVerifier) return false;

  try {
    if (storedVerifier.startsWith('v2$')) {
      const expected = hashVerifierServerSide(clientVerifier);
      const bufA = Buffer.from(storedVerifier, 'utf8');
      const bufB = Buffer.from(expected, 'utf8');
      return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    }

    // Legacy v1 comparison
    const bufA = Buffer.from(storedVerifier, 'utf8');
    const bufB = Buffer.from(clientVerifier, 'utf8');
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// Register
router.post('/register', authLimiter.middleware(), async (req, res) => {
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

    // Server-side HMAC protection for stored auth verifiers
    const serverHashedVerifier = hashVerifierServerSide(auth_verifier);

    const user = await db.createUser({
      username: cleanUsername,
      auth_verifier: serverHashedVerifier,
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

// Pre-login (Returns only public key derivation salt; zero key exposure & anti-enumeration)
router.post('/pre-login', authLimiter.middleware(), async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const user = await db.getUserByUsername(cleanUsername);

    if (!user) {
      // Anti-enumeration: Return a deterministic pseudorandom 16-byte salt for non-existent users
      // This ensures identical HTTP status (200 OK) and response timing, preventing username enumeration.
      const fakeSalt = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`fake-salt:${cleanUsername}`)
        .digest()
        .subarray(0, 16)
        .toString('base64');

      return res.json({ salt: fakeSalt, v: 2 });
    }

    // Never return encrypted_priv_key or iv to unauthenticated callers!
    // Encrypted private keys are only returned within authorized /login response.
    res.json({
      salt: user.salt,
      v: user.auth_verifier?.startsWith('v2$') ? 2 : 1
    });
  } catch (err) {
    console.error('[Auth Error]:', err);
    res.status(500).json({ error: 'Failed to fetch login parameters.' });
  }
});

// Login
router.post('/login', authLimiter.middleware(), async (req, res) => {
  try {
    const { username, auth_verifier } = req.body;
    if (!username || !auth_verifier) {
      return res.status(400).json({ error: 'Username and auth verifier are required.' });
    }

    const user = await db.getUserByUsername(username.trim().toLowerCase());
    if (!user || !verifyAuthVerifier(user.auth_verifier, auth_verifier)) {
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

// Profile (Authenticated users only)
router.get('/user/:username', authMiddleware, async (req, res) => {
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
