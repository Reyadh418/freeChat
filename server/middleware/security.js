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
 * Validates whether a given origin is permitted.
 * Supports same-origin requests (origin matches incoming host header),
 * auto-discovered cloud deployment environments (Render, Railway, Fly.io),
 * explicit ALLOWED_ORIGINS whitelist, and local development.
 */
export function isOriginAllowed(origin, host = null) {
  // Allow requests without Origin header (same-origin, curl, mobile apps, Postman)
  if (!origin) return true;

  const normOrigin = origin.toLowerCase().replace(/\/$/, '');
  const whitelist = getAllowedOrigins();

  // Auto-discover cloud platform deployment URLs
  if (process.env.RENDER_EXTERNAL_URL) {
    whitelist.push(process.env.RENDER_EXTERNAL_URL.toLowerCase().replace(/\/$/, ''));
  }
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    whitelist.push(`https://${process.env.RENDER_EXTERNAL_HOSTNAME.toLowerCase()}`);
  }
  if (process.env.RAILWAY_STATIC_URL) {
    whitelist.push(`https://${process.env.RAILWAY_STATIC_URL.toLowerCase().replace(/\/$/, '')}`);
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    whitelist.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN.toLowerCase().replace(/\/$/, '')}`);
  }
  if (process.env.FLY_APP_NAME) {
    whitelist.push(`https://${process.env.FLY_APP_NAME.toLowerCase()}.fly.dev`);
  }

  // If origin is in explicit or auto-discovered whitelist
  if (whitelist.includes(normOrigin)) {
    return true;
  }

  // Same-origin verification: allow if origin host matches the server's Host header
  if (host) {
    try {
      const url = new URL(normOrigin);
      const hostOnly = host.toLowerCase().split(':')[0];
      if (url.hostname === hostOnly) {
        return true;
      }
    } catch {}
  }

  // If explicit ALLOWED_ORIGINS whitelist is configured and origin did not match, deny
  if (getAllowedOrigins().length > 0) {
    return false;
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

  // If in production without matching host or whitelist, reject external origins
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  // In non-production, reject other unknown origins
  return false;
}

/**
 * Dynamic CORS options delegate for Express cors middleware.
 * Inspects incoming request headers (Origin, Host, X-Forwarded-Host)
 * to transparently support same-origin requests and cloud domains.
 */
export const corsOptions = (req, callback) => {
  const origin = req.headers ? req.headers.origin : null;
  const host = req.headers ? (req.headers['x-forwarded-host'] || req.headers.host) : null;

  if (isOriginAllowed(origin, host)) {
    callback(null, {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
      maxAge: 86400 // Cache preflight for 24 hours
    });
  } else {
    callback(new Error('CORS policy: Access denied for this origin.'));
  }
};

// Preserve backward-compatible property interface for direct invocations (e.g. test suites)
corsOptions.origin = (origin, callback) => {
  if (isOriginAllowed(origin)) {
    callback(null, true);
  } else {
    callback(new Error('CORS policy: Access denied for this origin.'));
  }
};
corsOptions.methods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
corsOptions.allowedHeaders = ['Content-Type', 'Authorization'];
corsOptions.credentials = true;
corsOptions.maxAge = 86400;

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

