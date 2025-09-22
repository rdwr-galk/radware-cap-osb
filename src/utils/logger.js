/**
 * Structured logger for Radware CAP OSB
 * - Uses pino for structured logging
 * - Aggressive redaction of secrets (keys/tokens/passwords)
 * - Safe error serialization (no raw Error objects)
 */

const pino = require('pino');

// Keywords that indicate sensitive values (case-insensitive, substring match)
const SENSITIVE_FIELDS = [
  'password',
  'pass',
  'secret',
  'token',
  'key',
  'authorization',
  'x-api-key',
  'radware_operator_key',
  'broker_pass',
  'ibm_metering_api_key'
];

// Explicit redaction paths for common locations (pino native redact)
const SENSITIVE_PATHS = [
  // top-level
  'password',
  'pass',
  'secret',
  'token',
  'authorization',
  'radware_operator_key',
  'broker_pass',
  'ibm_metering_api_key',
  // HTTP headers (req/res)
  'headers.authorization',
  'req.headers.authorization',
  'request.headers.authorization'
];

// Max length for huge string fields to avoid log bloat (e.g., stack traces are fine, payloads are not)
const MAX_STRING_LEN = 10_000;

/**
 * Trim long strings so logs stay reasonable in size.
 */
function trimLongStrings(value) {
  if (typeof value === 'string' && value.length > MAX_STRING_LEN) {
    return value.slice(0, MAX_STRING_LEN) + '…[truncated]';
  }
  return value;
}

/**
 * Convert Error to a safe, structured object.
 */
function serializeError(err) {
  const e = {
    type: err.name || 'Error',
    message: err.message,
    stack: err.stack
  };
  // Include enumerable custom props (redacted)
  for (const k of Object.keys(err)) {
    if (!(k in e)) e[k] = redactSensitive(err[k]);
  }
  return e;
}

/**
 * Deep redaction by key-name match (substring, case-insensitive).
 * Used instead of pino's built-in path-based redact.
 */
function redactSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  if (obj instanceof Error) {
    // Normalize Error -> plain object safely (do not mutate the Error)
    return serializeError(obj);
  }

  if (Array.isArray(obj)) return obj.map(redactSensitive);

  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_FIELDS.some((field) => lowerKey.includes(field));

    if (isSensitive) {
      out[key] = '[REDACTED]';
      continue;
    }

    if (value && typeof value === 'object') {
      out[key] = redactSensitive(value);
    } else {
      out[key] = trimLongStrings(value);
    }
  }
  return out;
}

// Base logger (with native path-based redaction)
const logger = pino({
  name: 'radware-cap-osb',
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label })
  },
  redact: {
    paths: SENSITIVE_PATHS,
    censor: '[REDACTED]'
  }
});

/**
 * Wrap pino methods to:
 * 1) accept (obj, msg, ...args) like pino,
 * 2) deep-redact objects by sensitive key substrings,
 * 3) normalize Error instances.
 */
function wrapLogger(base) {
  const wrapped = {};
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
    wrapped[level] = (obj, msg, ...args) => {
      // Support calling with (msg, ...args)
      if (typeof obj === 'string') {
        return base[level](obj, ...[msg, ...args].filter((v) => v !== undefined));
      }

      // If first arg is an Error, serialize it under "err"
      if (obj instanceof Error) {
        return base[level]({ err: serializeError(obj) }, msg, ...args);
      }

      // If it's a plain object, redact it; also normalize nested Errors
      if (obj && typeof obj === 'object') {
        const safeObj = redactSensitive(obj);
        return base[level](safeObj, msg, ...args);
      }

      // Fallback
      return base[level](obj, msg, ...args);
    };
  }

  wrapped.child = (bindings) => {
    const safeBindings = redactSensitive(bindings || {});
    const child = base.child(safeBindings);
    return wrapLogger(child);
  };

  return wrapped;
}

module.exports = wrapLogger(logger);
