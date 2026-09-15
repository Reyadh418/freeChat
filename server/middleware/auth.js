import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

export const DEFAULT_DEV_JWT_SECRET = 'freechat_dev_fallback_secret_key_change_in_prod';

/**
 * Validates JWT configuration. In production environments, using an empty
 * or default dev secret key is strictly prohibited to prevent token forgery.
 */
export function validateJwtSecretConfig(secret = process.env.JWT_SECRET, env = process.env.NODE_ENV) {
  const effectiveSecret = secret || DEFAULT_DEV_JWT_SECRET;
  if (env === 'production') {
    if (!secret || secret === DEFAULT_DEV_JWT_SECRET || secret.length < 32) {
      throw new Error('[FATAL SECURITY ERROR] Insecure or missing JWT_SECRET in production mode! Set a strong random secret with at least 32 characters in process.env.JWT_SECRET.');
    }
  }
  return effectiveSecret;
}

export const JWT_SECRET = validateJwtSecretConfig();

/**
 * Generate a signed JWT for an authenticated user.
 */
export function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Express middleware to authenticate requests via Bearer token.
 */
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please provide a valid Bearer token.' });
  }

  const token = authHeader.substring(7).trim();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.id,
      username: decoded.username
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session token expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }
}

