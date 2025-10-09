/**
 * Async Configuration loader for Radware CAP OSB
 * Supports IBM Cloudant IAM token generation before validation
 */

try { require('dotenv').config(); } catch (_) {}

const Joi = require('joi');
const axios = require('axios');

// --------- Cloudant IAM integration ---------
async function ensureCloudantUrl() {
  const apiKey = process.env.CLOUDANT_APIKEY;
  const cloudantHost =
    process.env.CLOUDANT_HOST ||
    'https://e9cf53bd-6c6f-4446-b0f4-a2d9f261a20f-bluemix.cloudantnosqldb.appdomain.cloud';

  if (!apiKey) {
    console.warn(' No CLOUDANT_APIKEY found, skipping IAM setup');
    return;
  }

  if (process.env.CLOUDANT_URL && process.env.CLOUDANT_URL.trim() !== '') {
    return;
  }

  console.log('Requesting IAM token for Cloudant...');
  try {
    const tokenResp = await axios.post(
      'https://iam.cloud.ibm.com/identity/token',
      new URLSearchParams({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey: apiKey,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const token = tokenResp.data.access_token;
    if (!token) throw new Error('IAM token not returned');
    const url = `${cloudantHost}?iamBearer=${token}`;
    process.env.CLOUDANT_URL = url;
    console.log(' Cloudant IAM token retrieved successfully');
  } catch (err) {
    console.error(' Failed to get IAM token for Cloudant:', err.message);
  }
}

// --------- Helpers ---------
function requireEnv(name, def = null) {
  const v = process.env[name] ?? def;
  if (!v || String(v).trim() === '') {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return String(v);
}

function getEnv(name, def = '') {
  const v = process.env[name];
  return v === undefined || v === null ? String(def) : String(v);
}

function toInt(v, f) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : f;
}

function toBool(v, f = false) {
  if (v === true || v === false) return v;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return f;
}

function normalizeBaseUrl(u) {
  const s = String(u).trim();
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

// --------- Main async config loader ---------
async function loadConfig() {
  await ensureCloudantUrl();

  const config = {
    nodeEnv: getEnv('NODE_ENV', 'development'),
    port: toInt(getEnv('PORT', '8080'), 8080),

    log: { level: getEnv('LOG_LEVEL', 'info') },

    auth: {
      brokerCRN: requireEnv(
        'IBM_BROKER_CRN',
        'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::'
      ),
      expectedIssuer: getEnv('IBM_IAM_ISSUER', 'https://iam.cloud.ibm.com'),
      expectedAudience: getEnv('IBM_IAM_AUDIENCE', 'osb-broker'),
      ibmAccountId: getEnv('IBM_ACCOUNT_ID', '7c4d0332e74041ea9bbfc21db410f043'),
    },

    radware: {
      apiBase: normalizeBaseUrl(getEnv('RADWARE_API_BASE_URL', 'https://api.radware.com')),
      apiToken: getEnv('RADWARE_API_TOKEN', ''),
      timeout: toInt(getEnv('RADWARE_TIMEOUT', '10000'), 10000),
      retries: toInt(getEnv('RADWARE_RETRIES', '3'), 3),
      gatewaySystemRoleId: getEnv('RADWARE_GATEWAY_ROLEID', 'rol_DcbbYkJMtiZmAR45'),
    },

    osb: {
      enableAsync: toBool(getEnv('ENABLE_ASYNC', 'false'), false),
      dashboardBase: normalizeBaseUrl(requireEnv('DASHBOARD_BASE')),
    },

    database: {
      type: getEnv('DB_TYPE', 'cloudant'),
      cloudant: {
        url: getEnv('CLOUDANT_URL', ''),
        database: getEnv('CLOUDANT_DB', 'radware-osb'),
      },
    },

    ibm: {
      meteringServiceId: getEnv('IBM_METERING_SERVICE_ID', ''),
      meteringApiKey: getEnv('IBM_METERING_API_KEY', ''),
    },

    security: {
      rateLimitWindowMs: toInt(getEnv('RATE_LIMIT_WINDOW', '900000'), 900000),
      rateLimitMax: toInt(getEnv('RATE_LIMIT_MAX', '100'), 100),
      bodyLimitKb: toInt(getEnv('BODY_LIMIT_KB', '100'), 100),
      enableCors: toBool(getEnv('ENABLE_CORS', 'false'), false),
    },
  };

  // --------- Validation ---------
  const schema = Joi.object({
    database: Joi.object({
      type: Joi.string().valid('memory', 'cloudant').default('memory'),
      cloudant: Joi.object({
        url: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
        database: Joi.string().required(),
      }),
    }),
  }).unknown(true);

  const { error } = schema.validate(config, { abortEarly: false });

  if (error) {
    const details = error.details.map(d => `${d.path.join('.')}: ${d.message}`).join('\n  ');
    throw new Error(`Configuration validation failed:\n  ${details}`);
  }

  return config;
}

module.exports = loadConfig;
