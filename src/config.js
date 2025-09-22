/**
 * Configuration loader for Radware CAP OSB
 * - Loads environment variables (dotenv if present)
 * - Validates required settings
 * - Normalizes types (numbers/booleans/urls)
 */

// Load dotenv if present (both dev/prod); do not fail if missing
try { require('dotenv').config(); } catch (_) { /* optional */ }

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

  // Optional IBM metering/billing integration (not required for core OSB)
  ibm: {
    meteringServiceId: getEnv('IBM_METERING_SERVICE_ID', ''),
    meteringApiKey: getEnv('IBM_METERING_API_KEY', '')
  }
};

// Quick sanity checks (fail fast with actionable messages)
(function validate(config) {
  // Basic URLs must be absolute http(s)
  const urlLike = ['radware.apiBase', 'osb.dashboardBase'];
  for (const key of urlLike) {
    const val = key.split('.').reduce((o, k) => o && o[k], config);
    if (!/^https?:\/\/.+/i.test(val)) {
      throw new Error(`Invalid URL for ${key}: "${val}". Must start with http:// or https://`);
    }
  }

  if (config.port < 1 || config.port > 65535) {
    throw new Error(`PORT must be between 1 and 65535 (got ${config.port})`);
  }
})(config);

module.exports = config;
