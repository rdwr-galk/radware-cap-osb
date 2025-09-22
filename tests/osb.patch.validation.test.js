const request = require('supertest');
const app = require('../server');
const memoryStore = require('../src/store/memoryStore');
const radwareApi = require('../src/services/radwareApi');

function auth() {
  return 'Basic ' + Buffer.from('admin:secret').toString('base64');
}

describe('OSB PATCH update (plan change)', () => {
  beforeEach(() => {
    memoryStore.instances.clear();
    memoryStore.bindings.clear();
    memoryStore.operations.clear();
    memoryStore.pendingOperations.clear();
    jest.restoreAllMocks();
  });

  test('when plan_id changes -> calls radwareApi.updateServicePlan', async () => {
    const instId = 'inst-patch-1';
    memoryStore.createInstance(instId, {
      serviceId: 'cloud-application-protection-service',
      planId: 'standard',
      parameters: {},
      context: {},
      accountId: 'acc1',
      radwareServiceId: 'svc1'
    });

    const spy = jest.spyOn(radwareApi, 'updateServicePlan').mockResolvedValue({ ok: true });

    const res = await request(app)
      .patch(`/v2/service_instances/${instId}`)
      .set('Authorization', auth())
      .set('X-Broker-API-Version', '2.12')
      .send({
        service_id: 'cloud-application-protection-service',
        plan_id: 'enterprise',
        parameters: { note: 'upgrade' }
      });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith({
      serviceId: 'svc1',
      newPlanId: 'enterprise',
      params: { note: 'upgrade' }
    });
  });

  test('when plan_id not changed -> does NOT call backend', async () => {
    const instId = 'inst-patch-2';
    memoryStore.createInstance(instId, {
      serviceId: 'cloud-application-protection-service',
      planId: 'standard',
      parameters: { env: 'prod' },
      context: {},
      accountId: 'acc1',
      radwareServiceId: 'svc1'
    });

    const spy = jest.spyOn(radwareApi, 'updateServicePlan').mockResolvedValue({ ok: true });

    const res = await request(app)
      .patch(`/v2/service_instances/${instId}`)
      .set('Authorization', auth())
      .set('X-Broker-API-Version', '2.12')
      .send({
        service_id: 'cloud-application-protection-service',
        plan_id: 'standard',
        parameters: { env: 'staging' }
      });

    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});