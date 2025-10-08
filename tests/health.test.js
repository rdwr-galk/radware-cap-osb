/**
 * Tests for Enhanced Health Check Endpoint
 * Validates comprehensive health monitoring for IBM Cloud deployment
 */

const request = require('supertest');
const nock = require('nock');
const app = require('../server');

describe('Health Check Endpoint', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  describe('Healthy State', () => {
    beforeEach(() => {
      // Mock successful Radware API response
      nock(process.env.RADWARE_API_BASE_URL || 'https://api.radware.com')
        .persist()
        .post('/api/sdcc/system/entity/accounts')
        .query({ databaseType: 'ORIGIN' })
        .reply(200, { docs: [], total_rows: 0 });

      // Mock successful Cloudant response if using Cloudant
      if (process.env.DB_TYPE === 'cloudant' && process.env.CLOUDANT_URL) {
        const cloudantUrl = new URL(process.env.CLOUDANT_URL);
        nock(`${cloudantUrl.protocol}//${cloudantUrl.host}`)
          .persist()
          .get(`/${process.env.CLOUDANT_DB || 'radware-osb'}`)
          .reply(200, {
            db_name: process.env.CLOUDANT_DB || 'radware-osb',
            doc_count: 0,
            doc_del_count: 0
          });
      }
    });

    it('should return healthy status when all services are up', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(ok|warning)$/),
        service: 'radware-cap-osb',
        version: expect.any(String),
        uptime: expect.any(Number),
        checks: {
          database: expect.objectContaining({
            status: expect.stringMatching(/^(ok|warning)$/)
          }),
          radware: expect.objectContaining({
            status: expect.stringMatching(/^(ok|warning)$/)
          }),
          memory: expect.objectContaining({
            status: expect.stringMatching(/^(ok|warning|critical)$/),
            heapUsed: expect.any(Number),
            heapTotal: expect.any(Number),
            percentage: expect.any(Number)
          })
        },
        responseTime: expect.any(Number)
      });

      expect(response.body.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include latency information for external services', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      if (response.body.checks.radware.status === 'ok') {
        expect(response.body.checks.radware.latency).toBeDefined();
        expect(typeof response.body.checks.radware.latency).toBe('number');
      }

      if (response.body.checks.database.status === 'ok' && response.body.checks.database.type === 'cloudant') {
        expect(response.body.checks.database.latency).toBeDefined();
        expect(typeof response.body.checks.database.latency).toBe('number');
      }
    });

    it('should include memory usage details', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      const memCheck = response.body.checks.memory;
      expect(memCheck.heapUsed).toBeGreaterThan(0);
      expect(memCheck.heapTotal).toBeGreaterThan(0);
      expect(memCheck.percentage).toBeGreaterThanOrEqual(0);
      expect(memCheck.percentage).toBeLessThanOrEqual(100);
    });
  });

  describe('Degraded State', () => {
    it('should return degraded status when Radware API is unreachable', async () => {
      // Mock Radware API failure
      nock(process.env.RADWARE_API_BASE_URL || 'https://api.radware.com')
        .persist()
        .post('/api/sdcc/system/entity/accounts')
        .query({ databaseType: 'ORIGIN' })
        .replyWithError('Connection timeout');

      const response = await request(app)
        .get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('degraded');
      expect(response.body.checks.radware.status).toMatch(/^(failed|error)$/);
      expect(response.body.issues).toBeDefined();
      expect(response.body.issues.length).toBeGreaterThan(0);
    });

    it('should return degraded status when database is unreachable', async () => {
      // Skip this test if using memory store
      if (process.env.DB_TYPE !== 'cloudant') {
        return;
      }

      // Mock Cloudant failure
      if (process.env.CLOUDANT_URL) {
        const cloudantUrl = new URL(process.env.CLOUDANT_URL);
        nock(`${cloudantUrl.protocol}//${cloudantUrl.host}`)
          .persist()
          .get(`/${process.env.CLOUDANT_DB || 'radware-osb'}`)
          .replyWithError('Database connection failed');
      }

      const response = await request(app)
        .get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('degraded');
      expect(response.body.checks.database.status).toMatch(/^(failed|error)$/);
      expect(response.body.issues).toBeDefined();
      expect(response.body.issues.length).toBeGreaterThan(0);
    });

    it('should handle multiple service failures', async () => {
      // Mock both services failing
      nock(process.env.RADWARE_API_BASE_URL || 'https://api.radware.com')
        .persist()
        .post('/api/sdcc/system/entity/accounts')
        .query({ databaseType: 'ORIGIN' })
        .replyWithError('API server error');

      if (process.env.DB_TYPE === 'cloudant' && process.env.CLOUDANT_URL) {
        const cloudantUrl = new URL(process.env.CLOUDANT_URL);
        nock(`${cloudantUrl.protocol}//${cloudantUrl.host}`)
          .persist()
          .get(`/${process.env.CLOUDANT_DB || 'radware-osb'}`)
          .replyWithError('Database server error');
      }

      const response = await request(app)
        .get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('degraded');
      expect(response.body.issues.length).toBeGreaterThan(0);
    });
  });

  describe('Memory Warning State', () => {
    it('should detect high memory usage', async () => {
      // This test is tricky to simulate without actually consuming memory
      // In a real scenario, you might need to mock process.memoryUsage()
      
      // Mock high memory usage (90% of heap)
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        heapUsed: 92 * 1024 * 1024, // 92% usage
        external: 5 * 1024 * 1024,
        arrayBuffers: 0
      });

      const response = await request(app)
        .get('/health');

      // Should still be accessible but with warning
      expect(response.status).toBeOneOf([200, 503]);
      if (response.body.checks.memory.percentage > 90) {
        expect(response.body.checks.memory.status).toBe('critical');
      }

      // Restore original function
      process.memoryUsage.mockRestore();
    });
  });

  describe('Response Format', () => {
    it('should have consistent response structure', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('service', 'radware-cap-osb');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('checks');
      expect(response.body).toHaveProperty('responseTime');

      expect(response.body.checks).toHaveProperty('database');
      expect(response.body.checks).toHaveProperty('radware');
      expect(response.body.checks).toHaveProperty('memory');
    });

    it('should not cache health check responses', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('should provide appropriate HTTP status codes', async () => {
      const response = await request(app)
        .get('/health');

      if (response.body.status === 'ok' || response.body.status === 'warning') {
        expect(response.status).toBe(200);
      } else if (response.body.status === 'degraded' || response.body.status === 'error') {
        expect(response.status).toBe(503);
      }
    });
  });

  describe('Database-Specific Tests', () => {
    it('should handle memory store correctly', async () => {
      // If using memory store, should show as 'memory' type
      const response = await request(app)
        .get('/health');

      if (response.body.checks.database.type === 'memory') {
        expect(response.body.checks.database.status).toBe('ok');
      }
    });

    it('should handle Cloudant store correctly', async () => {
      // Skip if not using Cloudant
      if (process.env.DB_TYPE !== 'cloudant') {
        return;
      }

      const response = await request(app)
        .get('/health');

      expect(response.body.checks.database.type).toBe('cloudant');
      if (response.body.checks.database.status === 'ok') {
        expect(response.body.checks.database.database).toBeDefined();
      }
    });
  });

  describe('Performance', () => {
    it('should respond within reasonable time', async () => {
      const start = Date.now();
      
      await request(app)
        .get('/health');
      
      const duration = Date.now() - start;
      
      // Health check should complete within 10 seconds even with external calls
      expect(duration).toBeLessThan(10000);
    });

    it('should include its own response time in the response', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.body.responseTime).toBeDefined();
      expect(typeof response.body.responseTime).toBe('number');
      expect(response.body.responseTime).toBeGreaterThan(0);
    });
  });
});