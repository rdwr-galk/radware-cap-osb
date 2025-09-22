const request = require('supertest');

// מייבאים את ה-app (לא פותחים פורט, supertest מדבר ישירות עם האפליקציה בזיכרון)
const app = require('../server'); // הנתיב לשורש (server.js מייצא app)

const HDR = { 'X-Broker-API-Version': '2.12', 'Content-Type': 'application/json' };
const rid = (p) => `${p}-${Math.random().toString(36).slice(2,8)}`;

describe('OSB E2E (in-memory, mocked Radware)', () => {
  const serviceId = 'cloud-application-protection-service';
  let instanceId, bindingId, planId;

  beforeEach(() => {
    instanceId = rid('inst');
    bindingId  = rid('bind');
    planId     = 'standard';
    primeRadwareMocks({});
  });

  test('provision (async) → last_operation → patch → bind → unbind → deprovision (async)', async () => {
    // 1) catalog
    await request(app).get('/v2/catalog').set(HDR).auth('admin', 'secret').expect(200);

    // 2) provision (async)
    const prov = await request(app)
      .put(`/v2/service_instances/${instanceId}`)
      .query({ accepts_incomplete: 'true' })
      .set(HDR).auth('admin','secret')
      .send({
        service_id: serviceId,
        plan_id: planId,
        context: { platform: 'ibm', region: 'us-east-1' },
        parameters: { customerName: 'Acme', planType: 'STANDARD' }
      })
      .expect(202);

    expect(prov.body.operation).toBeTruthy();
    const op = prov.body.operation;

    // 3) poll last_operation (פול קצר)
    let state = 'in progress';
    for (let i=0; i<10 && state==='in progress'; i++) {
      const r = await request(app)
        .get(`/v2/service_instances/${instanceId}/last_operation`)
        .query({ operation: op })
        .set(HDR).auth('admin','secret')
        .expect(200);
      state = r.body.state;
      await new Promise(r=>setTimeout(r, 10));
    }
    expect(state).toBe('succeeded');

    // 4) PATCH (שינוי תוכנית מפעיל updateServicePlan)
    const newPlan = 'standard-plus';
    await request(app)
      .patch(`/v2/service_instances/${instanceId}`)
      .set(HDR).auth('admin','secret')
      .send({
        service_id: serviceId,
        plan_id: newPlan,
        parameters: { environment: 'staging' },
        previous_values: { plan_id: planId }
      })
      .expect(200);
    planId = newPlan;

    // 5) bind (CONTACT)
    const bind = await request(app)
      .put(`/v2/service_instances/${instanceId}/service_bindings/${bindingId}`)
      .set(HDR).auth('admin','secret')
      .send({
        service_id: serviceId,
        plan_id: planId,
        bind_resource: { app_guid: rid('app') },
        parameters: { email: 'user@acme.com', firstName: 'John', lastName: 'Doe' }
      })
      .expect(201);
    expect(bind.body.credentials).toBeDefined();

    // 6) unbind (עם query חובה)
    await request(app)
      .delete(`/v2/service_instances/${instanceId}/service_bindings/${bindingId}`)
      .query({ service_id: serviceId, plan_id: planId })
      .set(HDR).auth('admin','secret')
      .expect(200);

    // 7) deprovision (async)
    const dep = await request(app)
      .delete(`/v2/service_instances/${instanceId}`)
      .query({ service_id: serviceId, plan_id: planId, accepts_incomplete: 'true' })
      .set(HDR).auth('admin','secret')
      .expect(202);

    const op2 = dep.body.operation;
    let s2 = 'in progress';
    for (let i=0; i<10 && s2==='in progress'; i++) {
      const r = await request(app)
        .get(`/v2/service_instances/${instanceId}/last_operation`)
        .query({ operation: op2 })
        .set(HDR).auth('admin','secret')
        .expect(200);
      s2 = r.body.state;
      await new Promise(r=>setTimeout(r, 10));
    }
    expect(s2).toBe('succeeded');
  });
});
