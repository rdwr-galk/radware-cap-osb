/**
 * Basic Authentication middleware for OSB endpoints
 * - Validates credentials against configured env vars
 * - Uses constant-time comparison to avoid timing attacks
 * - Redacts sensitive data in logs
 */

const crypto = require('crypto');
const basicAuth = require('express-basic-auth');
const config = require('../config');
const logger = require('../utils/logger');

// ---- helpers ----

function constantTimeEqual(a, b) {
  // Treat undefined/null as empty string
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  // timingSafeEqual throws if lengths differ; compare lengths first, then compare padded hash
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function shortSha256(input) {
  try {
    return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex').slice(0, 12);
  } catch {
    return 'na';
  }
}

// ---- authorizer ----

function authorizer(username, password) {
  const okUser = constantTimeEqual(username, config.auth.user);
  const okPass = constantTimeEqual(password, config.auth.password);
  const isValid = okUser && okPass;

  if (!isValid) {
    // Log only a hash of the username, never the password
    logger.warn(
      {
        username_hash: shortSha256(username),
        user_present: !!username,
        pass_present: !!password
      },
      'Authentication failed - invalid credentials'
    );
  }

  return isValid;
}

// ---- unauthorized response body (JSON) ----

function unauthorizedResponse(req) {
  logger.warn(
    {
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      userAgent: req.get('User-Agent')
    },
    'Authentication required or failed'
  );

  return {
    description: 'Authentication required. Provide valid Basic Auth credentials.'
  };
}

// ---- middleware instance ----

const basicAuthMiddleware = basicAuth({
  authorizer,
  authorizeAsync: false,
  unauthorizedResponse,
  challenge: true, // adds WWW-Authenticate header
  realm: 'Radware CAP OSB v2.12'
});

module.exports = basicAuthMiddleware;
