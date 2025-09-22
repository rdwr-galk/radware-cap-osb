# Radware CAP OSB – IBM Handoff

## Overview
Node.js (Express) Open Service Broker for Radware Cloud Application Protection (CAP/CWAF), compliant with OSB API v2.12. This package includes the broker, Postman collection, environment template, and optional containerization.

## Runtime Requirements
- Node.js 18+ LTS
- Outbound HTTPS to Radware API gateway
- PORT available (default 8080)

## Environment Variables (required)
- `BROKER_USER`, `BROKER_PASS`
- `RADWARE_API_BASE`, `RADWARE_OPERATOR_KEY`
- `DASHBOARD_BASE`

See `.env.sample` for the full list.

## Run (Development)
```bash
npm ci
npm run dev
# Health:
curl http://localhost:8080/health
```

## Run (Production-like)
```bash
npm ci --omit=dev
NODE_ENV=production PORT=8080 node server.js
# or
npm run start:prod
```

## OSB Endpoints
- `GET /v2/catalog`
- `PUT /v2/service_instances/:id`
- `GET /v2/service_instances/:id/last_operation?operation=...`
- `PATCH /v2/service_instances/:id`
- `DELETE /v2/service_instances/:id`
- `PUT /v2/service_instances/:id/service_bindings/:binding_id`
- `DELETE /v2/service_instances/:id/service_bindings/:binding_id`

Headers: `X-Broker-API-Version: 2.12`
Auth: Basic (`BROKER_USER`/`BROKER_PASS`)

## Postman
Import: `postman/Radware-CAP-OSB.postman_collection.json`
Set variables: `base_url`, `BROKER_USER`, `BROKER_PASS`, `instance_id`, `binding_id`, etc.

## Tests (kept in repo)
```bash
npm test
# or
npx jest --runInBand
```
Tests are mocked (Nock) and do not call Radware.

## Docker (optional)
Build & run:

```bash
docker build -t radware-cap-osb:handoff .
docker run --rm -p 8080:8080 \
  -e BROKER_USER=__set__ \
  -e BROKER_PASS=__set__ \
  -e RADWARE_API_BASE=https://your-radware-api.com \
  -e RADWARE_OPERATOR_KEY=__secret__ \
  -e DASHBOARD_BASE=https://portal.example.com/cap \
  radware-cap-osb:handoff
```

## Operational Notes
- `/health` is unauthenticated.
- Broker enforces `X-Broker-API-Version: 2.12`.
- Logs: JSON via Pino; set `LOG_LEVEL=debug` for troubleshooting.

## Handoff Checklist
- ✅ `.env.sample` contains all required envs (no secrets).
- ✅ Postman collection included.
- ✅ `npm ci --omit=dev` starts successfully with valid envs.
- ✅ Tests present and runnable (mocked).
- ✅ Dockerfile provided (optional).