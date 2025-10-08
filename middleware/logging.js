const winston = require('winston');
const path = require('path');

// Define log levels and colors
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6
};

const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'grey',
  debug: 'white',
  silly: 'grey'
};

winston.addColors(logColors);

// Custom format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message} ${
      info.stack ? `\n${info.stack}` : ''
    } ${Object.keys(info).length > 3 ? JSON.stringify(info, null, 2) : ''}`
  )
);

// Determine log level based on environment
const getLogLevel = () => {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level && logLevels.hasOwnProperty(level)) {
    return level;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
};

// Create transports array
const createTransports = () => {
  const transports = [];

  // Console transport (always enabled)
  transports.push(
    new winston.transports.Console({
      level: getLogLevel(),
      format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
    })
  );

  // File transports for production
  if (process.env.NODE_ENV === 'production') {
    const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

    // Combined logs
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        level: 'info',
        format: logFormat,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      })
    );

    // Error logs
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: logFormat,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      })
    );

    // HTTP access logs
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'access.log'),
        level: 'http',
        format: logFormat,
        maxsize: 10485760, // 10MB
        maxFiles: 10,
      })
    );
  }

  return transports;
};

// Create logger instance
const logger = winston.createLogger({
  level: getLogLevel(),
  levels: logLevels,
  format: logFormat,
  transports: createTransports(),
  exitOnError: false,
});

// OSB-specific logging helpers
const logOSBOperation = (operation, data = {}) => {
  logger.info(`OSB Operation: ${operation}`, {
    operation,
    timestamp: new Date().toISOString(),
    ...data,
  });
};

const logOSBError = (operation, error, data = {}) => {
  logger.error(`OSB Operation Failed: ${operation}`, {
    operation,
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    ...data,
  });
};

const logHTTPRequest = (req, res, responseTime) => {
  const logData = {
    method: req.method,
    url: req.originalUrl || req.url,
    statusCode: res.statusCode,
    responseTime: `${responseTime}ms`,
    userAgent: req.get('User-Agent') || '',
    ip: req.ip || req.connection.remoteAddress || '',
    timestamp: new Date().toISOString(),
  };

  // Add OSB-specific data if present
  if (req.path?.startsWith('/v2/')) {
    logData.osbOperation = getOSBOperationFromPath(req.path, req.method);
    logData.serviceId = req.query.service_id || req.body?.service_id;
    logData.planId = req.query.plan_id || req.body?.plan_id;
    logData.instanceId = req.params?.instance_id;
    logData.bindingId = req.params?.binding_id;
  }

  logger.http('HTTP Request', logData);
};

const logCloudantOperation = (operation, details = {}) => {
  logger.info(`Cloudant Operation: ${operation}`, {
    operation,
    database: details.database,
    documentId: details.documentId,
    timestamp: new Date().toISOString(),
    ...details,
  });
};

const logCloudantError = (operation, error, details = {}) => {
  logger.error(`Cloudant Operation Failed: ${operation}`, {
    operation,
    error: error.message,
    statusCode: error.statusCode,
    database: details.database,
    documentId: details.documentId,
    timestamp: new Date().toISOString(),
    ...details,
  });
};

// Helper function to determine OSB operation from path and method
function getOSBOperationFromPath(pathname, method) {
  const pathParts = pathname.split('/');
  
  if (pathname === '/v2/catalog') {
    return 'get_catalog';
  }
  
  if (pathParts.length >= 4 && pathParts[2] === 'service_instances') {
    const operation = method.toUpperCase();
    switch (operation) {
      case 'PUT': return 'provision_service_instance';
      case 'PATCH': return 'update_service_instance';
      case 'DELETE': return 'deprovision_service_instance';
      case 'GET': return 'get_service_instance';
      default: return 'service_instance_operation';
    }
  }
  
  if (pathParts.length >= 6 && pathParts[4] === 'service_bindings') {
    const operation = method.toUpperCase();
    switch (operation) {
      case 'PUT': return 'bind_service';
      case 'DELETE': return 'unbind_service';
      case 'GET': return 'get_service_binding';
      default: return 'service_binding_operation';
    }
  }
  
  if (pathname.includes('/last_operation')) {
    return 'get_last_operation';
  }
  
  return 'unknown_osb_operation';
}

// Express middleware for HTTP request logging
const httpLoggingMiddleware = () => {
  return (req, res, next) => {
    const start = Date.now();
    
    // Hook into response finish event
    res.on('finish', () => {
      const responseTime = Date.now() - start;
      logHTTPRequest(req, res, responseTime);
    });
    
    next();
  };
};

// Error logging middleware
const errorLoggingMiddleware = () => {
  return (err, req, res, next) => {
    // Log the error
    logger.error('Express Error', {
      error: err.message,
      stack: err.stack,
      url: req.originalUrl || req.url,
      method: req.method,
      ip: req.ip || req.connection.remoteAddress || '',
      userAgent: req.get('User-Agent') || '',
      timestamp: new Date().toISOString(),
    });
    
    next(err);
  };
};

// Graceful shutdown logging
const setupGracefulShutdown = () => {
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
  });
  
  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
  });
  
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', {
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise: promise.toString(),
      timestamp: new Date().toISOString(),
    });
  });
};

module.exports = {
  logger,
  logOSBOperation,
  logOSBError,
  logHTTPRequest,
  logCloudantOperation,
  logCloudantError,
  httpLoggingMiddleware,
  errorLoggingMiddleware,
  setupGracefulShutdown,
};