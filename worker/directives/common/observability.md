***REMOVED*** Observability Standards

Standard Operating Procedure for production observability across all WorkerMill AI Workers.

***REMOVED******REMOVED*** The Three Pillars of Observability

***REMOVED******REMOVED******REMOVED*** 1. Structured Logging
***REMOVED******REMOVED******REMOVED*** 2. Distributed Tracing
***REMOVED******REMOVED******REMOVED*** 3. Metrics Collection

All production systems must implement these three pillars to enable effective debugging, monitoring, and incident response.

---

***REMOVED******REMOVED*** Structured Logging

***REMOVED******REMOVED******REMOVED*** JSON Log Format

Always use structured JSON logging in production:

```typescript
// Logger configuration
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  base: {
    service: process.env.SERVICE_NAME,
    version: process.env.APP_VERSION,
    environment: process.env.NODE_ENV,
  },
});

// Good - structured log with context
logger.info({
  event: 'user_login',
  userId: user.id,
  method: 'oauth',
  provider: 'google',
  duration_ms: 234,
}, 'User logged in successfully');

// Output:
// {
//   "level": "info",
//   "timestamp": "2024-01-15T10:30:00.000Z",
//   "service": "api",
//   "version": "1.2.3",
//   "environment": "production",
//   "event": "user_login",
//   "userId": "usr_123",
//   "method": "oauth",
//   "provider": "google",
//   "duration_ms": 234,
//   "msg": "User logged in successfully"
// }

// Bad - unstructured log
console.log(`User ${user.id} logged in via ${provider}`);
```

***REMOVED******REMOVED******REMOVED*** Correlation IDs

Include correlation IDs for request tracing:

```typescript
import { v4 as uuidv4 } from 'uuid';
import { AsyncLocalStorage } from 'async_hooks';

// Request context storage
const requestContext = new AsyncLocalStorage<{ correlationId: string }>();

// Middleware to set correlation ID
function correlationMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('x-correlation-id', correlationId);

  requestContext.run({ correlationId }, () => {
    next();
  });
}

// Logger that auto-includes correlation ID
function getLogger() {
  const context = requestContext.getStore();
  return logger.child({
    correlationId: context?.correlationId,
  });
}

// Usage in handlers
router.get('/users/:id', async (req, res) => {
  const log = getLogger();
  log.info({ userId: req.params.id }, 'Fetching user');

  try {
    const user = await userService.findById(req.params.id);
    log.info({ userId: user.id }, 'User fetched successfully');
    res.json(user);
  } catch (error) {
    log.error({ error, userId: req.params.id }, 'Failed to fetch user');
    throw error;
  }
});
```

***REMOVED******REMOVED******REMOVED*** Log Levels

Use appropriate log levels:

| Level | When to Use | Examples |
|-------|-------------|----------|
| `fatal` | Unrecoverable errors | Database connection lost, OOM |
| `error` | Errors that need attention | Failed API calls, exceptions |
| `warn` | Potential issues | Deprecated usage, retries |
| `info` | Significant events | Request completed, job started |
| `debug` | Debugging details | Query params, intermediate state |
| `trace` | Very detailed debugging | Full request/response bodies |

```typescript
// Production: info and above
// Staging: debug and above
// Development: trace and above

logger.fatal({ error }, 'Database connection failed, shutting down');
logger.error({ error, taskId }, 'Task execution failed');
logger.warn({ attempts: 3 }, 'Retrying failed request');
logger.info({ taskId, status: 'completed' }, 'Task completed');
logger.debug({ query, params }, 'Executing database query');
logger.trace({ requestBody, responseBody }, 'API call details');
```

---

***REMOVED******REMOVED*** Distributed Tracing

***REMOVED******REMOVED******REMOVED*** OpenTelemetry Integration

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'workermill-api',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

***REMOVED******REMOVED******REMOVED*** Manual Span Creation

```typescript
import { trace, SpanStatusCode, context } from '@opentelemetry/api';

const tracer = trace.getTracer('workermill-api');

async function processTask(taskId: string) {
  // Create a span for the operation
  return tracer.startActiveSpan('processTask', async (span) => {
    span.setAttribute('task.id', taskId);

    try {
      // Child span for database operation
      const task = await tracer.startActiveSpan('db.findTask', async (dbSpan) => {
        dbSpan.setAttribute('db.operation', 'SELECT');
        dbSpan.setAttribute('db.table', 'worker_tasks');
        const result = await taskRepo.findOne({ id: taskId });
        dbSpan.end();
        return result;
      });

      // Child span for external API call
      await tracer.startActiveSpan('api.notifyWebhook', async (apiSpan) => {
        apiSpan.setAttribute('http.method', 'POST');
        apiSpan.setAttribute('http.url', task.webhookUrl);
        await notifyWebhook(task);
        apiSpan.end();
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return task;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

***REMOVED******REMOVED******REMOVED*** Trace Context Propagation

```typescript
import { propagation, context } from '@opentelemetry/api';

// Extract trace context from incoming request
function extractTraceContext(req) {
  return propagation.extract(context.active(), req.headers);
}

// Inject trace context into outgoing request
async function callExternalService(url: string, data: object) {
  const headers = {};
  propagation.inject(context.active(), headers);

  return fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
}
```

---

***REMOVED******REMOVED*** Metrics Collection

***REMOVED******REMOVED******REMOVED*** Custom Metrics with Prometheus

```typescript
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

const register = new Registry();

// Counter - monotonically increasing values
const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// Histogram - distribution of values
const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// Gauge - values that can go up and down
const activeConnections = new Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
  registers: [register],
});

// Middleware to collect HTTP metrics
function metricsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const labels = {
      method: req.method,
      route: req.route?.path || req.path,
      status_code: res.statusCode,
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
  });

  next();
}

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});
```

***REMOVED******REMOVED******REMOVED*** Business Metrics

```typescript
// Task processing metrics
const tasksProcessed = new Counter({
  name: 'tasks_processed_total',
  help: 'Total tasks processed',
  labelNames: ['status', 'persona', 'model'],
});

const taskDuration = new Histogram({
  name: 'task_duration_seconds',
  help: 'Task execution duration',
  labelNames: ['persona', 'model'],
  buckets: [30, 60, 120, 300, 600, 1800, 3600],
});

const taskCost = new Counter({
  name: 'task_cost_usd_total',
  help: 'Total task cost in USD',
  labelNames: ['persona', 'model'],
});

// Usage
function recordTaskCompletion(task: WorkerTask) {
  const labels = {
    status: task.status,
    persona: task.persona,
    model: task.model,
  };

  tasksProcessed.inc(labels);
  taskDuration.observe(
    { persona: task.persona, model: task.model },
    task.executionTimeSeconds
  );
  taskCost.inc(
    { persona: task.persona, model: task.model },
    task.costUsd
  );
}
```

---

***REMOVED******REMOVED*** SLO/SLI Definition

***REMOVED******REMOVED******REMOVED*** Service Level Indicators (SLIs)

Define SLIs for each service:

| Service | SLI | Measurement |
|---------|-----|-------------|
| API | Availability | % of successful responses (non-5xx) |
| API | Latency | 95th percentile response time |
| Worker | Success Rate | % of tasks completed successfully |
| Worker | Throughput | Tasks processed per hour |

```typescript
// SLI calculation example
const sliAvailability = new Gauge({
  name: 'sli_availability_ratio',
  help: 'Availability SLI (successful requests / total requests)',
  registers: [register],
});

const sliLatencyP95 = new Gauge({
  name: 'sli_latency_p95_seconds',
  help: 'Latency SLI (95th percentile)',
  registers: [register],
});

// Calculate SLIs periodically
async function calculateSLIs() {
  const window = 60 * 60 * 1000; // 1 hour
  const now = Date.now();

  // Availability: successful / total
  const total = await getMetricValue('http_requests_total', {
    start: now - window, end: now
  });
  const errors = await getMetricValue('http_requests_total', {
    start: now - window, end: now, status_code: /5\d\d/
  });
  sliAvailability.set((total - errors) / total);

  // Latency P95
  const p95 = await getHistogramQuantile('http_request_duration_seconds', 0.95);
  sliLatencyP95.set(p95);
}
```

***REMOVED******REMOVED******REMOVED*** Service Level Objectives (SLOs)

```yaml
***REMOVED*** slo-config.yaml
slos:
  - name: api-availability
    description: API should be available 99.9% of the time
    sli: sli_availability_ratio
    target: 0.999
    window: 30d
    alerting:
      - severity: warning
        burn_rate: 2
        window: 6h
      - severity: critical
        burn_rate: 10
        window: 1h

  - name: api-latency
    description: API P95 latency should be under 500ms
    sli: sli_latency_p95_seconds
    target: 0.5
    window: 30d
    alerting:
      - severity: warning
        threshold: 0.8  ***REMOVED*** 80% of budget
      - severity: critical
        threshold: 1.0  ***REMOVED*** 100% of budget
```

---

***REMOVED******REMOVED*** Alerting

***REMOVED******REMOVED******REMOVED*** Golden Signals

Monitor the four golden signals:

1. **Latency** - Time to serve requests
2. **Traffic** - Requests per second
3. **Errors** - Error rate
4. **Saturation** - Resource utilization

```yaml
***REMOVED*** alerts.yaml
groups:
  - name: golden-signals
    rules:
      ***REMOVED*** Latency
      - alert: HighLatency
        expr: histogram_quantile(0.95, http_request_duration_seconds) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High P95 latency detected"
          description: "P95 latency is {{ $value }}s (threshold: 1s)"

      ***REMOVED*** Errors
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status_code=~"5.."}[5m])) /
          sum(rate(http_requests_total[5m])) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}"

      ***REMOVED*** Saturation
      - alert: HighCPUUsage
        expr: avg(container_cpu_usage_seconds_total) > 0.8
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage"
          description: "CPU usage is {{ $value | humanizePercentage }}"
```

***REMOVED******REMOVED******REMOVED*** Alert Routing

```yaml
***REMOVED*** alertmanager.yaml
route:
  receiver: 'default'
  group_by: ['alertname', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'
    - match:
        severity: warning
      receiver: 'slack'

receivers:
  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: '{{ .PagerDutyServiceKey }}'
  - name: 'slack'
    slack_configs:
      - api_url: '{{ .SlackWebhookURL }}'
        channel: '***REMOVED***alerts'
```

---

***REMOVED******REMOVED*** Debugging Distributed Systems

***REMOVED******REMOVED******REMOVED*** Debugging Checklist

When investigating issues:

1. **Check correlation ID** - Find all logs for the request
2. **Review trace** - See the full request path and timing
3. **Check metrics** - Look for anomalies around the time
4. **Compare baselines** - Is this different from normal?
5. **Check dependencies** - Are downstream services healthy?

```bash
***REMOVED*** Find all logs for a correlation ID
grep "correlationId.*abc-123" /var/log/app/*.log

***REMOVED*** Query traces in Jaeger
curl "http://jaeger:16686/api/traces?service=api&tag=correlation_id:abc-123"

***REMOVED*** Check error rate spike
curl "http://prometheus:9090/api/v1/query?query=rate(http_requests_total{status_code=~'5..'}[5m])"
```

***REMOVED******REMOVED******REMOVED*** Dashboard Requirements

Every service dashboard should include:

- [ ] Request rate (RPS)
- [ ] Error rate (%)
- [ ] Latency percentiles (P50, P95, P99)
- [ ] Resource utilization (CPU, memory)
- [ ] Dependency health
- [ ] Business metrics (tasks processed, etc.)
- [ ] SLO burn rate

***REMOVED******REMOVED*** Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
