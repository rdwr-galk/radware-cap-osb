/**
 * IBM Cloud Partner Center Compliant JWT Bearer Authentication Middleware
 * 
 * SECURITY COMPLIANCE: Basic authentication schemas are deprecated and no longer 
 * supported due to security requirements. This middleware enforces Bearer CRN 
 * authentication exclusively for continued access.
 * 
 * Flow:
 * 1. Parse Authorization: Bearer <JWT>
 * 2. Validate JWT signature against IBM IAM public keys
 * 3. Verify JWT claims (sub, iss, aud, exp)
 * 4. Ensure 'sub' matches the Broker's CRN
 * 5. Return 401 if verification fails
 * 6. NO FALLBACKS - Bearer CRN required for security compliance
 */

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const axios = require('axios');
const NodeCache = require('node-cache');
const config = require('../config');
const logger = require('../utils/logger');

// Cache for JWKS keys (1 hour TTL)
const jwksCache = new NodeCache({ stdTTL: 3600 });

// IBM IAM JWKS endpoint
const IBM_IAM_JWKS_URL = 'https://iam.cloud.ibm.com/identity/keys';

// Initialize JWKS client
const client = jwksClient({
  jwksUri: IBM_IAM_JWKS_URL,
  requestHeaders: {},
  timeout: 30000,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000, // 10 minutes
});

/**
 * Get signing key for JWT verification
 */
async function getKey(header, callback) {
  try {
    // In test environment, use mock key for testing
    if (process.env.NODE_ENV === 'test' && header.kid === 'test-key-id') {
      // Use the test public key from testJwtUtil if available
      try {
        const testUtil = require('../../tests/testJwtUtil');
        if (testUtil && testUtil.publicKey) {
          callback(null, testUtil.publicKey);
          return;
        }
      } catch (e) {
        // Fall through to production logic if test util not found
      }
    }
    
    const key = await client.getSigningKey(header.kid);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  } catch (error) {
    logger.error('Failed to get JWT signing key', {
      kid: header.kid,
      error: error.message
    });
    callback(error);
  }
}

/**
 * Verify JWT token against IBM IAM
 */
async function verifyToken(token) {
  return new Promise((resolve, reject) => {
    // First decode the token to get the header
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header) {
      return reject(new Error('Invalid JWT format'));
    }

    // Verify the token with the signing key
    jwt.verify(token, getKey, {
      audience: config.auth.expectedAudience || 'osb-broker',
      issuer: config.auth.expectedIssuer || 'https://iam.cloud.ibm.com',
      algorithms: ['RS256', 'RS512'],
      ignoreExpiration: false,
    }, (err, payload) => {
      if (err) {
        return reject(err);
      }
      resolve(payload);
    });
  });
}

/**
 * Validate JWT claims for IBM Cloud Partner Center
 */
function validateClaims(payload, config) {
  const errors = [];

  // Check required claims
  if (!payload.sub) {
    errors.push('Missing subject (sub) claim');
  }

  if (!payload.iss) {
    errors.push('Missing issuer (iss) claim');
  }

  if (!payload.aud) {
    errors.push('Missing audience (aud) claim');
  }

  if (!payload.exp) {
    errors.push('Missing expiration (exp) claim');
  }

  // Check if token is for the correct broker CRN
  const expectedCRN = config?.auth?.brokerCRN;
  if (expectedCRN && payload.sub !== expectedCRN) {
    errors.push(`Subject mismatch: expected ${expectedCRN}, got ${payload.sub}`);
  }

  // Verify issuer is IBM IAM
  if (payload.iss !== 'https://iam.cloud.ibm.com') {
    errors.push(`Invalid issuer: expected https://iam.cloud.ibm.com, got ${payload.iss}`);
  }

  // Check token expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    errors.push('Token has expired');
  }

  return errors;
}

/**
 * IBM IAM JWT Authentication Middleware
 */
function ibmIamAuth() {
  return async (req, res, next) => {
    try {
      // Load config for this request
      const loadConfig = require('../config');
      const config = await loadConfig();
      
      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        logger.warn('Missing Authorization header', {
          path: req.path,
          method: req.method,
          ip: req.ip
        });
        return res.status(401).json({
          error: 'Unauthorized',
          description: 'Authorization header is required'
        });
      }

      // Parse Bearer token
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        logger.warn('Invalid Authorization header format', {
          path: req.path,
          method: req.method,
          authHeader: authHeader.substring(0, 20) + '...'
        });
        return res.status(401).json({
          error: 'Unauthorized',
          description: 'Authorization header must be in format: Bearer <token>'
        });
      }

      const token = match[1];

      // Verify JWT token
      let payload;
      try {
        payload = await verifyToken(token);
      } catch (error) {
        logger.warn('JWT verification failed', {
          path: req.path,
          method: req.method,
          error: error.message
        });
        return res.status(401).json({
          error: 'Unauthorized',
          description: 'Invalid or expired JWT token'
        });
      }

      // Validate JWT claims
      const claimErrors = validateClaims(payload, config);
      if (claimErrors.length > 0) {
        logger.warn('JWT claims validation failed', {
          path: req.path,
          method: req.method,
          errors: claimErrors,
          subject: payload.sub
        });
        return res.status(401).json({
          error: 'Unauthorized',
          description: 'JWT claims validation failed'
        });
      }

      // Add JWT payload to request for downstream use
      req.jwt = payload;
      req.brokerCRN = payload.sub;

      logger.info('JWT authentication successful', {
        path: req.path,
        method: req.method,
        subject: payload.sub,
        audience: payload.aud
      });

      next();

    } catch (error) {
      logger.error('JWT authentication error', {
        path: req.path,
        method: req.method,
        error: error.message,
        stack: error.stack
      });
      
      return res.status(500).json({
        error: 'InternalServerError',
        description: 'Authentication service error'
      });
    }
  };
}

/**
 * Security Compliant Authentication Middleware
 * 
 * DEPRECATED: Basic and bearer authentication schemas are deprecated and will 
 * no longer be supported in the future due to security reasons.
 * 
 * ENFORCES: Bearer CRN authentication exclusively for continued access.
 */
function securityCompliantAuth() {
  return (req, res, next) => {
    // Skip authentication for health checks and metrics only
    if (req.path === '/health' || req.path === '/metrics') {
      return next();
    }

    // SECURITY COMPLIANCE: Enforce Bearer CRN authentication exclusively
    // No fallbacks allowed - security requirement
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Unauthorized access attempt - Bearer CRN token required', {
        path: req.path,
        method: req.method,
        ip: req.ip,
        authHeader: authHeader ? authHeader.substring(0, 10) + '...' : 'none'
      });
      
      return res.status(401).json({
        error: 'Unauthorized',
        description: 'Bearer CRN token required. Basic authentication is deprecated and no longer supported due to security requirements.',
        compliance: 'IBM Cloud Partner Center Security Policy'
      });
    }

    // Use JWT Bearer CRN authentication exclusively
    return ibmIamAuth()(req, res, next);
  };
}

module.exports = {
  ibmIamAuth,
  securityCompliantAuth,
  verifyToken,
  validateClaims,
  // Deprecated exports - maintained for backward compatibility during transition
  smartAuth: securityCompliantAuth, // Redirect to security compliant auth
  basicAuthFallback: () => {
    throw new Error('Basic authentication is deprecated and no longer supported due to security requirements. Use Bearer CRN authentication instead.');
  }
};