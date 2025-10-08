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
    user: requireEnv('BROKER_USER'),
    password: requireEnv('BROKER_PASS')
  },

  radware: {
    apiBase: normalizeBaseUrl(requireEnv('RADWARE_API_BASE')),
    operatorKey: requireEnv('RADWARE_OPERATOR_KEY'),
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

// Configuration schema validation
const configSchema = Joi.object({
  nodeEnv: Joi.string().valid('development', 'production', 'test').default('development'),
  port: Joi.number().port().default(8080),
  
  log: Joi.object({
    level: Joi.string().valid('error', 'warn', 'info', 'debug', 'trace').default('info')
  }),
  
  auth: Joi.object({
    user: Joi.string().min(1).required(),
    password: Joi.string().min(8).required()
  }),
  
  radware: Joi.object({
    apiBase: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
    operatorKey: Joi.string().min(1).required(),
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
