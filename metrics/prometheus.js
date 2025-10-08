/**
 * Prometheus metrics collection for Radware CAP OSB
 * Exposes application and business metrics for monitoring
 */

const promClient = require('prom-client');

// Enable default system metrics
promClient.collectDefaultMetrics();

// Custom metrics for OSB operations
const httpRequestsTotal = new promClient.Counter({
  name: 'osb_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'endpoint', 'status_code']
});

const httpRequestDuration = new promClient.Histogram({
  name: 'osb_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'endpoint', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});

const osbOperationsTotal = new promClient.Counter({
  name: 'osb_operations_total',
  help: 'Total number of OSB operations',
  labelNames: ['operation', 'service_id', 'status']
});

const osbOperationDuration = new promClient.Histogram({
  name: 'osb_operation_duration_seconds',
  help: 'OSB operation duration in seconds',
  labelNames: ['operation', 'service_id'],
  buckets: [1, 5, 10, 30, 60, 300]
});

const activeServiceInstances = new promClient.Gauge({
  name: 'osb_active_service_instances',
  help: 'Number of active service instances',
  labelNames: ['service_id', 'plan_id']
});

const activeServiceBindings = new promClient.Gauge({
  name: 'osb_active_service_bindings',
  help: 'Number of active service bindings'
});

const radwareApiRequests = new promClient.Counter({
  name: 'radware_api_requests_total',
  help: 'Total number of Radware API requests',
  labelNames: ['endpoint', 'status_code', 'method']
});

const radwareApiDuration = new promClient.Histogram({
  name: 'radware_api_request_duration_seconds',
  help: 'Radware API request duration in seconds',
  labelNames: ['endpoint', 'method'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
});

const databaseOperations = new promClient.Counter({
  name: 'database_operations_total',
  help: 'Total number of database operations',
  labelNames: ['operation', 'type', 'status']
});

const databaseConnectionStatus = new promClient.Gauge({
  name: 'database_connection_status',
  help: 'Database connection status (1=connected, 0=disconnected)'
});

// Middleware to collect HTTP metrics
function metricsMiddleware(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const endpoint = getEndpointLabel(req.path);
    
    httpRequestsTotal
      .labels(req.method, endpoint, res.statusCode.toString())
      .inc();
    
    httpRequestDuration
      .labels(req.method, endpoint, res.statusCode.toString())
      .observe(duration);
  });
  
  next();
}

// Helper to normalize endpoint paths for metrics
function getEndpointLabel(path) {
  // Normalize OSB paths
  if (path.startsWith('/v2/catalog')) return '/v2/catalog';
  if (path.match(/^\/v2\/service_instances\/[^/]+$/)) return '/v2/service_instances/{instance_id}';
  if (path.match(/^\/v2\/service_instances\/[^/]+\/service_bindings\/[^/]+$/)) return '/v2/service_instances/{instance_id}/service_bindings/{binding_id}';
  if (path.match(/^\/v2\/service_instances\/[^/]+\/last_operation$/)) return '/v2/service_instances/{instance_id}/last_operation';
  if (path === '/health') return '/health';
  if (path === '/metrics') return '/metrics';
  
  return 'unknown';
}

// OSB operation tracking
function trackOsbOperation(operation, serviceId, status = 'success') {
  osbOperationsTotal
    .labels(operation, serviceId, status)
    .inc();
}

function trackOsbOperationDuration(operation, serviceId, durationSeconds) {
  osbOperationDuration
    .labels(operation, serviceId)
    .observe(durationSeconds);
}

// Service instance tracking
function updateActiveInstances(serviceId, planId, count) {
  activeServiceInstances
    .labels(serviceId, planId)
    .set(count);
}

function updateActiveBindings(count) {
  activeServiceBindings.set(count);
}

// Radware API tracking
function trackRadwareApiRequest(endpoint, method, statusCode, durationSeconds) {
  radwareApiRequests
    .labels(endpoint, statusCode.toString(), method)
    .inc();
  
  radwareApiDuration
    .labels(endpoint, method)
    .observe(durationSeconds);
}

// Database operation tracking
function trackDatabaseOperation(operation, type, status = 'success') {
  databaseOperations
    .labels(operation, type, status)
    .inc();
}

function updateDatabaseConnectionStatus(connected) {
  databaseConnectionStatus.set(connected ? 1 : 0);
}

// Metrics endpoint handler
async function getMetrics(req, res) {
  try {
    res.set('Content-Type', promClient.register.contentType);
    const metrics = await promClient.register.metrics();
    res.status(200).send(metrics);
  } catch (error) {
    res.status(500).send('Error collecting metrics');
  }
}

module.exports = {
  // Middleware
  metricsMiddleware,
  
  // Metric tracking functions
  trackOsbOperation,
  trackOsbOperationDuration,
  updateActiveInstances,
  updateActiveBindings,
  trackRadwareApiRequest,
  trackDatabaseOperation,
  updateDatabaseConnectionStatus,
  
  // Endpoint handler
  getMetrics,
  
  // Direct access to metrics (for advanced use)
  metrics: {
    httpRequestsTotal,
    httpRequestDuration,
    osbOperationsTotal,
    osbOperationDuration,
    activeServiceInstances,
    activeServiceBindings,
    radwareApiRequests,
    radwareApiDuration,
    databaseOperations,
    databaseConnectionStatus
  }
};