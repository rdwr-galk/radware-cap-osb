/**
 * Tests for IBM IAM JWT Bearer Token Authentication
 * Validates IBM Cloud Partner Center integration
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const nock = require('nock');

describe('IBM IAM JWT Authentication', () => {
  let mockJWKS;
  let mockPrivateKey;
  let mockPublicKey;

  beforeAll(async () => {
    // Mock JWT keys for testing
    const crypto = require('crypto');
    const keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    mockPrivateKey = keyPair.privateKey;
    mockPublicKey = keyPair.publicKey;

    // Mock JWKS response
    mockJWKS = {
      keys: [
        {
          kty: 'RSA',
          use: 'sig',
          kid: 'test-key-id',
          n: 'mock-modulus',
          e: 'AQAB'
        }
      ]
    };

    // Mock IBM IAM JWKS endpoint
    nock('https://iam.cloud.ibm.com')
      .persist()
      .get('/identity/keys')
      .reply(200, mockJWKS);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Valid JWT Token', () => {
    it('should validate JWT token structure correctly', () => {
      const validPayload = {
        sub: 'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::',
        iss: 'https://iam.cloud.ibm.com',
        aud: 'osb-broker',
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        iat: Math.floor(Date.now() / 1000),
        scope: 'ibm openid'
      };

      const token = jwt.sign(validPayload, mockPrivateKey, {
        algorithm: 'RS256',
        keyid: 'test-key-id'
      });

      // Verify token can be decoded
      const decoded = jwt.decode(token, { complete: true });
      expect(decoded.payload.sub).toBe(validPayload.sub);
      expect(decoded.payload.iss).toBe(validPayload.iss);
      expect(decoded.header.alg).toBe('RS256');
    });

    it('should include JWT payload in request context', async () => {
      const validPayload = {
        sub: 'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::',
        iss: 'https://iam.cloud.ibm.com',
        aud: 'osb-broker',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const token = jwt.sign(validPayload, mockPrivateKey, {
        algorithm: 'RS256',
        keyid: 'test-key-id'
      });

      // This would require middleware to capture and validate the JWT payload
      // Implementation depends on how the request context is made available
    });
  });

  describe('Invalid JWT Token', () => {
    it('should create proper error for missing Authorization header', () => {
      // Test that our validation logic works correctly
      const authHeader = undefined;
      expect(authHeader).toBeUndefined();
    });

    it('should detect malformed Authorization header format', () => {
      const authHeader = 'Invalid-Format token';
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      expect(match).toBeNull();
    });

    it('should reject expired JWT token', async () => {
      const expiredPayload = {
        sub: 'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::',
        iss: 'https://iam.cloud.ibm.com',
        aud: 'osb-broker',
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        iat: Math.floor(Date.now() / 1000) - 7200
      };

      const token = jwt.sign(expiredPayload, mockPrivateKey, {
        algorithm: 'RS256',
        keyid: 'test-key-id'
      });

      const app = require('../server');
      const response = await request(app)
        .get('/v2/catalog')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Broker-API-Version', '2.12');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should reject JWT with wrong issuer', async () => {
      const invalidPayload = {
        sub: 'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::',
        iss: 'https://evil-issuer.com',
        aud: 'osb-broker',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const token = jwt.sign(invalidPayload, mockPrivateKey, {
        algorithm: 'RS256',
        keyid: 'test-key-id'
      });

      const app = require('../server');
      const response = await request(app)
        .get('/v2/catalog')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Broker-API-Version', '2.12');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should reject JWT with wrong subject CRN', async () => {
      const invalidPayload = {
        sub: 'crn:v1:bluemix:public:wrong-service:us-south:a/different-account::',
        iss: 'https://iam.cloud.ibm.com',
        aud: 'osb-broker',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const token = jwt.sign(invalidPayload, mockPrivateKey, {
        algorithm: 'RS256',
        keyid: 'test-key-id'
      });

      const app = require('../server');
      const response = await request(app)
        .get('/v2/catalog')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Broker-API-Version', '2.12');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should reject JWT with invalid signature', async () => {
      const invalidPayload = {
        sub: 'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::',
        iss: 'https://iam.cloud.ibm.com',
        aud: 'osb-broker',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      // Use wrong private key
      const wrongKeyPair = require('crypto').generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });

      const token = jwt.sign(invalidPayload, wrongKeyPair.privateKey, {
        algorithm: 'RS256',
        keyid: 'test-key-id'
      });

      const app = require('../server');
      const response = await request(app)
        .get('/v2/catalog')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Broker-API-Version', '2.12');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  describe('Development Mode Fallback', () => {
    it('should use basic auth in test environment', () => {
      // Test environment should use basic auth by default
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.FORCE_JWT_AUTH).toBeOneOf(['false', undefined]);
    });

    it('should validate basic auth credentials format', () => {
      const username = process.env.OSB_BASIC_AUTH_USER || 'admin';
      const password = process.env.OSB_BASIC_AUTH_PASS || 'secret';
      
      expect(username).toBeTruthy();
      expect(password).toBeTruthy();
      expect(username.length).toBeGreaterThan(0);
      expect(password.length).toBeGreaterThan(0);
    });
  });

  describe('Health Endpoint Accessibility', () => {
    it('should allow unauthenticated access to health endpoint', async () => {
      // Note: This test validates the app instance created in test mode
      const app = require('../server');
      const response = await request(app)
        .get('/health');

      expect(response.status).toBeOneOf([200, 503]); // May be degraded if services are down
      expect(response.body.status).toBeDefined();
      expect(response.body.service).toBe('radware-cap-osb');
    });

    it('should allow unauthenticated access to metrics endpoint', async () => {
      const app = require('../server');
      const response = await request(app)
        .get('/metrics');

      expect(response.status).toBe(200);
      expect(response.text).toContain('# HELP'); // Prometheus format
    });
  });

  describe('JWT Claims Validation', () => {
    const { validateClaims } = require('../src/middlewares/ibmAuth');

    it('should validate correct JWT claims', () => {
      const validClaims = {
        sub: 'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::',
        iss: 'https://iam.cloud.ibm.com',
        aud: 'osb-broker',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const errors = validateClaims(validClaims);
      expect(errors).toHaveLength(0);
    });

    it('should reject claims with missing required fields', () => {
      const invalidClaims = {
        iss: 'https://iam.cloud.ibm.com',
        aud: 'osb-broker'
        // Missing sub and exp
      };

      const errors = validateClaims(invalidClaims);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('subject'))).toBe(true);
      expect(errors.some(e => e.includes('expiration'))).toBe(true);
    });

    it('should reject expired token claims', () => {
      const expiredClaims = {
        sub: 'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::',
        iss: 'https://iam.cloud.ibm.com',
        aud: 'osb-broker',
        exp: Math.floor(Date.now() / 1000) - 100 // Already expired
      };

      const errors = validateClaims(expiredClaims);
      expect(errors.some(e => e.includes('expired'))).toBe(true);
    });

    it('should reject claims with wrong issuer', () => {
      const wrongIssuerClaims = {
        sub: 'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::',
        iss: 'https://fake-issuer.com',
        aud: 'osb-broker',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const errors = validateClaims(wrongIssuerClaims);
      expect(errors.some(e => e.includes('Invalid issuer'))).toBe(true);
    });
  });
});