// tests/osb.delete.validation.test.js
const request = require('supertest');
const app = require('../server');
const { getBearerAuth } = require('./testJwtUtil');
const memoryStore = require('../src/store/memoryStore');

function basicAuth() {
  const pair = Buffer.from('admin:secret').toString('base64');
  return `Basic ${pair}`;
}
const API = { ver: { 'X-Broker-API-Version': '2.12' } };
const AUTH = { Authorization: getBearerAuth() };

describe('OSB DELETE validations', () => {
  beforeEach(() => {
    // naive reset: new MemoryStore instance is a singleton, so clear maps
    memoryStore.instances.clear();
    memoryStore.bindings.clear();
    memoryStore.operations.clear();
    memoryStore.pendingOperations.clear();
  });

  test('deprovision: 400 when missing query params', async () => {
    const res = await request(app)
      .delete('/v2/service_instances/inst-missing')
      .set(API.ver)
      .set(AUTH);
    expect(res.status).toBe(400);
  });

  test('deprovision: 410 when instance not found', async () => {
    const res = await request(app)
      .delete('/v2/service_instances/inst-not-exists')
      .query({ service_id: 'cloud-application-protection-service', plan_id: 'standard' })
      .set(API.ver)
      .set(AUTH);
    expect(res.status).toBe(410);
  });

  test('deprovision: 409 when service_id/plan_id mismatch', async () => {
    const id = 'inst-for-409';
    memoryStore.createInstance(id, {
      serviceId: 'cloud-application-protection-service',
      planId: 'standard',
      parameters: {},
      context: {},
      accountId: 'acc1',
      radwareServiceId: 'svc1'
    });

    const res = await request(app)
      .delete(`/v2/service_instances/${id}`)
      .query({ service_id: 'cloud-application-protection-service', plan_id: 'enterprise' })
      .set(API.ver)
      .set(AUTH);

    expect(res.status).toBe(409);
  });

  test('unbind: 400 when missing query params', async () => {
    const res = await request(app)
      .delete('/v2/service_instances/inst-x/service_bindings/bind-x')
      .set(API.ver)
      .set(AUTH);
    expect(res.status).toBe(400);
  });

  test('unbind: 410 when binding not found', async () => {
    const res = await request(app)
      .delete('/v2/service_instances/inst-x/service_bindings/not-exists')
      .query({ service_id: 'cloud-application-protection-service', plan_id: 'standard' })
      .set(API.ver)
      .set(AUTH);
    expect(res.status).toBe(410);
  });

  test('unbind: 409 when service_id/plan_id mismatch', async () => {
    const instId = 'inst-bind-1';
    const bindId = 'bind-1';
    memoryStore.createInstance(instId, {
      serviceId: 'cloud-application-protection-service',
      planId: 'standard',
      parameters: {},
      context: {},
      accountId: 'acc1',
      radwareServiceId: 'svc1'
    });
    memoryStore.createBinding(instId, bindId, {
      serviceId: 'cloud-application-protection-service',
      planId: 'standard',
      bindResource: {},
      parameters: {},
      credentials: { userId: 'u1', email: 'a@a.com', accountId: 'acc1' },
      radwareUserId: 'u1'
    });

    const res = await request(app)
      .delete(`/v2/service_instances/${instId}/service_bindings/${bindId}`)
      .query({ service_id: 'cloud-application-protection-service', plan_id: 'enterprise' })
      .set(API.ver)
      .set(AUTH);

    expect(res.status).toBe(409);
  });
});
