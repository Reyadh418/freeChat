/**
 * Zero-Dependency Sliding-Window Rate Limiter for Express & Socket.IO
 */

import net from 'net';

export class SlidingWindowRateLimiter {
  constructor({ windowMs = 60000, max = 60, message = 'Too many requests.', keyGenerator = null }) {
    this.windowMs = windowMs;
    this.max = max;
    this.message = message;
    this.keyGenerator = keyGenerator || ((req) => getClientIp(req));
    this.hits = new Map();

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, timestamps] of this.hits.entries()) {
        const valid = timestamps.filter(t => now - t < this.windowMs);
        if (valid.length === 0) {
          this.hits.delete(key);
        } else {
          this.hits.set(key, valid);
        }
      }
    }, Math.min(this.windowMs, 60000));

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  check(key) {
    const now = Date.now();
    let timestamps = this.hits.get(key) || [];
    timestamps = timestamps.filter(t => now - t < this.windowMs);

    const isBlocked = timestamps.length >= this.max;
    const oldest = timestamps[0] || now;
    const resetTimeMs = oldest + this.windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetTimeMs - now) / 1000));
    const remaining = Math.max(0, this.max - timestamps.length);

    if (!isBlocked) {
      timestamps.push(now);
      this.hits.set(key, timestamps);
    }

    return {
      allowed: !isBlocked,
      total: this.max,
      remaining: isBlocked ? 0 : remaining - 1,
      resetTimeMs,
      retryAfterSeconds
    };
  }

  middleware() {
    return (req, res, next) => {
      const key = this.keyGenerator(req);
      const result = this.check(key);

      if (typeof res.setHeader === 'function') {
        res.setHeader('RateLimit-Limit', result.total);
        res.setHeader('RateLimit-Remaining', result.remaining);
        res.setHeader('RateLimit-Reset', Math.ceil(result.resetTimeMs / 1000));
      }

      if (!result.allowed) {
        if (typeof res.setHeader === 'function') {
          res.setHeader('Retry-After', result.retryAfterSeconds);
        }
        return res.status(429).json({
          error: typeof this.message === 'function' ? this.message(req) : this.message,
          retryAfter: result.retryAfterSeconds
        });
      }

      next();
    };
  }

  reset(key) {
    if (key) {
      this.hits.delete(key);
    } else {
      this.hits.clear();
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.hits.clear();
  }
}

/**
 * Extracts and validates the client IP.
 * Defends against IP spoofing: X-Forwarded-For is ONLY trusted if TRUST_PROXY is enabled,
 * and the extracted IP must be a valid IPv4/IPv6 address.
 */
export function getClientIp(req) {
  const isTrustProxy = process.env.TRUST_PROXY === 'true' || Boolean(req?.app?.get?.('trust proxy'));
  if (isTrustProxy) {
    const forwarded = req.headers?.['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      const candidate = forwarded.split(',')[0].trim();
      if (net.isIP(candidate)) {
        return candidate;
      }
    }
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

export function getSocketIp(socket) {
  const isTrustProxy = process.env.TRUST_PROXY === 'true';
  if (isTrustProxy) {
    const forwarded = socket.handshake?.headers?.['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      const candidate = forwarded.split(',')[0].trim();
      if (net.isIP(candidate)) {
        return candidate;
      }
    }
  }
  return socket.handshake?.address || socket.conn?.remoteAddress || '127.0.0.1';
}

// 1. Auth Limiter: 20 attempts per 15 minutes per IP
export const authLimiter = new SlidingWindowRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts. Please try again after 15 minutes.'
});

// 2. Global API Limiter: 400 requests per 15 minutes per IP
export const apiLimiter = new SlidingWindowRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 400,
  message: 'Too many requests from this IP. Please slow down.'
});

// 3. User Search Limiter: 30 requests per minute per IP
export const searchLimiter = new SlidingWindowRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many search requests. Please slow down.'
});

// 4. Conversation Creation Limiter: 15 conversations per 15 minutes per IP
export const convLimiter = new SlidingWindowRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many conversation creations. Please slow down.'
});

// 5. Socket Handshake Limiter: 30 connection attempts per minute per IP
export const socketHandshakeLimiter = new SlidingWindowRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many socket connection attempts from this IP.',
  keyGenerator: (socket) => getSocketIp(socket)
});

// 6. Socket Message Limiter: 10 messages per 2 seconds per socket
export const socketMessageLimiter = new SlidingWindowRateLimiter({
  windowMs: 2000,
  max: 10,
  message: 'You are sending messages too fast. Please slow down.',
  keyGenerator: (socket) => socket.id
});

// 7. Socket Typing Indicator Limiter: 10 events per 5 seconds per socket
export const socketTypingLimiter = new SlidingWindowRateLimiter({
  windowMs: 5000,
  max: 10,
  message: 'Typing indicators sent too rapidly.',
  keyGenerator: (socket) => socket.id
});
