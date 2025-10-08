const opentelemetry = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const logger = require('../src/utils/logger');

let tracingInitialized = false;

/**
 * Initialize OpenTelemetry tracing for the OSB broker
 */
function initializeTracing() {
  if (tracingInitialized) {
    return;
  }

  try {
    // Only initialize if tracing is enabled
    if (process.env.TRACING_ENABLED !== 'true') {
      logger.info('Tracing disabled via TRACING_ENABLED environment variable');
      return;
    }

    const jaegerEndpoint = process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces';
    
    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME || 'radware-cap-osb',
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
        [SemanticResourceAttributes.SERVICE_NAMESPACE]: process.env.SERVICE_NAMESPACE || 'ibm-cloud',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      }),
      traceExporter: new JaegerExporter({
        endpoint: jaegerEndpoint,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false, // Disable file system instrumentation to reduce noise
          },
          '@opentelemetry/instrumentation-http': {
            enabled: true,
            requestHook: (span, request) => {
              // Add custom attributes for OSB operations
              if (request.url) {
                const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
                if (url.pathname.startsWith('/v2/')) {
                  span.setAttributes({
                    'osb.operation': getOSBOperation(url.pathname, request.method),
                    'osb.version': '2.12',
                  });
                }
              }
            },
          },
          '@opentelemetry/instrumentation-express': {
            enabled: true,
          },
        }),
      ],
    });

    sdk.start();
    tracingInitialized = true;
    logger.info('OpenTelemetry tracing initialized successfully', { 
      jaegerEndpoint,
      serviceName: process.env.SERVICE_NAME || 'radware-cap-osb'
    });

  } catch (error) {
    logger.error('Failed to initialize OpenTelemetry tracing', { error: error.message });
  }
}

/**
 * Get OSB operation name from HTTP method and path
 */
function getOSBOperation(pathname, method) {
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

/**
 * Express middleware to create custom spans for OSB operations
 */
function tracingMiddleware() {
  return (req, res, next) => {
    if (!tracingInitialized) {
      return next();
    }

    const tracer = opentelemetry.trace.getTracer('radware-cap-osb');
    const span = tracer.startSpan(`${req.method} ${req.path}`, {
      kind: opentelemetry.SpanKind.SERVER,
      attributes: {
        'http.method': req.method,
        'http.url': req.originalUrl,
        'http.route': req.route?.path || req.path,
        'user_agent.original': req.get('User-Agent') || '',
        'http.request_content_length': req.get('Content-Length') || 0,
      },
    });

    // Add OSB-specific attributes
    if (req.path.startsWith('/v2/')) {
      span.setAttributes({
        'osb.operation': getOSBOperation(req.path, req.method),
        'osb.version': '2.12',
        'osb.service_id': req.query.service_id || req.body?.service_id || '',
        'osb.plan_id': req.query.plan_id || req.body?.plan_id || '',
      });

      // Add instance/binding IDs if present
      if (req.params.instance_id) {
        span.setAttribute('osb.instance_id', req.params.instance_id);
      }
      if (req.params.binding_id) {
        span.setAttribute('osb.binding_id', req.params.binding_id);
      }
    }

    // Set span context for downstream operations
    req.span = span;

    // Hook into response to add final attributes
    const originalSend = res.send;
    res.send = function(body) {
      span.setAttributes({
        'http.status_code': res.statusCode,
        'http.response_content_length': Buffer.byteLength(body || '', 'utf8'),
      });

      // Set span status based on HTTP status code
      if (res.statusCode >= 400) {
        span.setStatus({
          code: opentelemetry.SpanStatusCode.ERROR,
          message: `HTTP ${res.statusCode}`,
        });
      } else {
        span.setStatus({ code: opentelemetry.SpanStatusCode.OK });
      }

      span.end();
      return originalSend.call(this, body);
    };

    next();
  };
}

/**
 * Create a child span for async operations
 */
function createChildSpan(name, parentSpan = null) {
  if (!tracingInitialized) {
    return null;
  }

  const tracer = opentelemetry.trace.getTracer('radware-cap-osb');
  const parent = parentSpan || opentelemetry.trace.getActiveSpan();
  
  return tracer.startSpan(name, {
    parent,
    kind: opentelemetry.SpanKind.INTERNAL,
  });
}

/**
 * Add custom attributes to the current span
 */
function addSpanAttributes(attributes) {
  if (!tracingInitialized) {
    return;
  }

  const span = opentelemetry.trace.getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

/**
 * Record an exception in the current span
 */
function recordException(error, span = null) {
  if (!tracingInitialized) {
    return;
  }

  const activeSpan = span || opentelemetry.trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.recordException(error);
    activeSpan.setStatus({
      code: opentelemetry.SpanStatusCode.ERROR,
      message: error.message,
    });
  }
}

module.exports = {
  initializeTracing,
  tracingMiddleware,
  createChildSpan,
  addSpanAttributes,
  recordException,
};