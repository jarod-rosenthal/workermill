***REMOVED*** Add API Endpoint

> Create a new REST API endpoint following established patterns and conventions.

***REMOVED******REMOVED*** Goal

Implement a new API endpoint that follows existing patterns in the codebase, including proper authentication, validation, error handling, and documentation.

***REMOVED******REMOVED*** Inputs

- **TICKET_KEY**: The ticket with requirements
- **TICKET_DESCRIPTION**: Detailed requirements including:
  - HTTP method (GET, POST, PUT, DELETE, PATCH)
  - Endpoint path
  - Request/response format
  - Business logic
- **TASK_NOTES**: Additional context that may clarify requirements or change scope

***REMOVED******REMOVED*** Pre-flight Checks

1. **Read both TICKET_DESCRIPTION and TASK_NOTES** - task notes may contain critical updates

2. **Find similar endpoints:**
   ```bash
   ***REMOVED*** Search for similar functionality
   grep -r "<similar-functionality>" src/routes/ src/api/
   ```

   Use existing endpoints as templates:
   - CRUD operations → Look for existing entity routes
   - Complex queries → Look for analytics/reporting routes
   - External integrations → Look for webhook/integration routes
   - Background processing → Look for job/task routes

3. **Check if route file exists:**
   - If adding to existing domain, modify that file
   - If new domain, create new file in routes directory

4. **Verify models exist:**
   ```bash
   grep -r "class <EntityName>" src/models/ src/entities/
   ```
   If model doesn't exist, create it first.

***REMOVED******REMOVED*** Steps

***REMOVED******REMOVED******REMOVED*** Step 1: Create/Modify Route File

If creating a new route file:

```typescript
// src/routes/<domain>.ts or src/api/routes/<domain>.ts

import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authenticateRequest } from '../middleware/auth';
import { YourModel } from '../models';
import { logger } from '../utils/logger';

const router = Router();

// All routes require authentication
router.use(authenticateRequest);

// ... routes here

export default router;
```

***REMOVED******REMOVED******REMOVED*** Step 2: Implement the Endpoint

Follow this pattern for each endpoint:

```typescript
/**
 * @swagger
 * /api/v1/<domain>:
 *   <method>:
 *     summary: Brief description
 *     description: Detailed description
 *     tags: [<Domain>]
 *     security:
 *       - BearerAuth: []
 *     // ... parameters, requestBody, responses
 */
router.<method>(
  '/<path>',
  // Validation middleware
  [
    body('field').isString().notEmpty(),
    // ... more validators
  ],
  async (req: Request, res: Response) => {
    try {
      // 1. Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      // 2. Get org context (multi-tenancy)
      const orgId = req.orgId!;

      // 3. Get repository/data access
      const repo = getRepository(YourModel);

      // 4. Business logic
      // ... your implementation

      // 5. Return response
      return res.json({ data: result });

    } catch (error) {
      logger.error('Error in <endpoint>:', error);
      return res.status(500).json({ error: 'Failed to <action>' });
    }
  }
);
```

***REMOVED******REMOVED******REMOVED*** Step 3: Register the Route

If new file, add to route index:

```typescript
// src/routes/index.ts or src/api/index.ts

import domainRouter from './domain';
// ...
app.use('/api/v1/domain', domainRouter);
```

***REMOVED******REMOVED******REMOVED*** Step 4: Add Input Validation

Use express-validator (or your framework's validator) for all inputs:

```typescript
// Path parameters
param('id').isUUID().withMessage('Valid ID required')

// Query parameters
query('status').optional().isIn(['active', 'inactive'])

// Body fields
body('name').isString().trim().notEmpty().isLength({ max: 255 })
body('email').isEmail().normalizeEmail()
body('count').isInt({ min: 1, max: 100 })
body('data').isObject()
body('tags').isArray()
```

***REMOVED******REMOVED******REMOVED*** Step 5: Handle Errors Properly

Use consistent error responses:

```typescript
// 400 - Bad request (validation error)
return res.status(400).json({
  error: 'validation_error',
  message: 'Invalid input',
  details: errors.array()
});

// 401 - Unauthorized
return res.status(401).json({
  error: 'unauthorized',
  message: 'Authentication required'
});

// 403 - Forbidden
return res.status(403).json({
  error: 'forbidden',
  message: 'Insufficient permissions'
});

// 404 - Not found
return res.status(404).json({
  error: 'not_found',
  message: `${resourceType} not found`
});

// 409 - Conflict
return res.status(409).json({
  error: 'conflict',
  message: 'Resource already exists'
});

// 500 - Internal error
return res.status(500).json({
  error: 'internal_error',
  message: 'An unexpected error occurred'
});
```

***REMOVED******REMOVED******REMOVED*** Step 6: Add Pagination (for list endpoints)

```typescript
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;

  const [items, total] = await repo.findAndCount({
    where: { orgId },
    skip: offset,
    take: limit,
    order: { createdAt: 'DESC' }
  });

  return res.json({
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
});
```

***REMOVED******REMOVED******REMOVED*** Step 7: Write Tests

Create test file:

```typescript
// src/routes/__tests__/<domain>.test.ts

import request from 'supertest';
import { app } from '../../app';

describe('<Domain> API', () => {
  let authToken: string;

  beforeAll(async () => {
    // Setup: create test user, get auth token
    authToken = await getTestToken();
  });

  describe('GET /api/v1/<domain>', () => {
    it('should return paginated list', async () => {
      const response = await request(app)
        .get('/api/v1/<domain>')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.pagination).toBeDefined();
    });

    it('should return 401 without auth', async () => {
      const response = await request(app)
        .get('/api/v1/<domain>');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/v1/<domain>', () => {
    it('should create new resource', async () => {
      const response = await request(app)
        .post('/api/v1/<domain>')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Test', /* other fields */ });

      expect(response.status).toBe(201);
      expect(response.body.data.id).toBeDefined();
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/v1/<domain>')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });
  });
});
```

***REMOVED******REMOVED******REMOVED*** Step 8: Verify with TypeCheck and Tests

```bash
node /app/execution-compiled/test/run_typecheck.js
node /app/execution-compiled/test/run_tests.js --pattern "<domain>"
```

***REMOVED******REMOVED*** Outputs

- [ ] Route file created/modified
- [ ] Route registered in index
- [ ] Swagger/OpenAPI documentation added
- [ ] Input validation implemented
- [ ] Error handling uses consistent format
- [ ] Pagination for list endpoints
- [ ] Multi-tenancy (orgId) enforced
- [ ] Tests written and passing
- [ ] TypeScript compiles without errors

***REMOVED******REMOVED*** Edge Cases

***REMOVED******REMOVED******REMOVED*** Need Admin-Only Access

Add admin check middleware:

```typescript
import { requireAdmin } from '../middleware/auth';

router.post('/', requireAdmin, [...validators], handler);
```

***REMOVED******REMOVED******REMOVED*** Need Custom Authorization

For complex permissions (team managers, resource owners):

```typescript
// Check user has permission
const hasAccess = await checkResourceAccess(req.userId, resourceId);
if (!hasAccess) {
  return res.status(403).json({ error: 'forbidden', message: 'Access denied' });
}
```

***REMOVED******REMOVED******REMOVED*** External API Calls

When calling external services:
- Use try/catch with specific error handling
- Add timeout
- Log external call failures
- Return user-friendly error messages
- Consider circuit breaker pattern

```typescript
try {
  const result = await axios.get(externalUrl, { timeout: 5000 });
  return res.json({ data: result.data });
} catch (error) {
  if (axios.isAxiosError(error)) {
    logger.error('External API failed:', { url: externalUrl, error: error.message });
    return res.status(502).json({ error: 'external_service_error', message: 'External service unavailable' });
  }
  throw error;
}
```

***REMOVED******REMOVED******REMOVED*** File Uploads

For endpoints accepting files:
- Use multer or similar middleware
- Validate file type and size
- Store in cloud storage, not local disk
- Return file URL/ID in response

```typescript
import multer from 'multer';

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }
  // Upload to cloud storage...
});
```

***REMOVED******REMOVED******REMOVED*** Bulk Operations

For batch create/update/delete:
- Limit batch size (e.g., max 100 items)
- Use database transactions
- Return partial success with details
- Consider background job for large batches

```typescript
router.post('/bulk', async (req, res) => {
  const items = req.body.items;

  if (items.length > 100) {
    return res.status(400).json({ error: 'Batch size exceeds limit of 100' });
  }

  const results = await dataSource.transaction(async (manager) => {
    return Promise.all(items.map(item => manager.save(Entity, item)));
  });

  return res.json({ data: results, count: results.length });
});
```

***REMOVED******REMOVED*** Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
