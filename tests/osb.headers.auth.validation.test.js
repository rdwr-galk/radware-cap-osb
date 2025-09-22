const request = require('supertest');
const app = require('../server');

function auth() {
  return 'Basic ' + Buffer.from('admin:secret').toString('base64');
}

describe('OSB headers & auth', () => {
  test('catalog without X-Broker-API-Version -> 412', async () => {
    const res = await request(app).get('/v2/catalog').set('Authorization', auth());
    expect(res.status).toBe(412);
  });

  test('catalog with wrong version -> 412', async () => {
    const res = await request(app)
      .get('/v2/catalog')
      .set('Authorization', auth())
      .set('X-Broker-API-Version', '2.11');
    expect(res.status).toBe(412);
  });

  test('catalog without basic auth -> 401', async () => {
    const res = await request(app).get('/v2/catalog').set('X-Broker-API-Version', '2.12');
    expect([401, 403]).toContain(res.status);
  });

  test('catalog happy -> 200', async () => {
    const res = await request(app)
      .get('/v2/catalog')
      .set('Authorization', auth())
      .set('X-Broker-API-Version', '2.12');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('services');
  });
});