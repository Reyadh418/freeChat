/**
 * Server Security Headers & CORS Middleware
 */

// Parse whitelisted origins from environment variable
export function getAllowedOrigins() {
  const envOrigins = process.env.ALLOWED_ORIGINS;
  if (!envOrigins) return [];
  return envOrigins
    .split(',')
    .map(o => o.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Validates whether a given origin is permitted
 */
export function isOriginAllowed(origin) {
  // Allow requests without Origin header (same-origin, curl, mobile apps, Postman)
  if (!origin) return true;

  const normOrigin = origin.toLowerCase().replace(/\/$/, '');
  const whitelist = getAllowedOrigins();

  // If explicit whitelist is configured, check against whitelist
  if (whitelist.length > 0) {
    return whitelist.includes(normOrigin);
  }

  // Development/default mode: allow localhost and 127.0.0.1 on any port
  try {
    const url = new URL(normOrigin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return true;
    }
  } catch {
    return false;
  }

  // If in production without explicit whitelist, reject external origins
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  // In non-production, reject other unknown origins
  return false;
}

/**
 * CORS Configuration options for Express cors middleware
 */
export const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: Access denied for this origin.'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400 // Cache preflight for 24 hours
};

/**
 * Comprehensive HTTP Security Headers Middleware
 */
export function securityHeadersMiddleware(req, res, next) {
  // 1. Content Security Policy (CSP)
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss: https:",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ];
  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  // 2. Anti-Clickjacking: Disallow iframe embedding completely
  res.setHeader('X-Frame-Options', 'DENY');

  // 3. Anti-MIME Sniffing: Prevent browsers from MIME-sniffing away from declared content type
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 4. Strict-Transport-Security (HSTS): Enforce HTTPS (1 year + subdomains)
  if (req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // 5. Referrer Policy: Do not leak path details on cross-origin requests
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // 6. Permissions Policy: Disable high-risk browser capabilities not needed by chat
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
  );

  // 7. Cross-Origin Protections
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // 8. Cross-Domain Policies
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  next();
}

