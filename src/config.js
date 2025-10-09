/**
 * Configuration loader for Radware CAP OSB
 * - Loads environment variables (dotenv if present)
 * - Validates required settings with Joi schema
 * - Normalizes types (numbers/booleans/urls)
 * - Supports hot-reload for development
 */

try { require('dotenv').config(); } catch (_) { /* optional */ }

const Joi = require('joi');
const axios = require('axios');

// ---- Cloudant IAM Integration ----
async function generateCloudantUrlFromIAM() {
  const apiKey = process.env.CLOUDANT_APIKEY;
  const cloudantHost =
    process.env.CLOUDANT_HOST ||
    'https://e9cf53bd-6c6f-4446-b0f4-a2d9f261a20f-bluemix.cloudantnosqldb.appdomain.cloud';
  if (!apiKey) return null;

  console.log('Using IAM authentication for Cloudant...');
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
    return url;
  } catch (err) {
    console.error(' Failed to get IAM token for Cloudant:', err.message);
    return null;
  }
}

// ensure Cloudant URL exists before config validation
(async () => {
  if (
    (!process.env.CLOUDANT_URL || process.env.CLOUDANT_URL.trim() === '') &&
    process.env.CLOUDANT_APIKEY
  ) {
    await generateCloudantUrlFromIAM();
  }
})();

// -------- helpers --------

function requireEnv(name, defaultValue = null) {
  const v = process.env[name] ?? defaultValue;
  if (v === null || v === undefined || String(v).trim() === '') {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return String(v);
}

function getEnv(name, defaultValue = '') {
  const v = process.env[name];
  return v === undefined || v === null ? String(defaultValue) : String(v);
}

function toInt(val, fallback) {
  const n = parseInt(String(val), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(val, fallback = false) {
  if (val === true || val === false) return val;
  const s = String(val).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return fallback;
}

function normalizeBaseUrl(u) {
  const s = String(u).trim();
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

// -------- config --------

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
    apiBase: normalizeBaseUrl(
      getEnv('RADWARE_API_BASE_URL', 'https://api.radware.com')
    ),
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
    type: getEnv('DB_TYPE', 'memory'),
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

// -------- validation --------

const configSchema = Joi.object({
  nodeEnv: Joi.string().valid('development', 'production', 'test').default('development'),
  port: Joi.number().port().default(8080),

  log: Joi.object({
    level: Joi.string().valid('error', 'warn', 'info', 'debug', 'trace').default('info'),
  }),

  auth: Joi.object({
    brokerCRN: Joi.string().min(1).required(),
    expectedIssuer: Joi.string().uri().default('https://iam.cloud.ibm.com'),
    expectedAudience: Joi.string().default('osb-broker'),
    ibmAccountId: Joi.string().min(1).default('7c4d0332e74041ea9bbfc21db410f043'),
  }),

  radware: Joi.object({
    apiBase: Joi.string().uri({ scheme: ['http', 'https'] }),
    apiToken: Joi.string().allow(''),
    timeout: Joi.number().positive(),
    retries: Joi.number().min(0).max(10),
    gatewaySystemRoleId: Joi.string(),
  }),

  osb: Joi.object({
    enableAsync: Joi.boolean(),
    dashboardBase: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  }),

  database: Joi.object({
    type: Joi.string().valid('memory', 'cloudant'),
    cloudant: Joi.object({
      url: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .when('...type', { is: 'cloudant', then: Joi.required() }),
      database: Joi.string(),
    }),
  }),

  ibm: Joi.object({
    meteringServiceId: Joi.string().allow(''),
    meteringApiKey: Joi.string().allow(''),
  }),

  security: Joi.object({
    rateLimitWindowMs: Joi.number().positive(),
    rateLimitMax: Joi.number().positive(),
    bodyLimitKb: Joi.number().positive(),
    enableCors: Joi.boolean(),
  }),
});

// -------- apply validation --------
let cachedConfig = config;

if (process.env.NODE_ENV !== 'test') {
  const { error, value } = configSchema.validate(config, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const details = error.details
      .map((d) => `${d.path.join('.')}: ${d.message}`)
      .join('\n  ');
    throw new Error(`Configuration validation failed:\n  ${details}`);
  }

  cachedConfig = value;
}

// Hot-reload for development
if (cachedConfig.nodeEnv === 'development') {
  cachedConfig = new Proxy(cachedConfig, {
    get(target, prop) {
      return target[prop];
    },
  });
}

module.exports = cachedConfig;
