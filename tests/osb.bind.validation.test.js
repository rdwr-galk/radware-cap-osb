const request = require('supertest');
const app = require('../server');
const { getBearerAuth } = require('./testJwtUtil');
const memoryStore = require('../src/store/memoryStore');
const nock = require('nock');

// Using JWT Bearer authentication - getBearerAuth() from testJwtUtil

describe('OSB Bind validations', () => {
  beforeEach(() => {
    memoryStore.instances.clear();
    memoryStore.bindings.clear();
    memoryStore.operations.clear();
    memoryStore.pendingOperations.clear();
    nock.cleanAll();
  });

  test('missing email -> 422 RequiresApp', async () => {
    const instId = 'inst-bind-missing-email';
    memoryStore.createInstance(instId, {
      serviceId: 'cloud-application-protection-service',
      planId: 'standard',
      parameters: {},
      context: {},
      accountId: 'acc1',
      radwareServiceId: 'svc1'
    });

    const res = await request(app)
      .put(`/v2/service_instances/${instId}/service_bindings/b123`)
      .set('Authorization', getBearerAuth())
      .set('X-Broker-API-Version', '2.12')
      .send({
        service_id: 'cloud-application-protection-service',
        plan_id: 'standard',
        parameters: {}
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('RequiresApp');
  });

  test('happy bind -> creates contact user and returns credentials', async () => {
    // Mock the Radware API call for creating a contact user
    nock('https://localhost:9443')
      .put('/api/sdcc/system/entity/users?databaseType=ORIGIN')
      .reply(200, {
        id: 'u1',
        email: 'user@acme.com',
        accountId: 'acc1'
      });

    const instId = 'inst-bind-ok';
    memoryStore.createInstance(instId, {
      serviceId: 'cloud-application-protection-service',
      planId: 'standard',
      parameters: {},
      context: {},
      accountId: 'acc1',
      radwareServiceId: 'svc1'
    });

    const res = await request(app)
      .put(`/v2/service_instances/${instId}/service_bindings/b123`)
      .set('Authorization', getBearerAuth())
      .set('X-Broker-API-Version', '2.12')
      .send({
        service_id: 'cloud-application-protection-service',
        plan_id: 'standard',
        parameters: { email: 'user@acme.com' }
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('credentials');
    expect(res.body.credentials).toMatchObject({
      userId: 'u1',
      email: 'user@acme.com',
      accountId: 'acc1'
    });
  });
});