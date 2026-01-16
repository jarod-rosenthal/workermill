# WorkerMill API Documentation

## Swagger/OpenAPI Documentation

The WorkerMill API now includes comprehensive OpenAPI 3.0 documentation powered by Swagger.

### Accessing the Documentation

**Interactive Swagger UI:**
- **Production:** https://workermill.com/api/docs
- **Development:** http://localhost:4000/api/docs

The Swagger UI provides:
- Interactive API exploration
- "Try it out" functionality to test endpoints directly
- Request/response examples
- Authentication testing with JWT tokens

**OpenAPI Specification (JSON):**
- **Production:** https://workermill.com/api/docs.json
- **Development:** http://localhost:4000/api/docs.json

Download the raw OpenAPI spec for:
- Code generation (SDKs, client libraries)
- Import into API testing tools (Postman, Insomnia)
- Integration with API gateways

## Authentication

Most endpoints require authentication. The API supports two authentication methods:

### 1. Bearer Token (JWT)

Used for user-facing endpoints (dashboard, settings, etc.).

```bash
# Example: Get billing status
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://workermill.com/api/billing/status
```

**How to get a JWT token:**
1. Log in via the WorkerMill dashboard
2. Extract the token from the browser's local storage (`cognitoIdToken`)
3. Or use the Cognito authentication API directly

### 2. API Key

Used for worker-to-API communication (log posting, usage reporting).

```bash
# Example: Post task logs
curl -H "x-api-key: YOUR_ORG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"taskId": "...", "type": "info", "message": "..."}' \
  https://workermill.com/api/control-center/logs
```

**How to get an API key:**
- Organization admins can view the API key in Settings
- API keys are automatically generated when an organization is created

## Documented Endpoints

### Billing

- `GET /api/billing/plans` - List available subscription plans
- `GET /api/billing/status` - Get current billing status and quota

### Tasks

- `POST /api/tasks` - Create a new worker task
- `GET /api/tasks` - List tasks with filtering and pagination
- `GET /api/tasks/{id}` - Get detailed task information

### Logs

- `GET /api/control-center/logs/{taskId}/stream` - Stream task logs in real-time (SSE)

## Using Swagger UI

### Testing Authenticated Endpoints

1. Navigate to https://workermill.com/api/docs
2. Click the "Authorize" button (lock icon) in the top right
3. Enter your JWT token in the format: `Bearer YOUR_TOKEN`
4. Click "Authorize" to save
5. Try out any authenticated endpoint using the "Try it out" button

### Example Workflow

**1. Get available plans:**
```
GET /api/billing/plans
```

**2. Check your billing status:**
```
GET /api/billing/status
```

**3. Create a new task:**
```
POST /api/tasks
{
  "jiraIssueKey": "OCS-123",
  "workerPersona": "backend_developer",
  "workerModel": "claude-sonnet-4-5-20250929"
}
```

**4. Stream task logs:**
```
GET /api/control-center/logs/{taskId}/stream
```

## Code Generation

Use the OpenAPI spec to generate client SDKs:

**TypeScript/JavaScript:**
```bash
npm install -g @openapitools/openapi-generator-cli
openapi-generator-cli generate \
  -i https://workermill.com/api/docs.json \
  -g typescript-fetch \
  -o ./generated/workermill-client
```

**Python:**
```bash
pip install openapi-generator-cli
openapi-generator generate \
  -i https://workermill.com/api/docs.json \
  -g python \
  -o ./generated/workermill-client
```

**Go:**
```bash
openapi-generator generate \
  -i https://workermill.com/api/docs.json \
  -g go \
  -o ./generated/workermill-client
```

## Contributing to Documentation

Documentation is defined using JSDoc comments in route files. To add documentation for a new endpoint:

1. Add JSDoc comment above the route handler
2. Use the `@swagger` tag with OpenAPI 3.0 syntax
3. Include tags, parameters, request body, and responses

**Example:**

```typescript
/**
 * @swagger
 * /api/tasks/{id}:
 *   get:
 *     summary: Get a specific task
 *     description: Returns detailed information about a single task by ID
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Task UUID
 *     responses:
 *       200:
 *         description: Task details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       404:
 *         description: Task not found
 */
router.get("/:id", async (req, res) => {
  // Handler implementation
});
```

## Architecture Notes

### Real-time Log Streaming

The WorkerMill API uses **Server-Sent Events (SSE)** for real-time log streaming, NOT WebSockets:

- **Endpoint:** `GET /api/control-center/logs/{taskId}/stream`
- **Protocol:** SSE (text/event-stream)
- **Polling interval:** 1 second
- **Data source:** PostgreSQL database (NOT CloudWatch)
- **Resume support:** Automatic via `Last-Event-ID` header

This design choice was made for:
- Simpler client implementation (native browser EventSource)
- Better compatibility with load balancers
- Automatic reconnection handling
- Cursor-based resume on disconnect

### Database-backed Logs

Worker logs are stored in the `worker_task_logs` table:

- Workers POST to `/api/tasks/{taskId}/logs` during execution
- Dashboard streams via SSE from database
- Faster than CloudWatch (500ms vs 1s polling)
- Automatic cleanup after `org.logRetentionDays`

## Rate Limits

Different rate limits apply to different endpoints:

- **Webhooks:** 100 req/min per IP
- **Worker logs:** 1000 req/min per IP (high volume)
- **Authenticated routes:** 100 req/min per user
- **Auth routes:** 20 req/min per IP (strict)

Rate limit headers are included in responses:
- `X-RateLimit-Limit` - Request quota
- `X-RateLimit-Remaining` - Remaining requests
- `X-RateLimit-Reset` - Reset timestamp

## Support

For questions about the API:
- **Documentation issues:** Submit a PR to update JSDoc comments
- **Feature requests:** Create a GitHub issue
- **Support:** Contact support@workermill.com
