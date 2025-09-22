/**
 * Radware CAP Open Service Broker v2.12
 * Main Express application server
 */

const express = require('express');
const helmet = require('helmet');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const basicAuthMiddleware = require('./src/middlewares/basicAuth');
const osbRoutes = require('./src/routes/osb');

const { version } = require('./package.json');

const app = express();

// If running behind reverse proxy/ingress (common in hosting), trust proxy
app.set('trust proxy', true);

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false // no UI served; keep CSP off to avoid accidental breaks
  })
);
app.disable('x-powered-by');

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

// Body parsing (explicit size limits)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'radware-cap-osb',
    version
  });
});

// Apply basic auth middleware to all v2 routes
app.use('/v2', basicAuthMiddleware);

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
// Start server (don't open a port during tests)
const PORT = config.port;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(
      { port: PORT, environment: process.env.NODE_ENV || 'development' },
      'Radware CAP OSB server started'
    );
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;

