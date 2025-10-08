const request = require('supertest');
const app = require('../server');
const { getBearerAuth } = require('./testJwtUtil');

describe('OSB headers & auth - Security Compliant (Bearer CRN Only)', () => {
  test('catalog without X-Broker-API-Version -> 412', async () => {
    const res = await request(app).get('/v2/catalog').set('Authorization', getBearerAuth());
    expect(res.status).toBe(412);
  });

  test('catalog with wrong version -> 412', async () => {
    const res = await request(app)
      .get('/v2/catalog')
      .set('Authorization', getBearerAuth())
      .set('X-Broker-API-Version', '2.11');
    expect(res.status).toBe(412);
  });

  test('catalog without Bearer CRN auth -> 401', async () => {
    const res = await request(app).get('/v2/catalog').set('X-Broker-API-Version', '2.12');
    expect(res.status).toBe(401);
    expect(res.body.description).toContain('Bearer CRN token required');
    expect(res.body.description).toContain('Basic authentication is deprecated');
  });

  test('catalog with deprecated Basic Auth -> 401', async () => {
    const basicAuth = 'Basic ' + Buffer.from('admin:secret').toString('base64');
    const res = await request(app)
      .get('/v2/catalog')
      .set('Authorization', basicAuth)
      .set('X-Broker-API-Version', '2.12');
    expect(res.status).toBe(401);
    expect(res.body.description).toContain('Bearer CRN token required');
    expect(res.body.compliance).toBe('IBM Cloud Partner Center Security Policy');
  });

  test('catalog with Bearer CRN auth -> 200', async () => {
    const res = await request(app)
      .get('/v2/catalog')
      .set('Authorization', getBearerAuth())
      .set('X-Broker-API-Version', '2.12');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('services');
  });
});