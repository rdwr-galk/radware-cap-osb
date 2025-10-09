/**
 * Radware CAP Open Service Broker v2.12
 * Main Express application server
 */

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const loadConfig = require('./src/config');
const configPromise = loadConfig();
configPromise.then(config => {
  const app = require('./app')(config);
  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}).catch(err => {
  console.error('Failed to load configuration:', err.message);
  process.exit(1);
});
const logger = require('./src/utils/logger');
const { securityCompliantAuth } = require('./src/middlewares/ibmAuth');
const osbRoutes = require('./src/routes/osb');
const { initializeTracing, tracingMiddleware } = require('./middleware/tracing');
const { httpLoggingMiddleware, errorLoggingMiddleware, setupGracefulShutdown } = require('./middleware/logging');

const { version } = require('./package.json');

// Initialize store based on configuration
let store;
if (config.database.type === 'cloudant') {
  store = require('./src/store/cloudantStore');
  logger.info('Using Cloudant database store');
} else {
  store = require('./src/store/memoryStore');
  logger.info('Using in-memory store (development only)');
}

// Make store available to routes
global.osbStore = store;

const app = express();

// Initialize tracing before other middleware
initializeTracing();

// If running behind reverse proxy/ingress (common in hosting), trust proxy
app.set('trust proxy', true);

// Security and performance middleware
app.use(compression()); // Gzip compression
app.use(
  helmet({
    contentSecurityPolicy: false // no UI served; keep CSP off to avoid accidental breaks
  })
);
app.disable('x-powered-by');

// CORS (if enabled)
if (config.security.enableCors) {
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Broker-API-Version', 'X-Broker-API-Originating-Identity']
  }));
}

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.rateLimitMax,
  message: {
    error: 'TooManyRequests',
    description: 'Too many requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/metrics';
  }
});

app.use(limiter);

// Tracing middleware
app.use(tracingMiddleware());

// HTTP request logging middleware
app.use(httpLoggingMiddleware());

// Request correlation + request/response logging
app.use((req, res, next) => {
  const rid =
    req.headers['x-correlation-id'] ||
    (global.crypto?.randomUUID ? global.crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  req.correlationId = String(rid);
  res.setHeader('X-Correlation-Id', req.correlationId);

  const start = process.hrtime.bigint();

  logger.info(
    {
      correlationId: req.correlationId,
      method: req.method,
      path: req.originalUrl || req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    },
    'Incoming request'
  );

  res.on('finish', () => {
    const durMs = Number((process.hrtime.bigint() - start) / 1000000n);
    logger.info(
      {
        correlationId: req.correlationId,
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs: durMs
      },
      'Request completed'
    );
  });

  next();
});

// Body parsing (configurable size limits)
const bodyLimit = `${config.security.bodyLimitKb}kb`;
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// Enhanced health check endpoint (no auth required)
app.get('/health', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  
  const startTime = Date.now();
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'radware-cap-osb',
    version,
    uptime: Math.floor(process.uptime()),
    checks: {
      database: 'unknown',
      radware: 'unknown',
      memory: 'ok'
    }
  };

  const issues = [];

  try {
    // Memory usage check
    const memUsage = process.memoryUsage();
    const totalMem = memUsage.heapTotal / 1024 / 1024; // MB
    const usedMem = memUsage.heapUsed / 1024 / 1024; // MB
    const memPercent = (usedMem / totalMem) * 100;
    
    health.checks.memory = {
      status: memPercent > 90 ? 'critical' : memPercent > 75 ? 'warning' : 'ok',
      heapUsed: Math.round(usedMem),
      heapTotal: Math.round(totalMem),
      percentage: Math.round(memPercent)
    };

    // Database connectivity check
    try {
      if (config.database.type === 'cloudant') {
        const startDb = Date.now();
        const dbConnected = await store.ping();
        const dbLatency = Date.now() - startDb;
        
        if (dbConnected) {
          health.checks.database = {
            status: 'ok',
            type: 'cloudant',
            latency: dbLatency,
            database: config.database.cloudant.database
          };
        } else {
          health.checks.database = { status: 'failed', type: 'cloudant' };
          issues.push('Database connection failed');
        }
      } else {
        health.checks.database = { status: 'ok', type: 'memory' };
      }
    } catch (error) {
      health.checks.database = { status: 'error', error: error.message };
      issues.push(`Database error: ${error.message}`);
    }

    // Radware API connectivity check
    try {
      const startApi = Date.now();
      const radwareApi = require('./src/services/radwareApi');
      const apiReachable = await radwareApi.ping();
      const apiLatency = Date.now() - startApi;
      
      if (apiReachable) {
        health.checks.radware = {
          status: 'ok',
          endpoint: config.radware.apiBase,
          latency: apiLatency
        };
      } else {
        health.checks.radware = { 
          status: 'failed', 
          endpoint: config.radware.apiBase 
        };
        issues.push('Radware API unreachable');
      }
    } catch (error) {
      health.checks.radware = { 
        status: 'error', 
        endpoint: config.radware.apiBase,
        error: error.message 
      };
      issues.push(`Radware API error: ${error.message}`);
    }

    // Calculate total response time
    health.responseTime = Date.now() - startTime;

    // Determine overall status
    const criticalIssues = Object.values(health.checks).filter(
      check => check.status === 'failed' || check.status === 'error'
    );
    
    if (criticalIssues.length > 0) {
      health.status = 'degraded';
      health.issues = issues;
      return res.status(503).json(health);
    }

    const warningIssues = Object.values(health.checks).filter(
      check => check.status === 'warning'
    );
    
    if (warningIssues.length > 0) {
      health.status = 'warning';
      health.warnings = issues;
    }

    res.status(200).json(health);
  } catch (error) {
    logger.error({ error: error.message }, 'Health check failed');
    health.status = 'error';
    res.status(503).json(health);
  }
});

// Prometheus metrics endpoint (no auth required)
app.get('/metrics', (req, res) => {
  const prometheus = require('./metrics/prometheus');
  return prometheus.getMetrics(req, res);
});

// Apply Security Compliant Authentication - Bearer CRN ONLY
// Basic authentication is deprecated and no longer supported due to security requirements
app.use('/v2', securityCompliantAuth());

// OSB API routes
app.use('/v2', osbRoutes);

// 404 handler (after all routes)
app.use((req, res) => {
  logger.warn(
    {
      correlationId: req.correlationId,
      path: req.originalUrl,
      method: req.method
    },
    'Route not found'
  );

  res.status(404).json({
    description: 'Not Found'
  });
});

// JSON/body parse error handler (before generic error handler)
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    logger.warn(
      { correlationId: req.correlationId, error: err.message },
      'Payload too large'
    );
    return res.status(413).json({ description: 'Payload too large' });
  }
  if (err && err instanceof SyntaxError && 'body' in err) {
    logger.warn(
      { correlationId: req.correlationId, error: err.message },
      'Invalid JSON payload'
    );
    return res.status(400).json({ description: 'Invalid JSON payload' });
  }
  return next(err);
});

// Error logging middleware
app.use(errorLoggingMiddleware());

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const correlationId = req.correlationId || 'unknown';

  logger.error(
    {
      correlationId,
      error: err && err.message,
      stack: err && err.stack,
      path: req.originalUrl || req.url,
      method: req.method
    },
    'Unhandled error'
  );

  const description =
    process.env.NODE_ENV === 'production' ? 'Internal Server Error' : (err && err.message) || 'Error';

  res.status(err && err.status ? err.status : 500).json({ description });
});

let server;

//  Graceful shutdown function
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  
  if (server) {
    server.close((err) => {
      if (err) {
        logger.error({ error: err.message }, 'Error during server close');
        process.exit(1);
      }
      logger.info('Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

//  Attach signal handlers early
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

//  Start server
const PORT = config.port;

if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    logger.info(
      { 
        port: PORT, 
        environment: process.env.NODE_ENV || 'development',
        storeType: config.database.type
      },
      'Radware CAP OSB server started'
    );
  });
}

//  Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled promise rejection');
  process.exit(1);
});

module.exports = app;