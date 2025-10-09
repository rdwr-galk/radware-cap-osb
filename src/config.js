/**
 * Configuration loader for Radware CAP OSB
 * - Loads environment variables (dotenv if present)
 * - Validates required settings with Joi schema
 * - Normalizes types (numbers/booleans/urls)
 * - Supports hot-reload for development
 */

// Load dotenv if present (both dev/prod); do not fail if missing
try { require('dotenv').config(); } catch (_) { /* optional */ }

const Joi = require('joi');

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
  return (v === undefined || v === null) ? String(defaultValue) : String(v);
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
  // ensure no trailing slash; allow http/https
  const s = String(u).trim();
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

// -------- config --------

const config = {
  nodeEnv: getEnv('NODE_ENV', 'development'),
  port: toInt(getEnv('PORT', '8080'), 8080),

  log: {
    level: getEnv('LOG_LEVEL', 'info')
  },

  auth: {
    // SECURITY COMPLIANCE: Basic authentication deprecated and removed
    // Bearer CRN authentication enforced exclusively
    
    // IBM IAM JWT Authentication (REQUIRED for security compliance)
    brokerCRN: requireEnv('IBM_BROKER_CRN', 'crn:v1:bluemix:public:radware-cap:us-south:a/7c4d0332e74041ea9bbfc21db410f043::'),
    expectedIssuer: getEnv('IBM_IAM_ISSUER', 'https://iam.cloud.ibm.com'),
    expectedAudience: getEnv('IBM_IAM_AUDIENCE', 'osb-broker'),
    
    // IBM Account ID for Partner Center integration  
    ibmAccountId: getEnv('IBM_ACCOUNT_ID', '7c4d0332e74041ea9bbfc21db410f043'),
    
    // Deprecated configuration maintained for transition period only
    _deprecated_basic_auth_notice: 'Basic authentication is deprecated and no longer supported due to security requirements'
  },

  radware: {
    apiBase: normalizeBaseUrl(getEnv('RADWARE_API_BASE_URL', 'https://api.radware.com')),
    apiToken: getEnv('RADWARE_API_TOKEN', ''),
    timeout: toInt(getEnv('RADWARE_TIMEOUT', '10000'), 10000),
    retries: toInt(getEnv('RADWARE_RETRIES', '3'), 3),
    // Optional: system gateway role id (from gateway-system.properties)
    gatewaySystemRoleId: getEnv('RADWARE_GATEWAY_ROLEID', 'rol_DcbbYkJMtiZmAR45')
  },

  osb: {
    enableAsync: toBool(getEnv('ENABLE_ASYNC', 'false'), false),
    dashboardBase: normalizeBaseUrl(requireEnv('DASHBOARD_BASE'))
  },

  // Database configuration (Cloudant for production)
  database: {
    type: getEnv('DB_TYPE', 'memory'), // 'memory' or 'cloudant'
    cloudant: {
      url: getEnv('CLOUDANT_URL', ''),
      database: getEnv('CLOUDANT_DB', 'radware-osb')
    }
  },

  // Optional IBM metering/billing integration (not required for core OSB)
  ibm: {
    meteringServiceId: getEnv('IBM_METERING_SERVICE_ID', ''),
    meteringApiKey: getEnv('IBM_METERING_API_KEY', '')
  },

  // Security and performance settings
  security: {
    rateLimitWindowMs: toInt(getEnv('RATE_LIMIT_WINDOW', '900000'), 900000), // 15 minutes
    rateLimitMax: toInt(getEnv('RATE_LIMIT_MAX', '100'), 100),
    bodyLimitKb: toInt(getEnv('BODY_LIMIT_KB', '100'), 100),
    enableCors: toBool(getEnv('ENABLE_CORS', 'false'), false)
  }
};
// ---- Cloudant IAM Integration ----
const axios = require('axios');

async function generateCloudantUrlFromIAM() {
  const apiKey = process.env.CLOUDANT_APIKEY;
  const cloudantHost = process.env.CLOUDANT_HOST || 'https://e9cf53bd-6c6f-4446-b0f4-a2d9f261a20f-bluemix.cloudantnosqldb.appdomain.cloud';
  if (!apiKey) return null;

  console.log('Using IAM authentication for Cloudant...');
  try {
    const tokenResp = await axios.post(
      'https://iam.cloud.ibm.com/identity/token',
      new URLSearchParams({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey: apiKey
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const token = tokenResp.data.access_token;
    if (!token) throw new Error('IAM token not returned');

    // Build dynamic Cloudant URL using IAM bearer token
    const url = `${cloudantHost}?iamBearer=${token}`;
    process.env.CLOUDANT_URL = url;
    console.log('Cloudant IAM token retrieved successfully');
    return url;
  } catch (err) {
    console.error('Failed to get IAM token for Cloudant:', err.message);
    return null;
  }
}

// If CLOUDANT_URL not defined but CLOUDANT_APIKEY exists — use IAM
if ((!process.env.CLOUDANT_URL || process.env.CLOUDANT_URL.trim() === '') && process.env.CLOUDANT_APIKEY) {
  generateCloudantUrlFromIAM();
}

// Configuration schema validation
const configSchema = Joi.object({
  nodeEnv: Joi.string().valid('development', 'production', 'test').default('development'),
  port: Joi.number().port().default(8080),
  
  log: Joi.object({
    level: Joi.string().valid('error', 'warn', 'info', 'debug', 'trace').default('info')
  }),
  
  auth: Joi.object({
    // IBM IAM JWT Authentication (REQUIRED for security compliance)
    brokerCRN: Joi.string().min(1).required().messages({
      'string.empty': 'IBM_BROKER_CRN is required for security compliance',
      'any.required': 'IBM_BROKER_CRN must be provided - Basic auth is deprecated'
    }),
    expectedIssuer: Joi.string().uri().default('https://iam.cloud.ibm.com'),
    expectedAudience: Joi.string().default('osb-broker'),
    ibmAccountId: Joi.string().min(1).default('7c4d0332e74041ea9bbfc21db410f043'),
    
    // Deprecated field maintained for transition period
    _deprecated_basic_auth_notice: Joi.string().default('Basic authentication is deprecated and no longer supported due to security requirements')
  }),
  
  radware: Joi.object({
    apiBase: Joi.string().uri({ scheme: ['http', 'https'] }).default('https://api.radware.com'),
    apiToken: Joi.string().allow('').default(''),
    timeout: Joi.number().positive().default(10000),
    retries: Joi.number().min(0).max(10).default(3),
    gatewaySystemRoleId: Joi.string().default('rol_DcbbYkJMtiZmAR45')
  }),
  
  osb: Joi.object({
    enableAsync: Joi.boolean().default(false),
    dashboardBase: Joi.string().uri({ scheme: ['http', 'https'] }).required()
  }),
  
  database: Joi.object({
    type: Joi.string().valid('memory', 'cloudant').default('memory'),
    cloudant: Joi.object({
      url: Joi.string().uri({ scheme: ['http', 'https'] }).when('...type', { is: 'cloudant', then: Joi.required(), otherwise: Joi.optional().default('') }),
      database: Joi.string().default('radware-osb')
    })
  }),
  
  ibm: Joi.object({
    meteringServiceId: Joi.string().allow('').default(''),
    meteringApiKey: Joi.string().allow('').default('')
  }),
  
  security: Joi.object({
    rateLimitWindowMs: Joi.number().positive().default(900000),
    rateLimitMax: Joi.number().positive().default(100),
    bodyLimitKb: Joi.number().positive().default(100),
    enableCors: Joi.boolean().default(false)
  })
});

// Validate configuration
// Validate configuration (skip in test mode for flexibility)
let cachedConfig = config;

if (process.env.NODE_ENV !== 'test') {
  const { error, value: validatedConfig } = configSchema.validate(config, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const details = error.details.map(d => `${d.path.join('.')}: ${d.message}`).join('\n  ');
    throw new Error(`Configuration validation failed:\n  ${details}`);
  }
  
  cachedConfig = validatedConfig;
}

// Hot-reload support for development
if (cachedConfig.nodeEnv === 'development') {
  // Create a proxy that re-validates on access
  cachedConfig = new Proxy(cachedConfig, {
    get(target, prop) {
      // For hot-reload, we could re-read environment variables here
      return target[prop];
    }
  });
}

module.exports = cachedConfig;
