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
    console.warn('⚠️  No CLOUDANT_APIKEY found, skipping IAM setup');
    return;
  }

  // Check if CLOUDANT_URL already has IAM bearer token
  const existingUrl = process.env.CLOUDANT_URL;
  if (existingUrl && existingUrl.includes('iamBearer=')) {
    console.log('✅ CLOUDANT_URL already contains IAM bearer token');
    return;
  }

  // Use existing URL as base host if provided, otherwise use default host  
  const baseHost = existingUrl || cloudantHost;

  console.log('🔐 Requesting IAM token for Cloudant...');
  try {
    // For development/testing environments with corporate firewalls, allow self-signed certificates
    const axiosConfig = { 
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000 // 10 second timeout for IAM token request
    };
    
    // In non-production environments, disable SSL verification if needed
    if (process.env.NODE_ENV !== 'production' || process.env.DISABLE_SSL_VERIFY === 'true') {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      console.log('⚠️  SSL certificate verification disabled for development');
    }

    const tokenResp = await axios.post(
      'https://iam.cloud.ibm.com/identity/token',
      new URLSearchParams({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey: apiKey,
      }),
      axiosConfig
    );

    const token = tokenResp.data.access_token;
    if (!token) throw new Error('IAM token not returned');
    
    // Extract base host without any query parameters
    const cleanHost = baseHost.split('?')[0];
    const url = `${cleanHost}?iamBearer=${token}`;
    process.env.CLOUDANT_URL = url;
    
    console.log('✅ Cloudant IAM token retrieved successfully');
    console.log(`🔗 Cloudant URL configured for host: ${cleanHost}`);
  } catch (err) {
    console.error('❌ Failed to get IAM token for Cloudant:', err.message);
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      console.error('   Network connectivity issue - check internet connection');
    } else if (err.response?.status === 400) {
      console.error('   Invalid API key - verify CLOUDANT_APIKEY environment variable');
    }
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
      // For testing without real Radware API access
      mockMode: toBool(getEnv('RADWARE_MOCK_MODE', 'false'), false),
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
      // allow empty temporarily; IAM flow will populate URL
      url: Joi.string().allow('').optional().default(''),
      database: Joi.string().default('radware-osb')
    })
  })
}).unknown(true);

  const { error } = schema.validate(config, { abortEarly: false });

  if (error) {
    const details = error.details.map(d => `${d.path.join('.')}: ${d.message}`).join('\n  ');
    throw new Error(`Configuration validation failed:\n  ${details}`);
  }

  return config;
}

module.exports = loadConfig;
