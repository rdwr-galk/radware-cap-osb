/**
 * Test JWT Utility for Security Compliant Testing
 * 
 * Generates valid JWT Bearer tokens for testing the new security-compliant authentication
 * Basic authentication is deprecated and no longer supported
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Generate RSA key pair for testing
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
});

// Mock JWKS endpoint setup (for test environment)
const mockKeyId = 'test-key-id';
const mockJWKS = {
  keys: [{
    kty: 'RSA',
    kid: mockKeyId,
    use: 'sig',
    alg: 'RS256',
    n: publicKey.replace(/-----BEGIN PUBLIC KEY-----\n|-----END PUBLIC KEY-----|\n/g, ''),
    e: 'AQAB'
  }]
};

/**
 * Generate a valid JWT Bearer token for testing
 */
function generateValidJWTToken(overrides = {}) {
  const defaultPayload = {
    iss: 'https://iam.cloud.ibm.com',
    aud: 'osb-broker', 
    sub: 'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::',
    account: {
      id: '7c4d0332e74041ea9bbfc21db410f043'
    },
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    ...overrides
  };

  return jwt.sign(defaultPayload, privateKey, {
    algorithm: 'RS256',
    keyid: mockKeyId
  });
}

/**
 * Generate an expired JWT token for testing
 */
function generateExpiredJWTToken() {
  return generateValidJWTToken({
    iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
    exp: Math.floor(Date.now() / 1000) - 3600  // 1 hour ago (expired)
  });
}

/**
 * Generate JWT token with invalid issuer
 */
function generateInvalidIssuerToken() {
  return generateValidJWTToken({
    iss: 'https://evil-issuer.com'
  });
}

/**
 * Generate JWT token with wrong CRN
 */
function generateWrongCRNToken() {
  return generateValidJWTToken({
    sub: 'crn:v1:bluemix:public:wrong-service:us-south:a/different-account::'
  });
}

/**
 * Get Bearer Authorization header for valid JWT
 */
function getBearerAuth(tokenOverrides = {}) {
  const token = generateValidJWTToken(tokenOverrides);
  return `Bearer ${token}`;
}

/**
 * DEPRECATED: Basic Auth function - throws error for security compliance
 */
function getBasicAuth() {
  throw new Error('Basic authentication is deprecated and no longer supported due to security requirements. Use Bearer CRN authentication instead.');
}

module.exports = {
  generateValidJWTToken,
  generateExpiredJWTToken,
  generateInvalidIssuerToken,
  generateWrongCRNToken,
  getBearerAuth,
  getBasicAuth,
  mockJWKS,
  mockKeyId,
  privateKey,
  publicKey,
  
  // Convenience methods for testing
  validAuth: getBearerAuth,
  auth: getBearerAuth, // Replace legacy auth() function
  basicAuth: getBasicAuth // Deprecated - will throw error
};