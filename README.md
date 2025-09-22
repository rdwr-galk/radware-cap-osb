Radware CAP Open Service Broker (OSB) v2.12

Node.js (Express) Open Service Broker for Radware Cloud Application Protection (CAP / CWAF), compliant with OSB API v2.12.

-------------------------------------------------------------------------------
# FEATURES
- OSB v2.12: Catalog, provision, update (PATCH), bind, unbind, deprovision, last_operation.
- Radware Integration: Unified Account + CWAF Service via /api/sdcc/system/entity/*.
- Async Operations: Optional 202 flows with /last_operation polling.
- Security: Basic Auth, Helmet headers, structured logging (Pino) with redaction.
- Health: /health endpoint (no auth).
- DX: Postman collection, pretty logs (pino-pretty), dev/prod PowerShell scripts.

-------------------------------------------------------------------------------
# QUICK START

## PREREQUISITES
- Node.js 18+ LTS
- PowerShell (for scripts/dev.ps1, scripts/run.ps1) on Windows

## INSTALL
$ git clone <repo>
$ cd radware-cap-osb
$ npm install
$ cp .env.sample .env
# edit .env with your actual values

-------------------------------------------------------------------------------
# RUN (DEVELOPMENT)
# Windows recommended
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> .\scripts\dev.ps1
# or npm
$ npm run dev | npm run logs:pretty

-------------------------------------------------------------------------------
# RUN (PRODUCTION)
> .\scripts\run.ps1
# or
$ npm run start:prod

-------------------------------------------------------------------------------
# CONFIGURATION
Environment variables (validated in src/config.js). Required are marked.

[.env]
  # Server
  PORT=8080
  NODE_ENV=development
  LOG_LEVEL=info

  # OSB Basic Auth (Required)
  BROKER_USER=__set__
  BROKER_PASS=__set__

  # Dashboard (Required, absolute URL w/o trailing slash)
  DASHBOARD_BASE=https://portal.example.com/cap

  # Radware Backend (Required)
  RADWARE_API_BASE=https://api-radwarecloud-app
  RADWARE_OPERATOR_KEY=__secret__
  RADWARE_TIMEOUT=10000
  RADWARE_RETRIES=3
  RADWARE_GATEWAY_ROLEID=rol_DcbbYkJMtiZmAR45  # optional, sent as x-role-ids if present

  # OSB Behavior
  ENABLE_ASYNC=false

  # IBM Cloud (Optional)
  IBM_METERING_SERVICE_ID=
  IBM_METERING_API_KEY=

Tip: URLs must start with http:// or https:// (enforced). No trailing slashes.

-------------------------------------------------------------------------------
# API
All OSB routes require:
- Basic Auth (BROKER_USER / BROKER_PASS)
- Header X-Broker-API-Version: 2.12

[Endpoints]
  GET    /v2/catalog
          - Returns service/plan(s)

  PUT    /v2/service_instances/:instance_id
          - Provision (sync or async; async requires accepts_incomplete=true)

  GET    /v2/service_instances/:instance_id/last_operation?operation=<id>
          - Async polling: returns state in progress | succeeded | failed

  PATCH  /v2/service_instances/:instance_id
          - Update (calls Radware backend, then updates local store)

  DELETE /v2/service_instances/:instance_id
          - Deprovision (sync/async)

  PUT    /v2/service_instances/:id/service_bindings/:binding_id
          - Create binding (creates CONTACT user in Radware)

  DELETE /v2/service_instances/:id/service_bindings/:binding_id
          - Delete binding (deletes CONTACT user)

[Health (no auth)]
  GET /health  -> {"status":"ok", ...}

-------------------------------------------------------------------------------
# SERVICE CATALOG (DEFAULT)
- Service ID: cloud-application-protection-service
- Name: cloud-application-protection-service
- Display: Cloud Application Protection Service
- Plan(s): standard
- Bindable: true
- Plan Updateable: true

You can extend plans later (e.g., enterprise) and map to Radware payload in radwareApi.createService / updateServicePlan.

-------------------------------------------------------------------------------
# CURL EXAMPLES

# set credentials for convenience
$ export BROKER_USER="your-user"
$ export BROKER_PASS="your-pass"

[CATALOG]
$ curl -u $BROKER_USER:$BROKER_PASS \
  -H "X-Broker-API-Version: 2.12" \
  http://localhost:8080/v2/catalog

[PROVISION (SYNC)]
$ curl -u $BROKER_USER:$BROKER_PASS \
  -H "X-Broker-API-Version: 2.12" \
  -H "Content-Type: application/json" \
  -X PUT http://localhost:8080/v2/service_instances/inst-123 \
  -d '{
    "service_id": "cloud-application-protection-service",
    "plan_id": "standard",
    "parameters": {
      "customerName": "Acme Corp",
      "planType": "STANDARD"
    }
  }'

[PROVISION (ASYNC)]
$ curl -u $BROKER_USER:$BROKER_PASS \
  -H "X-Broker-API-Version: 2.12" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/v2/service_instances/inst-123?accepts_incomplete=true" \
  -X PUT -d '{
    "service_id": "cloud-application-protection-service",
    "plan_id": "standard",
    "parameters": { "customerName": "Acme Corp" }
  }'
# => { "operation": "provision-inst-123-<ts>", "dashboard_url": "..." }

# poll last_operation
$ curl -u $BROKER_USER:$BROKER_PASS \
  -H "X-Broker-API-Version: 2.12" \
  "http://localhost:8080/v2/service_instances/inst-123/last_operation?operation=provision-inst-123-<ts>"

[UPDATE INSTANCE (PATCH → PLAN CHANGE)]
$ curl -u $BROKER_USER:$BROKER_PASS \
  -H "X-Broker-API-Version: 2.12" \
  -H "Content-Type: application/json" \
  -X PATCH http://localhost:8080/v2/service_instances/inst-123 \
  -d '{
    "service_id": "cloud-application-protection-service",
    "plan_id": "standard",
    "parameters": { "environment": "staging" },
    "previous_values": { "plan_id": "standard" }
  }'
# Internally: broker calls radwareApi.updateServicePlan({ serviceId: <radwareServiceId>, newPlanId: plan_id, params })
# then updates its local store.

[CREATE BINDING (CONTACT USER)]
$ curl -u $BROKER_USER:$BROKER_PASS \
  -H "X-Broker-API-Version: 2.12" \
  -H "Content-Type: application/json" \
  -X PUT http://localhost:8080/v2/service_instances/inst-123/service_bindings/bind-1 \
  -d '{
    "service_id": "cloud-application-protection-service",
    "plan_id": "standard",
    "parameters": {
      "email": "user@acme.com",
      "firstName": "John",
      "lastName": "Doe"
    }
  }'

[DELETE BINDING]
$ curl -u $BROKER_USER:$BROKER_PASS \
  -H "X-Broker-API-Version: 2.12" \
  -X DELETE "http://localhost:8080/v2/service_instances/inst-123/service_bindings/bind-1?service_id=cloud-application-protection-service&plan_id=standard"

[DEPROVISION]
$ curl -u $BROKER_USER:$BROKER_PASS \
  -H "X-Broker-API-Version: 2.12" \
  -X DELETE "http://localhost:8080/v2/service_instances/inst-123?service_id=cloud-application-protection-service&plan_id=standard"

-------------------------------------------------------------------------------
# POSTMAN COLLECTION
- Import postman/Radware-CAP-OSB.postman_collection.json
- Variables: base_url, BROKER_USER, BROKER_PASS, instance_id, binding_id
- operation_id for /last_operation can be provision-{{instance_id}}-{{$timestamp}}
- All requests include X-Broker-API-Version: 2.12 (already in the collection).

-------------------------------------------------------------------------------
# ARCHITECTURE & CODE MAP
src/
  config.js           # env parsing + validation
  routes/
    osb.js            # OSB endpoints (catalog/provision/.../bindings)
  services/
    radwareApi.js     # Radware gateway client (accounts/users/services)
  store/
    memoryStore.js    # In-memory store (instances/bindings/operations)
  middlewares/
    basicAuth.js      # Basic authentication (constant-time compare, redacted logs)
  utils/
    logger.js         # Pino logger wrapper (deep redaction, error serialization)
scripts/
  dev.ps1             # Dev runner (dotenv load, sanity checks)
  run.ps1             # Prod runner (npm ci, env validation)
postman/
  Radware-CAP-OSB.postman_collection.json
server.js             # Express bootstrap + route wiring
.env.sample           # Configuration template

Persistence: Current store is in-memory. For production, replace with a DB (managed PostgreSQL) and migrations/DAO.

-------------------------------------------------------------------------------
# SECURITY
- Auth: Basic Auth on all OSB routes; /health is public.
- Version Gate: X-Broker-API-Version enforced to 2.12.
- Headers: Helmet enabled; add CSP if serving UI.
- Logging: Pino with secret redaction; safe error serialization.
- Transport: Use HTTPS in production (reverse proxy/ingress). If terminating TLS in-app, set SSL_CERT_FILE & SSL_KEY_FILE.

-------------------------------------------------------------------------------
# DEPLOYMENT (IBM HOSTING)
You: code, Postman, .env.sample, DB schema/migrations (if using DB), runbooks.
IBM (host): runtime (Node 18+), secrets, managed DB, HTTPS, logging, monitoring.

Steps:
  1) Provision env + secrets (BROKER_USER/PASS, RADWARE_*, DASHBOARD_BASE).
  2) npm ci → run with NODE_ENV=production.
  3) Front with HTTPS reverse proxy.
  4) Monitor 5xx rate & latency.
  5) (If DB) Create DB + run migrations before start.

-------------------------------------------------------------------------------
# TROUBLESHOOTING
- 412 Precondition Failed: Missing/invalid X-Broker-API-Version (2.12 required).
- 401/403: Invalid Basic Auth.
- 409 on provision/bind: Resource exists with different attributes (idempotency).
- 422: Another operation in progress; poll /last_operation.
- 5xx: Broker wraps Radware errors; check gateway + radwareApi logs.

Enable debug logs:
  LOG_LEVEL=debug npm run dev | npm run logs:pretty

-------------------------------------------------------------------------------
# ROADMAP
- Replace memoryStore with PostgreSQL (DDL + DAO).
- Expand plans & parameter validation.
- IBM metering integration.
- Negative tests in Postman (duplicate provision, non-existent plan, etc).

# Handoff Quick Start (IBM)
1. `npm ci` (or `npm ci --omit=dev` for production)
2. Set env vars as per `.env.sample`
3. `npm run start:prod` (or `node server.js`)
4. Verify: `GET /health` returns 200
5. Import Postman: `postman/Radware-CAP-OSB.postman_collection.json`
6. Tests (optional, mocked):
```bash
npm test
```
