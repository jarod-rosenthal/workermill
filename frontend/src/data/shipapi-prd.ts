// Sanitized PRD — the original specification that defined the ShipAPI showcase build
// Reconstructed from build log ticket specifications

export const shipApiPrd = `# ShipAPI — Full Build Specification

## Purpose

This is a **showcase build** — a polished demo app designed to demonstrate what WorkerMill can build autonomously. A production-grade inventory management REST API with JWT + API key authentication, full-text search, atomic stock transfers, audit logging, rate limiting, comprehensive tests, and Swagger/ReDoc documentation. When a visitor opens the demo, they should see a fully documented API with realistic inventory data and working endpoints.

## Source of Truth

- **Repo:** \`workermill-examples/shipapi\` (GitHub)
- **Live URL:** https://shipapi.workermill.com
- **Deployment:** Railway (app) + Neon PostgreSQL (database)

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | FastAPI | Latest |
| Language | Python | 3.13 |
| ORM | SQLAlchemy 2.0 | Async with asyncpg |
| Database | PostgreSQL (Neon) | With connection pooling |
| Migrations | Alembic | Async config |
| Validation | Pydantic V2 | BaseModel with field validators |
| Auth | JWT (access + refresh) + API keys | bcrypt for passwords, SHA-256 for API keys |
| Rate Limiting | slowapi | Per-endpoint limits |
| Testing | pytest + httpx | Async test client, >80% coverage |
| Type Checking | mypy | Strict mode |
| Linting | ruff | Check + format |
| CI/CD | GitHub Actions | \`ubuntu-latest\` |
| Hosting | Railway | Dockerfile-based deploy |
| Package Manager | uv | Fast Python dependency management |
| Containerization | Docker | Multi-stage build with uv |

## Global Constraints

- **Python 3.13** (pinned in \`.python-version\`)
- **Async everywhere:** All database operations use async SQLAlchemy, async test client (httpx)
- **Docker image <200MB**, non-root user
- **Strict mypy** on \`src/\` directory
- **Pre-commit quality gate:** \`ruff check\`, \`ruff format --check\`, \`mypy src --strict\`
- **API prefix:** All endpoints under \`/api/v1/\`
- **Standard error format:** \`{ "detail": "message" }\` with appropriate HTTP status codes
- **X-Request-Id** header on every response for traceability

---

## Database Schema (7 models)

### Models

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| User | User accounts | email (unique), username (unique), hashed_password, is_active, is_admin, api_key_hash |
| Category | Product categories | name, slug (unique), description, parent_id (self-referential) |
| Product | Inventory items | name, sku (unique), description, price, is_active, category_id, search_vector (TSVECTOR) |
| Warehouse | Storage locations | name, code (unique), address, is_active |
| StockLevel | Current inventory | product_id, warehouse_id, quantity, low_stock_threshold |
| StockTransfer | Inventory movements | product_id, from_warehouse_id, to_warehouse_id, quantity, notes |
| AuditLog | Activity tracking | user_id, action, resource_type, resource_id, details (JSON), ip_address |

### Key Features

- **Full-text search:** TSVECTOR computed column + GIN index on Product for PostgreSQL full-text search with \`ts_rank\` relevance ordering
- **Self-referential categories:** \`parent_id\` enables subcategory hierarchy (5 top-level + 15 subcategories)
- **Cascade protection:** Cannot delete categories with products (400 error)
- **Soft-delete:** Products use \`is_active\` flag instead of hard delete
- **Unique constraints:** User email, username; Product SKU; Category slug; Warehouse code

### Indexes

- GIN index on Product search_vector for full-text search
- Standard B-tree indexes on foreign keys and unique fields
- Composite unique on StockLevel (product_id, warehouse_id)

---

## Authentication System

### JWT Authentication

- **Access token:** Short-lived (configurable expiry)
- **Refresh token:** Long-lived for token renewal
- **Password hashing:** bcrypt with secure salt rounds

### API Key Authentication

- **Format:** \`sk_\` prefix + random hex characters
- **Storage:** SHA-256 hash (raw key never stored)
- **Lookup:** By key prefix for efficient retrieval
- **Header:** \`X-API-Key\`

### Dual Auth Dependency

Routes accept either:
1. \`Authorization: Bearer <jwt_token>\`
2. \`X-API-Key: sk_...\`

Both resolve to the authenticated user.

### Auth Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | \`/api/v1/auth/register\` | Create account (rate limited: 5/min) |
| POST | \`/api/v1/auth/login\` | Login, returns access + refresh tokens (rate limited: 10/min) |
| POST | \`/api/v1/auth/refresh\` | Refresh access token (rate limited: 30/min) |
| GET | \`/api/v1/auth/me\` | Current user profile |

---

## API Endpoints

### Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | \`/api/v1/health\` | No | Health check with DB connectivity |

### Categories

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | \`/api/v1/categories\` | Yes | List categories (with subcategory hierarchy) |
| POST | \`/api/v1/categories\` | Admin | Create category |
| GET | \`/api/v1/categories/{id}\` | Yes | Category detail with product count |
| PUT | \`/api/v1/categories/{id}\` | Admin | Update category |
| DELETE | \`/api/v1/categories/{id}\` | Admin | Delete (400 if has products) |

### Products

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | \`/api/v1/products\` | Yes | List with filters (category, price range, is_active), search, pagination, sorting |
| POST | \`/api/v1/products\` | Admin | Create product |
| GET | \`/api/v1/products/{id}\` | Yes | Detail with eager-loaded stock levels |
| PUT | \`/api/v1/products/{id}\` | Admin | Update product |
| DELETE | \`/api/v1/products/{id}\` | Admin | Soft-delete (set is_active=false) |

**Product Search:** Full-text search via \`?search=query\` parameter. Uses PostgreSQL TSVECTOR with \`ts_rank\` for relevance ordering.

**Product Filters:**
- \`category_id\` — Filter by category
- \`min_price\` / \`max_price\` — Price range
- \`is_active\` — Active/inactive filter
- \`sort_by\` — Whitelist of sortable columns
- \`page\` / \`per_page\` — Pagination (max 100 per page)

### Warehouses

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | \`/api/v1/warehouses\` | Yes | List warehouses |
| POST | \`/api/v1/warehouses\` | Admin | Create warehouse |
| GET | \`/api/v1/warehouses/{id}\` | Yes | Detail with stock level summary |
| PUT | \`/api/v1/warehouses/{id}\` | Admin | Update warehouse |
| DELETE | \`/api/v1/warehouses/{id}\` | Admin | Delete warehouse |

### Stock Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | \`/api/v1/stock\` | Yes | List stock levels |
| GET | \`/api/v1/stock/alerts\` | Yes | Low-stock alerts (quantity < threshold) |
| POST | \`/api/v1/stock/transfers\` | Yes | Atomic stock transfer between warehouses |
| GET | \`/api/v1/stock/transfers\` | Yes | Transfer history |

**Atomic Stock Transfers:**
- Uses \`SELECT FOR UPDATE\` within a single transaction
- Validates sufficient stock at source (400 if insufficient)
- Validates different source/destination warehouses (400 if same)
- Auto-creates stock_level record at destination if not exists
- Records audit log entry

### Audit Log

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | \`/api/v1/audit\` | Admin | Audit log with filters (user, action, resource_type, date range) |

### Showcase

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | \`/showcase/stats\` | No | Live DB metrics for showcase display |

---

## Cross-Cutting Infrastructure

### Error Handling

Global error handlers for:
- **422** — Validation errors (Pydantic)
- **401** — Authentication required
- **403** — Forbidden (insufficient permissions)
- **404** — Resource not found
- **409** — Conflict (duplicate resource)
- **500** — Internal server error

All errors return \`{ "detail": "message" }\` format.

### Rate Limiting (slowapi)

| Endpoint | Limit |
|----------|-------|
| Register | 5/min |
| Login | 10/min |
| Refresh | 30/min |
| Authenticated routes | 100/min |

Returns 429 with retry headers when exceeded.

### Audit Logging

Every write operation records:
- User ID
- Action type (create, update, delete, transfer)
- Resource type and ID
- Change details (JSON)
- IP address
- Timestamp

### Request ID Middleware

Every response includes \`X-Request-Id\` header (UUID) for request tracing.

### Structured Access Logging

Request/response logging with timing, status code, and path.

---

## Seed Data

### Demo User (Admin)
- **Email:** demo@workermill.com
- **Password:** demo1234
- **Role:** Admin

### Categories (20)
- 5 top-level categories
- 15 subcategories (3 per top-level)

### Products (50)
- 45 active products with realistic names and descriptions (good for search testing)
- 5 inactive products (soft-deleted)

### Warehouses (3)
- East Coast, West Coast, Central distribution centers

### Stock Data
- 150 stock level records (~10 items below low-stock threshold for alert testing)
- 20 stock transfers with audit trail
- 50 audit log entries

**Seed script is idempotent** — safe to run multiple times.

---

## Documentation

### OpenAPI / Swagger

- Auto-generated from FastAPI decorators
- Available at \`/docs\` (Swagger UI) and \`/redoc\` (ReDoc)
- 7 tag groups: Auth, Categories, Products, Warehouses, Stock, Audit, Health
- Every endpoint has example request/response bodies

### README.md

- Badges (CI, Python version, license)
- Demo credentials
- Quick start guide
- Full endpoint table
- Architecture diagram

### CLAUDE.md

- Pre-commit quality gate commands
- Tech stack with versions
- Key conventions
- Common commands

---

## Testing

### Test Infrastructure

- \`conftest.py\` with test database, async httpx client, auth fixtures
- Isolated test DB (not mocked)
- Fixtures for authenticated admin and regular users
- Coverage target: >80%

### Test Files (9)

| File | Coverage |
|------|----------|
| \`test_health.py\` | Health endpoint |
| \`test_auth.py\` | Register, login, refresh, API key, expired tokens |
| \`test_categories.py\` | CRUD, cascade protection, slug uniqueness |
| \`test_products.py\` | CRUD, full-text search, filters, pagination, sorting |
| \`test_warehouses.py\` | CRUD, stock level summary in detail |
| \`test_stock.py\` | Atomic transfer atomicity, insufficient stock, alerts |
| \`test_audit.py\` | Filters, admin-only access |
| \`test_rate_limiting.py\` | 429 responses, retry headers |
| \`test_errors.py\` | Error format consistency across endpoints |

---

## CI/CD

### GitHub Actions CI

- Triggered on push and PR to main
- Jobs: lint (ruff), format check (ruff format), type check (mypy strict), tests (pytest with Postgres service container), coverage check (>80%)

### Deploy Workflow

- Railway CLI: \`railway up\`
- \`preDeployCommand\` runs Alembic migrations
- Post-deploy smoke tests: curl health, /docs, /redoc with retry loop

### Docker

- Multi-stage build with \`uv\` package manager
- Final image <200MB
- Non-root user
- Health check in Dockerfile

---

## Production Config

### Railway (\`railway.toml\`)
- Build and deploy configuration
- Environment variable injection
- Health check endpoint

### Landing Page

- Dark-themed responsive HTML page (served as HTMLResponse with inline CSS)
- Live stats from \`/showcase/stats\` endpoint
- Demo credentials and quick-start links
- "Built by WorkerMill" branding

---

## Post-Deploy Validation

1. Health endpoint returns 200
2. Swagger UI loads at \`/docs\`
3. ReDoc loads at \`/redoc\`
4. Full auth flow works (register, login, JWT + API key)
5. Product search returns relevant results
6. Stock transfer atomicity verified
7. Audit log records operations
8. Rate limiting active (429 on excess)
9. Error format consistent
10. X-Request-Id header present
11. Docker image <200MB, non-root
`;
