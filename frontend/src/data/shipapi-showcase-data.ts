// Auto-generated from WorkerMill showcase data
// Repo: workermill-examples/shipapi
// Generated: 2026-02-19

export interface ShipApiEpic {
  id: string;
  title: string;
  priority: string;
  storyCount: number;
  duration: string;
  status: "completed" | "escalated" | "deployed";
  techLeadScore?: string;
  prNumber: number;
  prUrl: string;
  commentCount: number;
  personas: string[];
  description: string;
  buildLog: string;
}

export const shipApiEpics: ShipApiEpic[] = [
  {
    "id": "sa-1",
    "title": "SAPFB-1: Project metadata, dependencies & tooling config",
    "priority": "high",
    "storyCount": 4,
    "duration": "~18 min",
    "status": "completed",
    "techLeadScore": "9/10",
    "prNumber": 1,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/1",
    "commentCount": 4,
    "personas": [
      "backend_developer",
      "devops_engineer"
    ],
    "description": `### Epic Overview
Bootstrap the ShipAPI repository with all configuration files, Docker setup, FastAPI app skeleton, and developer tooling. This card creates the foundation every other card builds on — from dependency management to the running app shell.

### Scope Boundary
- This is the first card — nothing precedes it
- This card must NOT implement any API endpoints, database models, or business logic
- Creates only the scaffolding, configuration, and minimal app entry point

### Prerequisites
- None (Card 0)

### Deliverables
1. \`pyproject.toml\` — Project metadata, all dependencies (fastapi, sqlalchemy, asyncpg, alembic, pydantic-settings, python-jose, passlib, slowapi, python-multipart) and dev dependencies (pytest, pytest-asyncio, httpx, ruff, mypy, coverage), plus tool configs for ruff (line-length=100, py313), mypy (strict + pydantic plugin), pytest (asyncio_mode=auto), and coverage (fail_under=80)
2. \`.python-version\` — Set to \`3.13\`
3. \`Dockerfile\` — Multi-stage build: python:3.13-slim builder with uv, frozen dependency install, copy src/alembic/seed; slim runtime stage with venv copy, non-root user (appuser:1001), \`CMD sh -c uvicorn\` with \`\${PORT:-8000}\` expansion
4. \`.dockerignore\` — Exclude .git, .venv, __pycache__, .env files (except .env.example), tests, markdown, cache dirs, docker-compose.yml
5. \`docker-compose.yml\` — Local dev PostgreSQL 16-alpine with shipapi user/password/db, port 5432, healthcheck, named volume
6. \`railway.toml\` — DOCKERFILE builder, healthcheckPath \`/api/v1/health\`, timeout 300, ON_FAILURE restart with 3 retries, preDeployCommand \`alembic upgrade head\`
7. \`.env.example\` — Documented template with DATABASE_URL (pooled asyncpg+Neon), DATABASE_URL_DIRECT (direct), JWT_SECRET_KEY, PORT=8000
8. \`.gitignore\` — Python bytecode, .venv, .env (not .env.example), IDE files, test/lint caches, OS files
9. \`src/__init__.py\` + \`src/config.py\` — Settings class via pydantic-settings loading database_url, database_url_direct, jwt_secret_key, jwt token expiry defaults, app_name/version/debug from env vars with .env file support
10. \`src/database.py\` — Async SQLAlchemy engine from settings.database_url with pool_pre_ping=True (critical for Neon scale-to-zero), pool_size=5, max_overflow=10; async_sessionmaker factory; async get_db generator
11. \`src/main.py\` — FastAPI app with title "ShipAPI", description, version 1.0.0, lifespan (startup DB verify + shutdown engine dispose), CORS middleware (allow all origins/methods/headers for showcase), docs_url=/docs, redoc_url=/redoc, openapi_tags for all 7 endpoint groups (Health, Auth, Categories, Products, Warehouses, Stock, Audit)
12. \`CLAUDE.md\` — Complete local dev setup guide with command reference table (install, run, migrate, seed, test, lint, format, typecheck), local development steps, environment variables documentation, conventions (api/v1 prefix, UUID PKs, async SQLAlchemy, audit logging, error format, pagination format), deployment info

### Technical Specification
- Use \`uv\` as package manager — \`uv sync --frozen\` in Dockerfile
- Python 3.13 target throughout
- FastAPI lifespan pattern (not deprecated on_event)
- pydantic-settings for type-safe env loading with case_sensitive=False
- pool_pre_ping=True is CRITICAL for Neon serverless (handles scale-to-zero reconnection)
- Dockerfile CMD must use \`sh -c\` for Railway PORT variable expansion at runtime
- All files must pass \`ruff check\` and \`ruff format --check\` from the start`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic SAPFB-1.

### Stories Included

- **Project metadata, dependencies & tooling config complete**
  - Files: .env.example, .gitignore, .python-version (+3 more)
- **Docker, Compose & Railway deployment config complete**
  - Files: .dockerignore, .env.example, .gitignore (+7 more)
- **FastAPI app skeleton, config & database layer complete**
  - Files: .env.example, .gitignore, .python-version (+12 more)
- **Developer documentation \u2014 CLAUDE.md complete**
  - Files: .dockerignore, .env.example, .gitignore (+17 more)

### Branches Merged

- \`story/sapfb-1/0-project-metadata-dependencies\`
- \`story/sapfb-1/1-docker-compose-railway-deploym\`
- \`story/sapfb-1/2-fastapi-app-skeleton-config-da\`
- \`story/sapfb-1/3-developer-documentation-claude\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  },
  {
    "id": "sa-2",
    "title": "SAPFB-2: Foundation \u2014 Base mixins and User model",
    "priority": "high",
    "storyCount": 5,
    "duration": "~22 min",
    "status": "completed",
    "techLeadScore": "9/10",
    "prNumber": 2,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/2",
    "commentCount": 5,
    "personas": [
      "backend_developer"
    ],
    "description": `### Epic Overview
Define all 7 SQLAlchemy 2.0 async models (users, categories, products, warehouses, stock_levels, stock_transfers, audit_logs) with proper constraints, indexes, and relationships. Configure Alembic for async migrations using the direct Neon connection and generate the initial migration.

### Scope Boundary
- Builds on Card 0's database.py engine and config.py settings
- This card creates ONLY the data layer — no API endpoints, no services, no schemas
- The TSVECTOR computed column and GIN index on products are part of this card
- Alembic env.py MUST use DATABASE_URL_DIRECT (non-pooled) because PgBouncer doesn't support DDL

### Prerequisites
- Card 0 (Project Setup) must be complete — needs database.py, config.py

### Deliverables
1. \`src/models/base.py\` — SQLAlchemy DeclarativeBase, UUID primary key mixin (uuid4 default), created_at/updated_at timestamp mixin (TIMESTAMPTZ, server_default=now(), onupdate=now())
2. \`src/models/user.py\` — User model: email (VARCHAR 255, UNIQUE), name (VARCHAR 100), password_hash (VARCHAR 255), role (VARCHAR 20, default "user"), api_key_hash (VARCHAR 255, UNIQUE, nullable), api_key_prefix (VARCHAR 10, nullable), is_active (BOOLEAN, default true)
3. \`src/models/category.py\` — Category model: name (VARCHAR 100), description (TEXT, nullable), parent_id (UUID, FK self-referential, nullable for tree structure), relationship to children and products
4. \`src/models/product.py\` — Product model: name (VARCHAR 200), sku (VARCHAR 50, UNIQUE), description (TEXT, nullable), price (NUMERIC 10,2, CHECK >= 0), weight_kg (NUMERIC 8,3, nullable), category_id (UUID, FK, NOT NULL), is_active (BOOLEAN, default true), search_vector (TSVECTOR, computed from name + coalesce(description, '')), GIN index on search_vector
5. \`src/models/warehouse.py\` — Warehouse model: name (VARCHAR 100), location (VARCHAR 200), capacity (INTEGER, CHECK > 0), is_active (BOOLEAN, default true)
6. \`src/models/stock_level.py\` — StockLevel model: product_id (UUID, FK), warehouse_id (UUID, FK), quantity (INTEGER, default 0, CHECK >= 0), min_threshold (INTEGER, default 10, CHECK >= 0), UNIQUE constraint on (product_id, warehouse_id)
7. \`src/models/stock_transfer.py\` — StockTransfer model: product_id (FK), from_warehouse_id (FK), to_warehouse_id (FK), quantity (INTEGER, CHECK > 0), initiated_by (UUID, FK users), notes (TEXT, nullable), CHECK constraint (from_warehouse_id != to_warehouse_id)
8. \`src/models/audit_log.py\` — AuditLog model: user_id (FK), action (VARCHAR 20), resource_type (VARCHAR 50), resource_id (UUID), changes (JSONB, nullable), ip_address (VARCHAR 45, nullable), composite index on (resource_type, created_at)
9. \`src/models/__init__.py\` — Re-export all models (User, Category, Product, Warehouse, StockLevel, StockTransfer, AuditLog) for Alembic autogenerate detection
10. \`alembic.ini\` + \`alembic/env.py\` + \`alembic/script.mako\` — Alembic config with empty sqlalchemy.url (loaded from env at runtime), async env.py that imports all models from src.models, reads DATABASE_URL_DIRECT from os.environ, uses async engine with asyncpg for migrations
11. Initial Alembic migration — \`alembic revision --autogenerate -m "initial schema"\` generating all 7 tables with constraints, indexes, and the GIN index on products.search_vector

### Technical Specification
- SQLAlchemy 2.0 Mapped[] annotation style (not legacy Column())
- UUID columns use \`sqlalchemy.dialects.postgresql.UUID\` or \`mapped_column(Uuid)\`
- TSVECTOR column uses \`sqlalchemy.dialects.postgresql.TSVECTOR\`
- search_vector should be a computed column: \`to_tsvector('english', name || ' ' || coalesce(description, ''))\`
- GIN index: \`Index('ix_products_search_vector', 'search_vector', postgresql_using='gin')\`
- Alembic env.py MUST use DATABASE_URL_DIRECT (direct Neon connection) — PgBouncer in transaction mode cannot execute DDL
- All models must be importable via \`from src.models import User, Product, ...\`
- All CHECK constraints and UNIQUE constraints defined at the model level for autogenerate pickup`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic SAPFB-2.

### Stories Included

- **Foundation \u2014 Base mixins and User model complete**
  - Files: .gitignore, src/models/base.py, src/models/user.py
- **Catalog models \u2014 Category and Product with TSVECTOR complete**
  - Files: .gitignore, src/models/__pycache__/stock_level.cpython-312.pyc, src/models/__pycache__/warehouse.cpython-312.pyc (+6 more)
- **Inventory models \u2014 Warehouse and StockLevel complete**
  - Files: .gitignore, src/models/base.py, src/models/category.py (+4 more)
- **Cross-entity models \u2014 StockTransfer and AuditLog complete**
  - Files: .gitignore, src/models/__init__.py, src/models/audit_log.py (+7 more)
- **Model registry and Alembic async migration config complete**
  - Files: .gitignore, alembic.ini, alembic/env.py (+11 more)

### Branches Merged

- \`story/sapfb-2/0-foundation-base-mixins-and-use\`
- \`story/sapfb-2/1-catalog-models-category-and-pr\`
- \`story/sapfb-2/2-inventory-models-warehouse-and\`
- \`story/sapfb-2/3-cross-entity-models-stocktrans\`
- \`story/sapfb-2/4-model-registry-and-alembic-asy\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  },
  {
    "id": "sa-3",
    "title": "SAPFB-3: Pydantic V2 request/response schemas",
    "priority": "high",
    "storyCount": 5,
    "duration": "~25 min",
    "status": "completed",
    "techLeadScore": "9/10",
    "prNumber": 3,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/3",
    "commentCount": 5,
    "personas": [
      "backend_developer",
      "security_engineer"
    ],
    "description": `### Epic Overview
Implement the complete authentication system: JWT access/refresh tokens, bcrypt password hashing, API key generation, dual-auth dependency (Bearer JWT + X-API-Key header), and all auth endpoints (register, login, refresh, me). This is the security foundation that every protected endpoint depends on.

### Scope Boundary
- Builds on Card 0 (app skeleton, config) and Card 1 (User model)
- Creates auth endpoints, auth service, and FastAPI dependencies
- Must NOT implement rate limiting (Card 3) or audit logging (Card 3) — just the auth plumbing
- Creates the main API router and health endpoint as the first working routes

### Prerequisites
- Card 0 (Project Setup) — needs main.py, config.py, database.py
- Card 1 (Database Models) — needs User model and migrations

### Deliverables
1. \`src/schemas/auth.py\` — Pydantic V2 models: RegisterRequest (email, password, name), LoginRequest (email, password), TokenResponse (access_token, refresh_token, token_type, expires_in), RefreshRequest (refresh_token), UserResponse (id, email, name, role, created_at), RegisterResponse (extends UserResponse + api_key shown once)
2. \`src/schemas/common.py\` — PaginatedResponse generic model (data list, pagination: page/per_page/total/total_pages), ErrorResponse (error: code/message/details list), ErrorDetail (field, message)
3. \`src/schemas/health.py\` — HealthResponse (status, database, version, built_by)
4. \`src/services/auth.py\` — JWT token creation (HS256, sub=user_id, email, role), access token (30min expiry), refresh token (7-day expiry), token verification/decode; password hashing (bcrypt, 12 rounds) and verification; API key generation (64-char random with sk_ prefix), API key hashing (SHA-256), API key verification
5. \`src/dependencies.py\` — get_db (async session yield), get_current_user dependency (extracts user from Authorization Bearer JWT OR X-API-Key header, returns User or raises 401), require_admin dependency (checks user.role == "admin", raises 403)
6. \`src/api/auth.py\` — POST /register (create user, generate API key, return once), POST /login (verify credentials, return access+refresh tokens), POST /refresh (verify refresh token, issue new access token), GET /me (return current user profile)
7. \`src/api/health.py\` — GET /health (execute SELECT 1 to verify DB, return status ok/degraded with database connected/disconnected, always HTTP 200 for Railway healthcheck)
8. \`src/api/__init__.py\` + \`src/api/router.py\` — Main APIRouter, mount auth router at /auth and health router, wire into main.py app with /api/v1 prefix
9. Security scheme registration — Configure FastAPI SecurityScheme for both HTTPBearer and APIKeyHeader so Swagger UI shows "Authorize" button with both options
10. Duplicate email handling — Return 409 ALREADY_EXISTS on registration with existing email (catch IntegrityError)

### Technical Specification
- python-jose with cryptography backend for JWT (HS256 algorithm)
- passlib with bcrypt backend, 12 rounds for password hashing
- API key format: \`sk_\` + 64 random hex chars; store SHA-256 hash + first 8 chars as prefix for identification
- Refresh tokens are single-use: embed \`type: refresh\` in JWT payload, verify on refresh endpoint
- get_current_user checks Authorization header first (Bearer <jwt>), then X-API-Key header — first valid wins
- All auth endpoints return standard error format on failure
- Health endpoint MUST return 200 even when DB is down (Railway healthcheck requirement)`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic SAPFB-3.

### Stories Included

- **Pydantic V2 request/response schemas complete**
  - Files: .gitignore, src/schemas/__init__.py, src/schemas/auth.py (+2 more)
- **Core authentication service complete**
  - Files: .gitignore, src/services/__init__.py, src/services/auth.py
- **FastAPI dependency injection layer complete**
  - Files: src/dependencies.py, src/schemas/__init__.py, src/schemas/auth.py (+5 more)
- **Auth API endpoints complete**
  - Files: src/api/__init__.py, src/api/auth.py, src/api/health.py (+11 more)
- **Health endpoint, API router, and main.py wiring complete**
  - Files: pyproject.toml, src/api/__init__.py, src/api/auth.py (+13 more)

### Branches Merged

- \`story/sapfb-3/0-pydantic-v2-request-response-s\`
- \`story/sapfb-3/1-core-authentication-service\`
- \`story/sapfb-3/2-fastapi-dependency-injection-l\`
- \`story/sapfb-3/3-auth-api-endpoints\`
- \`story/sapfb-3/4-health-endpoint-api-router-and\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  },
  {
    "id": "sa-4",
    "title": "SAPFB-4: Error handling middleware",
    "priority": "high",
    "storyCount": 5,
    "duration": "~24 min",
    "status": "completed",
    "techLeadScore": "9/10",
    "prNumber": 4,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/4",
    "commentCount": 5,
    "personas": [
      "backend_developer",
      "security_engineer"
    ],
    "description": `### Epic Overview
Build the cross-cutting infrastructure layer: global error handlers with consistent error format, rate limiting via slowapi, audit log recording service, audit query endpoint, request ID middleware, and structured access logging. These are foundational services consumed by all CRUD cards.

### Scope Boundary
- Builds on Card 0 (main.py), Card 1 (AuditLog model), Card 2 (auth dependencies)
- Creates the audit recording service that Cards 4 and 5 will call from their write endpoints
- Creates rate limiting infrastructure — Cards 4 and 5 will use the rate limiter decorator
- Must NOT implement CRUD endpoints for products, categories, warehouses, or stock

### Prerequisites
- Card 0 (Project Setup) — needs main.py for middleware registration
- Card 1 (Database Models) — needs AuditLog model
- Card 2 (Auth System) — needs auth dependencies for audit endpoint protection

### Deliverables
1. \`src/middleware/error_handler.py\` — Global exception handlers: RequestValidationError -> 422 with field-level details [{field, message}], HTTPException -> standard error format with code mapping (404->NOT_FOUND, 401->UNAUTHORIZED, 403->FORBIDDEN, etc.), SQLAlchemy IntegrityError -> 409 ALREADY_EXISTS, catch-all Exception -> 500 INTERNAL_ERROR (log traceback, return generic message, NO stack trace in response)
2. \`src/middleware/rate_limit.py\` — slowapi Limiter setup with key_func variants: IP-based for auth endpoints, user_id/api_key-based for authenticated endpoints; per-endpoint decorators: 5/min register, 10/min login, 30/min refresh, 100/min all other authenticated endpoints; in-memory storage (acceptable for single-instance)
3. Rate limit response headers — X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset on ALL responses; 429 responses include Retry-After header and standard error format with code RATE_LIMITED
4. \`src/services/audit.py\` — Audit recording service: async function accepting user_id, action (create/update/delete/transfer), resource_type, resource_id, changes (JSON diff for updates: {field: {old, new}}), ip_address (from request.client.host); creates AuditLog record in database; designed to be called from any write endpoint
5. \`src/schemas/audit.py\` — AuditLogResponse (id, user_id, action, resource_type, resource_id, changes, ip_address, created_at), AuditLogQuery params (page, per_page, start_date, end_date, action, resource_type, user_id)
6. \`src/api/audit.py\` — GET /audit-log endpoint (admin only via require_admin dependency), paginated, filterable by date range, action, resource_type, user_id; returns PaginatedResponse
7. Request ID middleware — Generate UUID, attach as X-Request-Id response header on every request; make request_id available to logging
8. Structured access logging middleware — Log each request as JSON: {method, path, status, duration_ms, request_id}; use Python logging, not print
9. Wire all middleware into main.py — Register error handlers, rate limiter state/exception handler, request ID middleware, access logging middleware; ensure correct middleware ordering
10. Apply rate limit decorators to existing auth endpoints from Card 2 (5/min register, 10/min login, 30/min refresh, 100/min me)

### Technical Specification
- slowapi uses in-memory storage — rate limit state resets on container restart (acceptable for showcase)
- slowapi key function for authenticated endpoints should extract user_id from JWT or hash API key
- Error handler for IntegrityError should detect unique constraint violations specifically
- Audit service should be a standalone async function (not middleware) — called explicitly from endpoints for control over what gets logged
- Changes diff format: \`{"name": {"old": "Widget A", "new": "Widget B"}}\` — compute by comparing old and new model state
- Request ID middleware should run outermost (first in, last out) for consistent tracking
- All middleware must be async-compatible`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic SAPFB-4.

### Stories Included

- **Error handling middleware complete**
  - Files: docs/plans/2026-02-19-error-handler-middleware.md, src/middleware/__init__.py, src/middleware/error_handler.py (+1 more)
- **Request ID and access logging middleware complete**
  - Files: docs/plans/2026-02-19-error-handler-middleware.md, src/middleware/__init__.py, src/middleware/access_log.py (+5 more)
- **Audit recording service, schemas, and query endpoint complete**
  - Files: docs/plans/2026-02-19-error-handler-middleware.md, src/api/audit.py, src/api/router.py (+10 more)
- **Rate limiting infrastructure complete**
  - Files: docs/plans/2026-02-19-error-handler-middleware.md, src/api/audit.py, src/api/auth.py (+14 more)
- **Wire middleware into main.py and apply rate limits to auth complete**
  - Files: docs/plans/2026-02-19-error-handler-middleware.md, src/api/audit.py, src/api/auth.py (+15 more)

### Branches Merged

- \`story/sapfb-4/0-error-handling-middleware\`
- \`story/sapfb-4/1-request-id-and-access-logging\`
- \`story/sapfb-4/2-audit-recording-service-schema\`
- \`story/sapfb-4/3-rate-limiting-infrastructure\`
- \`story/sapfb-4/4-wire-middleware-into-main-py-a\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  },
  {
    "id": "sa-5",
    "title": "SAPFB-6: Pydantic schemas for warehouse and stock",
    "priority": "medium",
    "storyCount": 4,
    "duration": "~20 min",
    "status": "completed",
    "techLeadScore": "9/10",
    "prNumber": 5,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/5",
    "commentCount": 4,
    "personas": [
      "backend_developer"
    ],
    "description": `### Epic Overview
Implement warehouse CRUD, stock level management, atomic stock transfers between warehouses, and low-stock alert queries. The stock transfer operation is the most complex business logic in the API — requiring single-transaction atomicity with rollback on insufficient stock.

### Scope Boundary
- Builds on Card 1 (Warehouse/StockLevel/StockTransfer models), Card 2 (auth), Card 3 (audit/middleware)
- Can run in parallel with Card 4 (Categories & Products) — both depend on Cards 0-3
- Must NOT modify product or category endpoints (Card 4)
- Stock operations create audit log entries via the audit service from Card 3

### Prerequisites
- Card 0 (Project Setup)
- Card 1 (Database Models) — needs Warehouse, StockLevel, StockTransfer models
- Card 2 (Auth System) — needs get_current_user, require_admin
- Card 3 (Middleware & Audit) — needs audit service, error handlers

### Deliverables
1. \`src/schemas/warehouse.py\` — WarehouseCreate (name, location, capacity), WarehouseUpdate (all optional), WarehouseResponse (all fields), WarehouseDetailResponse (extends with stock summary: total_products, total_quantity, capacity_utilization_pct)
2. \`src/schemas/stock.py\` — StockUpdateRequest (quantity, min_threshold optional), StockLevelResponse (product info, warehouse info, quantity, min_threshold), TransferRequest (product_id, from_warehouse_id, to_warehouse_id, quantity, notes), TransferResponse (id, all fields, created_at), StockAlertResponse (product, warehouse, quantity, min_threshold, deficit)
3. \`src/api/warehouses.py\` — GET /warehouses (list, paginated), POST /warehouses (admin only), GET /warehouses/{id} (detail with stock summary), PUT /warehouses/{id} (update), GET /warehouses/{id}/stock (paginated stock levels for warehouse)
4. \`src/api/stock.py\` — PUT /stock/{product_id}/{warehouse_id} (update stock level, create if not exists), POST /stock/transfer (atomic transfer), GET /stock/alerts (products below min_threshold, paginated)
5. \`src/services/stock.py\` — Atomic transfer logic: verify source has sufficient quantity, decrement source, increment destination (create stock_level if not exists), record StockTransfer with initiated_by=current_user, ALL in single database transaction with proper rollback
6. Warehouse detail with stock summary — GET /warehouses/{id} computes: total distinct products stocked, total quantity across all products, capacity utilization percentage (total_quantity / capacity * 100)
7. Stock alerts query — GET /stock/alerts returns stock_levels where quantity < min_threshold, includes product info (name, sku) and warehouse info (name, location), sorted by severity (deficit = min_threshold - quantity, DESC), paginated
8. Transfer validation — Return 400 INSUFFICIENT_STOCK if source quantity < transfer quantity (verify no partial update occurred); Return 400 INVALID_OPERATION if from_warehouse_id == to_warehouse_id
9. Auto-create stock_level on transfer — If destination warehouse has no stock_level record for the product, create one with quantity=0 + transfer amount and default min_threshold
10. Audit log integration — All stock writes call audit service: stock level updates (action=update, resource_type=stock_level), transfers (action=transfer, resource_type=stock_level with both warehouse changes), warehouse CRUD operations
11. Mount warehouse and stock routers in api/router.py with tags "Warehouses" and "Stock"

### Technical Specification
- Atomic transfer: use \`async with session.begin()\` for the entire transfer operation — if any step fails, everything rolls back
- SELECT FOR UPDATE on source stock_level to prevent race conditions on concurrent transfers
- Insufficient stock check: query source stock_level quantity, compare with requested transfer quantity, raise before any writes
- Stock alerts: \`SELECT ... FROM stock_levels JOIN products JOIN warehouses WHERE quantity < min_threshold ORDER BY (min_threshold - quantity) DESC\`
- Capacity utilization: \`SUM(quantity) / warehouse.capacity * 100\` — handle division by zero
- All stock endpoints use 100/min rate limit (authenticated endpoints default)`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic SAPFB-6.

### Stories Included

- **Pydantic schemas for warehouse and stock complete**
  - Files: docs/plans/2026-02-19-warehouse-stock-schemas.md, pyproject.toml, src/schemas/__init__.py (+5 more)
- **Stock service layer with atomic transfers complete**
  - Files: docs/plans/2026-02-19-warehouse-stock-schemas.md, pyproject.toml, src/schemas/__init__.py (+7 more)
- **Warehouse CRUD API routes complete**
  - Files: docs/plans/2026-02-19-warehouse-stock-schemas.md, pyproject.toml, src/api/router.py (+9 more)
- **Stock API routes and router registration complete**
  - Files: docs/plans/2026-02-19-warehouse-stock-schemas.md, pyproject.toml, src/api/router.py (+10 more)

### Branches Merged

- \`story/sapfb-6/0-pydantic-schemas-for-warehouse\`
- \`story/sapfb-6/1-stock-service-layer-with-atomi\`
- \`story/sapfb-6/2-warehouse-crud-api-routes\`
- \`story/sapfb-6/3-stock-api-routes-and-router-re\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  },
  {
    "id": "sa-6",
    "title": "SAPFB-5: Foundation \u2014 schemas, pagination utility, and audit service",
    "priority": "medium",
    "storyCount": 5,
    "duration": "~25 min",
    "status": "completed",
    "techLeadScore": "9/10",
    "prNumber": 6,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/6",
    "commentCount": 5,
    "personas": [
      "backend_developer"
    ],
    "description": `### Epic Overview
Implement complete CRUD endpoints for categories and products, including PostgreSQL full-text search with ts_rank relevance ordering, combined multi-filter queries, pagination, sorting, and audit log integration on all write operations. This is the core data management surface of the API.

### Scope Boundary
- Builds on Card 1 (Category/Product models), Card 2 (auth deps), Card 3 (audit service, error handlers, rate limiting)
- Creates category and product Pydantic schemas, API routes, and query logic
- Must NOT touch warehouse, stock, or transfer functionality (Card 5)
- Product detail endpoint includes stock levels per warehouse (read-only join)

### Prerequisites
- Card 0 (Project Setup)
- Card 1 (Database Models) — needs Category, Product models with search_vector
- Card 2 (Auth System) — needs get_current_user, require_admin dependencies
- Card 3 (Middleware & Audit) — needs audit recording service, error handlers, rate limiter

### Deliverables
1. \`src/schemas/category.py\` — CategoryCreate (name, description, parent_id optional), CategoryUpdate (all optional), CategoryResponse (id, name, description, parent_id, created_at, updated_at), CategoryDetailResponse (extends with products list)
2. \`src/schemas/product.py\` — ProductCreate (name, sku, description, price, weight_kg, category_id, is_active), ProductUpdate (all optional), ProductResponse (id, all fields + category info), ProductDetailResponse (extends with stock_levels per warehouse), ProductListParams (page, per_page, sort_by, sort_order, search, category_id, min_price, max_price, is_active)
3. \`src/api/categories.py\` — GET /categories (list all, flat with parent_id), POST /categories (admin only, create), GET /categories/{id} (detail with paginated products), PUT /categories/{id} (admin only, update), DELETE /categories/{id} (admin only, with cascade protection)
4. \`src/api/products.py\` — GET /products (paginated, filterable, searchable), POST /products (create), GET /products/{id} (detail with stock levels), PUT /products/{id} (update), DELETE /products/{id} (admin only, soft-delete sets is_active=false)
5. Full-text search implementation — Query using \`search_vector @@ plainto_tsquery('english', :term)\`, order by \`ts_rank(search_vector, query) DESC\` when search is active, fall back to normal sort_by when no search term
6. Pagination utility — Reusable async function: accepts SQLAlchemy query, page, per_page (max 100), returns {data, pagination: {page, per_page, total, total_pages}}; used by all list endpoints
7. Combined filter query builder — Products support simultaneous: category_id, min_price, max_price, is_active filters; sort_by (name, price, created_at, sku) + sort_order (asc, desc); all filters are optional and combinable
8. Category cascade protection — DELETE /categories/{id} returns 400 INVALID_OPERATION if category has any products (active or inactive); check before delete
9. Product detail with stock levels — GET /products/{id} includes eager-loaded stock_levels with warehouse info (warehouse name, location, quantity, min_threshold)
10. Audit log integration — All write operations (create category, update category, delete category, create product, update product, soft-delete product) call audit recording service with proper action, resource_type, resource_id, and changes diff for updates
11. Mount category and product routers in api/router.py with tags "Categories" and "Products"

### Technical Specification
- Full-text search: \`func.to_tsvector('english', ...)\` and \`func.plainto_tsquery('english', search_term)\` via SQLAlchemy \`func\`
- ts_rank for relevance ordering: \`func.ts_rank(Product.search_vector, query)\`
- Pagination: use \`select().offset().limit()\` with separate \`select(func.count())\` for total
- Sorting: whitelist allowed sort fields to prevent SQL injection via column name
- per_page max capped at 100 (clamp, don't error)
- Soft delete: set is_active=false, do NOT delete the row (FK references must survive)
- Changes diff: for updates, load current state, compare with update payload, record only changed fields`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic SAPFB-5.

### Stories Included

- **Foundation \u2014 schemas, pagination utility, and audit service complete**
  - Files: src/schemas/__init__.py, src/schemas/category.py, src/schemas/product.py (+4 more)
- **Category endpoint test suite complete**
  - Files: src/api/__init__.py, src/api/categories.py, src/schemas/__init__.py (+7 more)
- **Category CRUD endpoint layer with cascade protection complete**
  - Files: src/api/__init__.py, src/api/categories.py, src/schemas/__init__.py (+7 more)
- **Product CRUD endpoints with full-text search and router mounting complete**
  - Files: src/api/__init__.py, src/api/categories.py, src/api/products.py (+9 more)
- **Product endpoint test suite complete**
  - Files: src/api/__init__.py, src/api/categories.py, src/api/products.py (+10 more)

### Branches Merged

- \`story/sapfb-5/0-foundation-schemas-pagination\`
- \`story/sapfb-5/1-category-crud-endpoint-layer-w\`
- \`story/sapfb-5/2-product-crud-endpoints-with-fu\`
- \`story/sapfb-5/3-category-endpoint-test-suite\`
- \`story/sapfb-5/4-product-endpoint-test-suite\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  },
  {
    "id": "sa-7",
    "title": "SAPFB-7: Seed script \u2014 admin user, categories, and products",
    "priority": "medium",
    "storyCount": 7,
    "duration": "~30 min",
    "status": "completed",
    "techLeadScore": "9/10",
    "prNumber": 7,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/7",
    "commentCount": 7,
    "personas": [
      "backend_developer"
    ],
    "description": `### Epic Overview
Create the idempotent seed script that populates the database with realistic demo data (admin user, categories, products, warehouses, stock, transfers, audit entries), write the comprehensive README.md, and enhance OpenAPI documentation with request/response examples on every endpoint.

### Scope Boundary
- Builds on ALL feature cards (0-5) — needs every model, endpoint, and service to exist
- Creates seed data, README, and OpenAPI enhancements
- Must NOT modify any endpoint logic or model definitions
- Seed script imports from src.models and uses the same async SQLAlchemy engine

### Prerequisites
- Card 0 (Project Setup) — base structure
- Card 1 (Database Models) — all models
- Card 2 (Auth System) — for demo user creation with password hashing
- Card 3 (Middleware & Audit) — audit service
- Card 4 (Categories & Products) — for product/category data
- Card 5 (Warehouses & Stock) — for warehouse/stock data

### Deliverables
1. \`seed/seed.py\` — Idempotent seed script using async SQLAlchemy: check-before-insert pattern (e.g., check if admin user exists by email before creating), imports models from src.models, uses auth service for password hashing and API key hashing
2. Demo admin user — email: demo@workermill.com, password: ****, name: Demo Admin, role: admin, API key: sk_demo_**** (SHA-256 hashed, prefix stored)
3. 5 top-level categories with 15 subcategories — Electronics (Smartphones, Laptops, Accessories), Clothing (Men's, Women's, Kids'), Home & Garden (Kitchen, Outdoor, Decor), Sports (Running, Cycling, Swimming), Books (Fiction, Technical, Business)
4. 50 products distributed across categories — Realistic names, SKUs (format: ELEC-MON-001), 2-3 sentence descriptions with varied vocabulary for search testing ("monitor", "running shoes", "organic" all return results), prices $5.99-$2,499.99, weights 0.1-25.0 kg, 45 active + 5 inactive
5. 3 warehouses — East Coast Hub (New York, capacity 10000), West Coast Hub (Los Angeles, capacity 8000), Central Warehouse (Chicago, capacity 12000)
6. 150 stock levels — Each product in 1-3 warehouses, ~10 products with at least one stock below min_threshold for alerts testing, quantities 0-500, min_thresholds 5-50
7. 20 stock transfers + 50 audit log entries — Transfers from past 30 days by demo admin, audit entries mix of create/update/delete/transfer with realistic JSONB changes diffs
8. \`README.md\` — Title + tagline, "Built by WorkerMill" badge, live demo links (Swagger/ReDoc/health), demo credentials (email/password/API key), quick start guide (clone -> docker compose -> uv sync -> migrate -> seed -> run), full API endpoint summary table (all endpoints with method/auth/description), text-based architecture diagram (Railway -> FastAPI -> Neon), tech stack table, testing instructions, deployment explanation
9. OpenAPI documentation enhancements — Add request body examples and response examples (via Pydantic model_config json_schema_extra or Field examples) on every endpoint; document error responses (401, 403, 404, 422, 429) on each endpoint via FastAPI responses parameter
10. Verify Swagger UI Authorize button — Both Bearer JWT and API Key auth schemes work in interactive docs; test auth flow in Swagger: login -> copy token -> authorize -> hit protected endpoints

### Technical Specification
- Seed script uses \`asyncio.run()\` as entry point, creates async engine directly from DATABASE_URL env var
- Idempotency: check \`SELECT ... WHERE email = 'demo@workermill.com'\` before creating admin; check category names before creating; etc.
- Use auth service's hash_password and hash_api_key functions for consistency
- Product descriptions must be rich enough for meaningful full-text search: include brand-like names, material descriptions, use-case sentences
- SKU format: \`{CATEGORY_PREFIX}-{SUBCATEGORY_PREFIX}-{3-digit number}\` (e.g., ELEC-MON-001)
- Stock below threshold: ensure at least 10 distinct products have quantity < min_threshold across any warehouse
- Audit log entries should have realistic timestamps spread across the past 30 days
- OpenAPI examples: use Pydantic Field(json_schema_extra={"examples": [...]}) or model Config schema_extra`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic SAPFB-7.

### Stories Included

- **Seed script \u2014 admin user, categories, and products complete**
  - Files: seed/__init__.py, seed/__main__.py, seed/seed.py
- **README.md \u2014 comprehensive project documentation complete**
  - Files: README.md, seed/__init__.py, seed/__main__.py (+1 more)
- **Seed script \u2014 warehouses, stock, transfers, and audit logs complete**
  - Files: seed/__init__.py, seed/__main__.py, seed/seed.py
- **OpenAPI enhancements \u2014 auth, health, and common schemas complete**
  - Files: README.md, seed/__init__.py, seed/__main__.py (+5 more)
- **OpenAPI enhancements \u2014 category and product endpoints complete**
  - Files: README.md, seed/__init__.py, seed/__main__.py (+9 more)
- **OpenAPI enhancements \u2014 warehouse, stock, and audit endpoints complete**
  - Files: README.md, seed/__init__.py, seed/__main__.py (+14 more)
- **Swagger UI auth verification and OpenAPI security schemes complete**
  - Files: README.md, seed/__init__.py, seed/__main__.py (+16 more)

### Branches Merged

- \`story/sapfb-7/0-seed-script-admin-user-categor\`
- \`story/sapfb-7/1-seed-script-warehouses-stock-t\`
- \`story/sapfb-7/2-openapi-enhancements-auth-heal\`
- \`story/sapfb-7/3-openapi-enhancements-category\`
- \`story/sapfb-7/4-openapi-enhancements-warehouse\`
- \`story/sapfb-7/5-readme-md-comprehensive-projec\`
- \`story/sapfb-7/6-swagger-ui-auth-verification-a\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  },
  {
    "id": "sa-8",
    "title": "SAPFB-8: Test infrastructure \u2014 conftest.py fixtures and health tests",
    "priority": "medium",
    "storyCount": 6,
    "duration": "~28 min",
    "status": "completed",
    "techLeadScore": "9/10",
    "prNumber": 8,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/8",
    "commentCount": 6,
    "personas": [
      "backend_developer",
      "qa_engineer"
    ],
    "description": `### Epic Overview
Build the full pytest test suite covering all endpoints, business logic edge cases, auth flows, rate limiting, error format consistency, and search relevance. Tests run against a real PostgreSQL database with async httpx client — no mocking of database operations.

### Scope Boundary
- Builds on ALL feature cards (0-5) — tests every endpoint and service
- Creates test fixtures, 9 test files, and coverage configuration
- Must NOT modify any application code — only add test files
- Tests must achieve >80% code coverage

### Prerequisites
- Card 0 (Project Setup) — pytest config in pyproject.toml
- Card 1 (Database Models) — models and migrations to test against
- Card 2 (Auth System) — auth endpoints and dependencies
- Card 3 (Middleware & Audit) — error handlers, rate limiting, audit endpoints
- Card 4 (Categories & Products) — CRUD and search endpoints
- Card 5 (Warehouses & Stock) — stock management endpoints

### Deliverables
1. \`tests/__init__.py\` + \`tests/conftest.py\` — Fixtures: test PostgreSQL database (create shipapi_test DB, run Alembic migrations, drop after), async_client (httpx.AsyncClient with FastAPI test app), auth_headers (register + login a regular user, return Bearer headers), admin_headers (register + login admin user, return Bearer headers), seeded_db (populate with representative test data)
2. \`tests/test_health.py\` — Health check returns 200, status "ok", database "connected", version, built_by; verify response schema
3. \`tests/test_auth.py\` — Register new user (201 + api_key returned), login with credentials (200 + tokens), refresh token (new access token), GET /me with JWT, GET /me with X-API-Key, duplicate email (409), invalid credentials (401), expired token (401), invalid token format (401)
4. \`tests/test_categories.py\` — Create category (admin), list categories, get detail with products, update (admin), delete (admin), cascade protection (400 when category has products), non-admin create (403), non-admin delete (403)
5. \`tests/test_products.py\` — Create product, list with pagination (verify total/total_pages), search "monitor" returns relevant results, filter by category_id, filter by price range, filter by is_active, combined filters, sort by name/price/created_at asc/desc, get detail with stock levels, update product, soft-delete (admin, verify is_active=false), duplicate SKU (409)
6. \`tests/test_warehouses.py\` — Create warehouse (admin), list warehouses, get detail with stock summary (total_products, total_quantity, capacity_utilization), update warehouse, get warehouse stock (paginated), non-admin create (403)
7. \`tests/test_stock.py\` — Update stock level (create new + update existing), atomic transfer (verify source decremented AND destination incremented AND transfer record created), insufficient stock transfer (400, verify NO partial update), same-warehouse transfer (400), GET /stock/alerts returns products below threshold
8. \`tests/test_audit.py\` — Create product then verify audit entry exists, update product then verify changes diff, query with date range filter, query with action filter, query with resource_type filter, query with user_id filter, non-admin access (403)
9. \`tests/test_rate_limit.py\` — Send requests exceeding register limit (5/min), verify 429 on excess, verify Retry-After header present, verify X-RateLimit-* headers on normal responses
10. \`tests/test_errors.py\` — Verify all error responses match standard format {error: {code, message, details}}, test 404 (nonexistent resource), 422 (invalid request body with field details), 409 (duplicate), 401 (no auth), 403 (non-admin)
11. Coverage enforcement — Verify \`pytest --cov=src --cov-fail-under=80\` passes; identify and cover any gaps

### Technical Specification
- pytest-asyncio with auto mode (asyncio_mode = "auto" in pyproject.toml)
- httpx.AsyncClient with \`ASGITransport(app=app)\` for in-process testing
- Test database: separate PostgreSQL database (shipapi_test), created/dropped per session
- Fixtures use \`@pytest.fixture(scope="session")\` for DB setup, \`scope="function"\` for client/auth
- Stock transfer atomicity test: verify both source and destination quantities changed, then verify a failed transfer leaves both unchanged
- Search test: seed products with known descriptions, search specific terms, verify correct products returned and ranked
- Rate limit test: may need to use a fresh limiter state or test against a separate app instance
- All test functions are async (\`async def test_...\`)
- No database mocking — all tests hit real PostgreSQL`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic SAPFB-8.

### Stories Included

- **Test infrastructure \u2014 conftest.py fixtures and health tests complete**
  - Files: pyproject.toml, tests/conftest.py, tests/test_health.py
- **Auth endpoint integration tests complete**
  - Files: pyproject.toml, tests/conftest.py, tests/test_auth.py (+1 more)
- **Rate limiting and error format tests complete**
  - Files: pyproject.toml, tests/conftest.py, tests/test_auth.py (+3 more)
- **Category and product endpoint tests complete**
  - Files: pyproject.toml, tests/conftest.py, tests/test_auth.py (+3 more)
- **Warehouse and stock management tests complete**
  - Files: pyproject.toml, src/api/router.py, tests/conftest.py (+6 more)
- **Audit log endpoint tests complete**
  - Files: pyproject.toml, src/api/router.py, tests/conftest.py (+7 more)

### Branches Merged

- \`story/sapfb-8/0-test-infrastructure-conftest-p\`
- \`story/sapfb-8/1-auth-endpoint-integration-test\`
- \`story/sapfb-8/2-rate-limiting-and-error-format\`
- \`story/sapfb-8/3-category-and-product-endpoint\`
- \`story/sapfb-8/4-warehouse-and-stock-management\`
- \`story/sapfb-8/5-audit-log-endpoint-tests\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  },
  {
    "id": "sa-9",
    "title": "SAPFB-9: CI quality gates workflow",
    "priority": "medium",
    "storyCount": 2,
    "duration": "~15 min",
    "status": "completed",
    "techLeadScore": "9/10",
    "prNumber": 9,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/9",
    "commentCount": 2,
    "personas": [
      "backend_developer",
      "devops_engineer"
    ],
    "description": `### Epic Overview
Create GitHub Actions workflows for continuous integration (lint, format check, type check, test with PostgreSQL service container) and continuous deployment (Railway CLI deploy on merge to main with post-deploy smoke tests). These pipelines enforce all quality gates automatically.

### Scope Boundary
- Builds on Card 0 (project structure, pyproject.toml) and Card 7 (test suite)
- Creates only GitHub Actions workflow files and any supporting CI configuration
- Must NOT modify application code, tests, or deployment configuration (railway.toml already done in Card 0)
- Workflows use pre-set GitHub repo secrets (RAILWAY_TOKEN, RAILWAY_SVC_ID)

### Prerequisites
- Card 0 (Project Setup) — needs pyproject.toml, Dockerfile, railway.toml
- Card 7 (Test Suite) — CI pipeline runs the test suite; must exist to validate

### Deliverables
1. \`.github/workflows/ci.yml\` — Triggered on push to main and all PRs to main; runs quality job on ubuntu-latest
2. PostgreSQL 16 service container in CI — postgres:16 with test/test/shipapi_test credentials, port 5432, health check (pg_isready)
3. uv setup step — \`astral-sh/setup-uv@v5\` with version "latest", then \`uv sync --frozen\` for dependency installation
4. Lint step — \`uv run ruff check .\` (zero errors required)
5. Format check step — \`uv run ruff format --check .\` (fully formatted required)
6. Type check step — \`uv run mypy src --strict\` (zero errors required)
7. Test step — \`uv run pytest tests/ -v --cov=src --cov-report=term-missing --cov-fail-under=80\` with env vars DATABASE_URL, DATABASE_URL_DIRECT (both pointing to test postgres), JWT_SECRET_KEY=****
8. \`.github/workflows/deploy.yml\` — Triggered on push to main only; deploy job runs in \`ghcr.io/railwayapp/cli:latest\` container; checkout code, \`railway up --service $RAILWAY_SVC_ID\` with RAILWAY_TOKEN from secrets
9. Post-deploy smoke test — Wait 60s for deployment, then retry loop (5 attempts, 30s apart): curl health endpoint, curl /docs, curl /redoc; fail deploy job if smoke tests fail

### Technical Specification
- CI and deploy are separate workflows (ci.yml runs on push+PR, deploy.yml runs on push to main only)
- Deploy workflow should only trigger after CI passes — use \`needs\` or rely on branch protection rules
- Railway CLI container (ghcr.io/railwayapp/cli:latest) includes \`railway\` CLI pre-installed
- \`railway up\` builds and deploys using the Dockerfile; Railway's preDeployCommand handles migrations
- Smoke test uses plain \`curl -f\` (fail on HTTP error) — no additional dependencies needed
- Smoke test retries account for Railway deployment time (1-3 minutes typical)
- GitHub secrets RAILWAY_TOKEN and RAILWAY_SVC_ID are already configured in the repo
- CI PostgreSQL service container starts in ~5s, negligible impact on CI time`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic SAPFB-9.

### Stories Included

- **CI quality gates workflow complete**
  - Files: .github/workflows/ci.yml
- **Deploy and smoke test workflow complete**
  - Files: .github/workflows/ci.yml, .github/workflows/deploy.yml

### Branches Merged

- \`story/sapfb-9/0-ci-quality-gates-workflow\`
- \`story/sapfb-9/1-deploy-and-smoke-test-workflow\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  },
  {
    "id": "sa-10",
    "title": "SAPFB-10: Pre-deploy config and CI workflow validation",
    "priority": "high",
    "storyCount": 6,
    "duration": "~28 min",
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 10,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/10",
    "commentCount": 6,
    "personas": [
      "backend_developer",
      "devops_engineer"
    ],
    "description": `### Epic Overview
Execute the first production deployment to Railway, run migrations against Neon, seed the production database with demo data, and perform comprehensive end-to-end validation of all acceptance criteria. This is the final card — when it completes, ShipAPI is live at https://shipapi.workermill.com.

### Scope Boundary
- Depends on ALL preceding cards — this is the integration and go-live card
- Must NOT implement new features — only deploy, seed, validate, and fix any integration issues
- If any quality gate fails, fix the root cause in the appropriate layer and re-deploy

### Prerequisites
- All cards 0-8 must be complete

### Deliverables
1. Push all code to main branch of workermill-examples/shipapi — ensure clean commit history, all files present
2. Verify CI pipeline passes — lint (0 errors), format check (clean), mypy strict (0 errors), all tests pass, coverage >80%
3. Verify Railway deployment succeeds — deploy.yml triggers, \`railway up\` builds Docker image, preDeployCommand runs Alembic migrations against Neon via DATABASE_URL_DIRECT
4. Run seed script against production Neon database — Execute seed/seed.py with Railway environment variables to populate demo data; verify idempotency by running twice
5. Smoke test: https://shipapi.workermill.com/api/v1/health returns 200 with {status: ok, database: connected}
6. Smoke test: https://shipapi.workermill.com/docs loads Swagger UI, /redoc loads ReDoc — all endpoints visible and grouped by tag
7. Smoke test: Auth flow — Register new user, login, access protected endpoint with JWT, access same endpoint with API key; verify demo credentials work (demo@workermill.com / **** and sk_demo_****)
8. Smoke test: Product search — GET /products?search=monitor returns relevant results; GET /products?category_id=X&min_price=10&sort_by=price works
9. Smoke test: Stock transfer — Execute transfer, verify source decremented + destination incremented + transfer record; verify /stock/alerts returns ~10 low-stock products
10. Smoke test: Audit log — Verify previous operations created audit entries; GET /audit-log with admin auth returns entries with filters working
11. Final validation — Docker image < 200MB, container runs as non-root, rate limiting active (verify 429 on rapid requests), all error responses follow standard format, X-Request-Id headers present

### Technical Specification
- Deploy via GitHub Actions deploy.yml workflow — triggered by push to main
- Railway preDeployCommand (\`alembic upgrade head\`) runs migrations before app starts
- Seed script can be run via GitHub Actions manual dispatch workflow or by adding a one-time step in deploy
- All smoke tests should use curl or httpx against the live URL https://shipapi.workermill.com
- If any smoke test fails: read error, fix root cause in appropriate code, push again, wait for redeploy
- Follow CI/CD iteration pattern: push -> CI -> fix -> push -> deploy -> smoke test -> fix -> push
- Railway Hobby plan keeps containers alive — no cold start concern for validation
- Neon free tier: 0.5 GB storage more than sufficient for seed data
- Document any issues encountered and fixes applied for future reference`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic SAPFB-10.

### Stories Included

- **Pre-deploy config and CI workflow validation complete**
  - Files: .github/workflows/deploy.yml, .github/workflows/seed.yml, Dockerfile (+1 more)
- **Push to main, CI green, deploy, and seed production complete**
  - Files: .github/workflows/deploy.yml, .github/workflows/seed.yml, Dockerfile (+22 more)
- **Infrastructure and docs smoke tests complete**
  - Files: .github/workflows/deploy.yml, .github/workflows/seed.yml, Dockerfile (+23 more)
- **Auth and security smoke tests complete**
  - Files: .github/workflows/deploy.yml, .github/workflows/seed.yml, Dockerfile (+24 more)
- **Business logic smoke tests complete**
  - Files: .github/workflows/deploy.yml, .github/workflows/seed.yml, Dockerfile (+25 more)
- **Final validation and go-live report complete**
  - Files: .github/workflows/deploy.yml, .github/workflows/seed.yml, Dockerfile (+26 more)

### Branches Merged

- \`story/sapfb-10/0-pre-deploy-config-and-ci-workf\`
- \`story/sapfb-10/1-push-to-main-ci-green-deploy-a\`
- \`story/sapfb-10/2-infrastructure-and-docs-smoke\`
- \`story/sapfb-10/3-auth-and-security-smoke-tests\`
- \`story/sapfb-10/4-business-logic-smoke-tests\`
- \`story/sapfb-10/5-final-validation-and-go-live-r\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  },
  {
    "id": "sa-11",
    "title": "SAPFB-11: Public showcase stats endpoint and landing page",
    "priority": "medium",
    "storyCount": 3,
    "duration": "~12 min",
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 11,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/11",
    "commentCount": 3,
    "personas": [
      "backend_developer",
      "frontend_developer",
      "qa_engineer"
    ],
    "description": `### Epic Overview
Add a public showcase stats endpoint and a dark-themed responsive landing page to ShipAPI, with integration tests covering both features. The stats endpoint returns live metrics (product count, warehouse count, transfer count, etc.) for display on the WorkerMill showcase. The landing page serves as the public face of the deployed API.

### Deliverables
1. \`src/api/showcase.py\` — GET /showcase/stats endpoint returning live database metrics (total products, categories, warehouses, stock levels, transfers, audit entries)
2. Landing page route — Dark-themed responsive HTML page with API overview, live stats, and links to Swagger/ReDoc docs
3. Integration tests — Full test coverage for showcase stats endpoint and landing page route

### Technical Specification
- Stats endpoint queries live database counts — no caching, real-time metrics
- Landing page uses FastAPI HTMLResponse with inline CSS (dark theme matching ShipAPI branding)
- Tests verify both JSON stats response and HTML landing page render correctly`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic ShipAPI-PRD-Full-Build-Specification-96948bf9.

### Stories Included

- **Backend — Public showcase stats endpoint and landing page route complete**
  - Files: src/api/router.py, src/api/showcase.py, src/main.py (+2 more)
- **Frontend — Dark-themed responsive landing page template complete**
  - Files: src/api/router.py, src/api/showcase.py, src/main.py (+3 more)
- **QA — Integration tests for showcase stats and landing page complete**
  - Files: src/api/router.py, src/api/showcase.py, src/main.py (+3 more)

### Branches Merged

- \`story/shipapi-prd-full-build-specification-96948bf9/0-backend-public-showcase-stats\`
- \`story/shipapi-prd-full-build-specification-96948bf9/1-frontend-dark-themed-responsiv\`
- \`story/shipapi-prd-full-build-specification-96948bf9/2-qa-integration-tests-for-showc\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  },
  {
    "id": "sa-12",
    "title": "SAPFB-12: Document pre-commit quality gate in CLAUDE.md",
    "priority": "medium",
    "storyCount": 4,
    "duration": "~15 min",
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 12,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/12",
    "commentCount": 1,
    "personas": [
      "backend_developer",
      "devops_engineer"
    ],
    "description": `### Epic Overview
Fix CI-blocking lint and type errors, add a post-deploy smoke test to the deploy workflow, and document the pre-commit quality gate in CLAUDE.md so future workers run checks before committing.

### Deliverables
1. Fix lint and type errors in \`src/database.py\` and \`tests/test_showcase.py\` that were blocking CI
2. Add post-deploy smoke test step to \`.github/workflows/deploy.yml\` — verifies the health endpoint responds after deployment
3. Document the pre-commit quality gate in \`CLAUDE.md\` — workers must run \`ruff check\`, \`ruff format --check\`, and \`mypy src --strict\` before committing
4. Run the full quality gate and verify CI is green end-to-end

### Technical Specification
- Smoke test uses curl with retry loop against the live health endpoint
- CLAUDE.md quality gate section ensures all future workers run lint/format/type checks before pushing
- All fixes are minimal — only addressing the specific CI blockers, no unrelated changes`,
    "buildLog": `## Epic Implementation

This PR consolidates all stories from Epic SAPFB-20.

### Stories Included

- **Fix CI-blocking lint and type errors complete**
  - Files: src/database.py, tests/test_showcase.py
- **Add post-deploy smoke test to deploy.yml complete**
  - Files: .github/workflows/deploy.yml
- **Document pre-commit quality gate in CLAUDE.md complete**
  - Files: CLAUDE.md
- **Run quality gate and verify CI green complete**
  - Files: .github/workflows/deploy.yml, CLAUDE.md, src/database.py, tests/test_showcase.py

### Branches Merged

- \`story/sapfb-20/0-fix-ci-blocking-lint-and-type\`
- \`story/sapfb-20/1-add-post-deploy-smoke-test-to\`
- \`story/sapfb-20/2-document-pre-commit-quality-ga\`
- \`story/sapfb-20/3-run-quality-gate-and-verify-ci\`

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  }
];
