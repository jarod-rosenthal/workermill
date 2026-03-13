# ShipAPI — Full Build Spec

---

## Purpose

This is a **showcase build** — a polished, full-stack demo app designed to demonstrate what WorkerMill can build autonomously. A production-grade inventory management system with a React dashboard frontend and a FastAPI backend. JWT + API key authentication, full-text search, atomic stock transfers, audit logging, rate limiting, comprehensive tests, and Swagger/ReDoc documentation. When a visitor opens the demo at https://shipapi.workermill.com, they should see a beautiful, interactive dashboard — not just API docs. The frontend is how visitors experience the product. Every page should have rich, realistic data. Empty states are failure.

## Source of Truth

- **Repo:** `workermill-examples/shipapi` (GitHub)
- **Live URL:** https://shipapi.workermill.com
- **Deployment:** Railway (app) + Neon PostgreSQL (database)


## CRITICAL — Read Before Writing Any Code

These rules are non-negotiable. Violating ANY of them will fail every review and waste revision cycles. Do not skip this section.

1. **JWT library is PyJWT** (`import jwt`, package `pyjwt`). Do NOT use `python-jose` — this project uses PyJWT exclusively. python-jose had unpatched CVEs until mid-2025 and is a heavier dependency (JWS/JWE support we don't need). Every `import` must be `import jwt`, never `from jose import ...`.
2. **`datetime.now(timezone.utc)`** — use `from datetime import datetime, timezone` and call `datetime.now(timezone.utc)`. Do NOT use `datetime.UTC` — when you use `from datetime import datetime` (which this codebase does everywhere), `datetime` refers to the class, not the module, so `datetime.UTC` raises `AttributeError`. Do NOT use `datetime.utcnow()` (deprecated).
3. **Pydantic V2 config**: use `model_config = ConfigDict(...)`. Do NOT use `class Config:` — it is deprecated in Pydantic V2 and will be removed in V3.
4. **`pyproject.toml` tool config must be copied verbatim** from the `pyproject.toml (Verbatim)` section below. In particular, ruff config MUST include `ignore = ["UP017", "PLW0603"]` — without it, ruff auto-suggests `datetime.UTC` which fails with `AttributeError` when `from datetime import datetime` is used (the class shadows the module). Do not improvise, rearrange, or "improve" the tool configuration.
5. **`docker-compose.yml` has exactly ONE service** (`postgres` on port 5432) as specified below. Do NOT invent additional services like `postgres-test` on different ports. Tests use the same Postgres instance with a separate database name (`shipapi_test`).
6. **All path parameters referencing model IDs MUST be typed `uuid.UUID`**, not `str`. FastAPI validates UUID format automatically and returns 422 for invalid values — this prevents `asyncpg.DataError` crashes when garbage strings hit the database. Example:
   ```python
   import uuid
   @router.get("/{product_id}")
   async def get_product(product_id: uuid.UUID, ...):
       result = await db.execute(select(Product).where(Product.id == product_id))
   ```
   Do NOT use `product_id: str` — asyncpg will throw `DataError: invalid UUID` instead of a clean error response.
7. **Decimal fields in Pydantic response schemas** — price fields stored as `Decimal` in SQLAlchemy must serialize to JSON. Use `float` type in response schemas (simplest), or use `@field_serializer` for per-field control. Do NOT use `json_encoders` — it is deprecated in Pydantic V2 and will be removed in V3. Without proper serialization, FastAPI will crash with `TypeError: Object of type Decimal is not JSON serializable`.
   ```python
   # Option A (preferred): just use float in the response schema
   class ProductResponse(BaseModel):
       price: float  # SQLAlchemy Decimal auto-converts to float

   # Option B: keep Decimal + explicit serializer
   from decimal import Decimal
   from pydantic import field_serializer
   class ProductResponse(BaseModel):
       price: Decimal
       @field_serializer('price')
       def serialize_price(self, v: Decimal) -> float:
           return float(v)
   ```
8. **Do NOT add global feature flags to disable middleware in tests** (e.g., `DISABLE_RATE_LIMIT=true`). Rate limiting, auth, and other middleware must be tested as-is. Rate limit tests must run with the limiter enabled. If you need to test rate limits, send enough requests to trigger them — do NOT disable the limiter.
9. **Run auto-fixers before every commit**:
   ```
   uv run ruff check --fix src/ tests/
   uv run ruff format src/ tests/
   uv run mypy src
   ```
   Then run the quality gate check commands (below) to verify zero errors remain. Do NOT commit code with linting, formatting, or type errors — fix them first.
10. **Do NOT use `from __future__ import annotations`** — it causes "Model is not fully defined" errors with Pydantic V2. Use explicit string annotations for forward references instead.
11. **`TYPE_CHECKING` guards for cross-model imports** — models referencing other models (e.g., Product → Category) must import inside `if TYPE_CHECKING:` and use string annotations (`"Category"` not `Category`) in relationships to avoid circular imports.
12. **All primary keys are UUIDs.** Define as `id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)`. Do NOT use `SERIAL`, `BIGSERIAL`, or `Integer` primary keys.
13. **No hardcoded absolute paths** — do NOT use paths containing `/workspace/`, `/worktrees/`, `/tmp/`, or any build-environment directory. Use `Path(__file__).parent` for relative resolution. These paths break in CI, Docker, and production.
14. **Dependency list is locked** — do NOT add packages not in the `pyproject.toml` below. In particular: no `structlog`, `loguru`, `python-jose`, `passlib`, or `python-slugify`. If it's not in the dependency list, you don't need it.
15. **Tests run against real PostgreSQL** — do NOT mock the database, do NOT use SQLite. Async features (`TSVECTOR`, `SELECT FOR UPDATE`, GIN indexes) are PostgreSQL-only. Use `docker compose up -d --wait` before running tests.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | FastAPI | Latest |
| Language | Python | 3.13 |
| ORM | SQLAlchemy 2.0 | Async with asyncpg |
| Database | PostgreSQL (Neon) | With connection pooling |
| Migrations | Alembic | Async config |
| Validation | Pydantic V2 + pydantic-settings | BaseModel with field validators, Settings class |
| Auth | JWT (access + refresh) + API keys | PyJWT for tokens, bcrypt for passwords, SHA-256 for API keys |
| Rate Limiting | slowapi | Per-endpoint limits |
| Testing | pytest + httpx | Async test client, unit + E2E workflow tests |
| Type Checking | mypy | Non-strict (see Code Quality Configuration) |
| Linting | ruff | Check + format |
| CI/CD | GitHub Actions | `ubuntu-latest` |
| Hosting | Railway | Dockerfile-based deploy |
| Package Manager | uv | Fast Python dependency management |
| Containerization | Docker | Multi-stage build with uv |
| Frontend | React 19 + Vite | TypeScript, Tailwind CSS v4 |
| UI Components | shadcn/ui | Radix primitives, consistent design system |
| Charts | Recharts | Dashboard visualizations |
| HTTP Client | Axios | API communication with interceptors |
| Routing | React Router v7 | Client-side routing |

## Global Constraints

- **Python 3.13** (pinned in `.python-version`)
- **Async everywhere:** All database operations use async SQLAlchemy, async test client (httpx)
- **Docker image <200MB**, non-root user
- **mypy** on `src/` directory (non-strict — see Code Quality Configuration)
- **API prefix:** All endpoints under `/api/v1/` (exception: `/showcase/stats` is a public stats endpoint outside this prefix — no auth required)
- **Standard error format:** `{ "detail": "message" }` with appropriate HTTP status codes
- **X-Request-Id** header on every response for traceability
- **All tests run against real PostgreSQL** — no mocking the database. Use `docker-compose` to spin up Postgres locally.

### Pre-Commit Quality Gates

```
docker compose down --remove-orphans
docker compose up -d --wait
source $HOME/.local/bin/env && uv run ruff check src/ tests/
source $HOME/.local/bin/env && uv run ruff format --check src/ tests/
source $HOME/.local/bin/env && uv run mypy src
source $HOME/.local/bin/env && DATABASE_URL=postgresql+asyncpg://shipapi:shipapi@localhost:5432/shipapi_test uv run pytest tests/ -v --tb=short --ignore=tests/test_e2e_workflows.py
source $HOME/.local/bin/env && DATABASE_URL=postgresql+asyncpg://shipapi:shipapi@localhost:5432/shipapi_test uv run pytest tests/test_e2e_workflows.py -v --tb=short
docker compose down
cd frontend && npm run lint
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

Tests MUST pass against a real Postgres instance before pushing. Do NOT mock SQLAlchemy sessions or use SQLite as a test database — async features like `TSVECTOR`, `SELECT FOR UPDATE`, and GIN indexes only work on real PostgreSQL.

**Important:** Always run `docker compose down --remove-orphans` before `docker compose up` to clean up stale containers from previous runs that may hold port 5432.

---

## Project Structure (Canonical Layout)

Every file has ONE owner. Do NOT define types, models, or utilities outside their designated module.

```
shipapi/
├── src/
│   ├── __init__.py
│   ├── main.py              — FastAPI app factory, middleware registration, router includes
│   ├── config.py             — Settings class (reads env vars: DATABASE_URL, JWT_SECRET_KEY, etc.)
│   ├── database.py           — create_async_engine, async_sessionmaker, get_db dependency
│   ├── auth.py               — JWT encode/decode (PyJWT library, `import jwt`), password hashing (bcrypt), API key validation, get_current_user dependency
│   ├── dependencies.py       — get_db (re-export from database), get_current_user (re-export from auth), get_current_admin
│   ├── middleware.py          — RequestIdMiddleware, AccessLogMiddleware
│   ├── models/
│   │   ├── __init__.py       — exports: Base, User, Category, Product, Warehouse, StockLevel, StockTransfer, AuditLog
│   │   ├── base.py           — DeclarativeBase with created_at/updated_at mixins
│   │   ├── user.py           — User model
│   │   ├── category.py       — Category model (self-referential parent_id)
│   │   ├── product.py        — Product model (search_vector as TSVECTOR column, NOT server_default)
│   │   ├── warehouse.py      — Warehouse model
│   │   ├── stock.py          — StockLevel + StockTransfer models
│   │   └── audit.py          — AuditLog model
│   ├── schemas/
│   │   ├── __init__.py       — exports ALL schemas including PaginatedResponse
│   │   ├── common.py         — PaginatedResponse (THE canonical pagination wrapper — used by ALL list endpoints)
│   │   ├── user.py           — UserCreate, UserResponse, TokenResponse, LoginRequest, ApiKeyResponse
│   │   ├── category.py       — CategoryCreate, CategoryUpdate, CategoryResponse (includes slug, product_count as Optional[int])
│   │   ├── product.py        — ProductCreate, ProductUpdate, ProductResponse, ProductListParams
│   │   ├── warehouse.py      — WarehouseCreate, WarehouseUpdate, WarehouseResponse (detail includes stock_summary)
│   │   ├── stock.py          — StockLevelResponse, StockAdjustRequest, StockTransferCreate, StockTransferResponse
│   │   └── audit.py          — AuditLogResponse
│   └── routers/
│       ├── __init__.py
│       ├── auth.py           — /api/v1/auth/* endpoints
│       ├── categories.py     — /api/v1/categories/* endpoints
│       ├── products.py       — /api/v1/products/* endpoints
│       ├── warehouses.py     — /api/v1/warehouses/* endpoints
│       ├── stock.py          — /api/v1/stock/* endpoints
│       ├── audit.py          — /api/v1/audit/* endpoints
│       ├── health.py         — /api/v1/health endpoint
│       └── showcase.py       — /showcase/stats endpoint (no auth)
├── tests/
│   ├── __init__.py            — package init (required for ruff INP001)
│   ├── conftest.py           — async fixtures: test DB create/drop, httpx AsyncClient, auth helpers
│   ├── test_health.py
│   ├── test_auth.py
│   ├── test_categories.py
│   ├── test_products.py
│   ├── test_warehouses.py
│   ├── test_stock.py
│   ├── test_audit.py
│   ├── test_rate_limiting.py
│   ├── test_errors.py
│   └── test_e2e_workflows.py
├── alembic/
│   ├── __init__.py            — package init (required for ruff INP001)
│   ├── env.py                — async Alembic config (run_async + create_async_engine)
│   ├── script.py.mako
│   └── versions/
│       ├── __init__.py        — package init (required for ruff INP001)
│       └── 001_initial_tables.py
├── seed/
│   ├── __init__.py
│   └── __main__.py           — idempotent seed script (python -m seed)
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── components.json          # shadcn/ui config
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── lib/
│       │   ├── api.ts
│       │   └── utils.ts
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   └── useApi.ts
│       ├── components/
│       │   ├── ui/           — shadcn/ui primitives
│       │   ├── Layout.tsx
│       │   ├── Sidebar.tsx
│       │   ├── ProtectedRoute.tsx
│       │   └── StatsCard.tsx
│       └── pages/
│           ├── LoginPage.tsx
│           ├── DashboardPage.tsx
│           ├── ProductsPage.tsx
│           ├── CategoriesPage.tsx
│           ├── WarehousesPage.tsx
│           ├── StockPage.tsx
│           ├── AuditPage.tsx
│           └── ApiDocsPage.tsx
├── .env.example
├── .gitignore
├── .python-version           — "3.13"
├── alembic.ini
├── docker-compose.yml
├── Dockerfile
├── pyproject.toml
├── railway.toml
└── README.md
```

### Import Rules (MANDATORY)

```python
# Models — always import from src.models
from src.models import User, Product, Category, Warehouse, StockLevel, StockTransfer, AuditLog

# Schemas — always import from src.schemas
from src.schemas import ProductCreate, ProductResponse, PaginatedResponse
from src.schemas.common import PaginatedResponse  # also valid

# Dependencies — always import from src.dependencies
from src.dependencies import get_db, get_current_user, get_current_admin

# Database session — routers use dependency injection, NEVER import engine directly
# ✗ WRONG: from src.database import engine
# ✓ RIGHT: db: AsyncSession = Depends(get_db)
```

### Critical Naming (Do NOT Deviate)

| Concept | Canonical Name | WRONG Names |
|---------|---------------|-------------|
| Pagination wrapper | `PaginatedResponse` | `PaginationResponse`, `PagedResponse`, `ListResponse` |
| Password field | `hashed_password` | `password_hash`, `passwordHash`, `password` |
| Active flag | `is_active` | `active`, `enabled`, `status` |
| Admin flag | `is_admin` | `admin`, `role`, `is_superuser` |
| Timestamps | `created_at`, `updated_at` | `creation_date`, `date_created`, `createdAt` |
| API key hash | `api_key_hash` | `apiKeyHash`, `key_hash`, `hashed_key` |
| Product search | `search_vector` | `search_index`, `fts_vector`, `tsv` |

### `.gitignore` (Create in Story 0, BEFORE any Python code)

```
__pycache__/
*.py[cod]
*$py.class
*.so
.env
.env.local
.venv/
venv/
*.egg-info/
dist/
build/
.mypy_cache/
.pytest_cache/
.ruff_cache/
htmlcov/
.coverage
*.db
*.sqlite3
.DS_Store
.idea/
.vscode/
node_modules/
```

This is the **exact and complete** `.gitignore` — use it verbatim. Do NOT use a generic Python gitignore template, do NOT add entries beyond what is listed here. In particular:

- Do NOT gitignore `docker-compose.yml` — it is a committed project file required for local dev and CI
- Do NOT gitignore `docker-compose*.yml` or any docker-compose glob pattern
- Do NOT gitignore `uv.lock` — it must be committed for reproducible builds
- Do NOT gitignore `.python-version` — it pins the Python version

This file MUST exist and be committed as the FIRST file in the repo, before any Python code is written. Workers MUST NOT commit `__pycache__/` or `.pyc` files under any circumstances.

---

## API Response Format (MANDATORY)

All list endpoints return this exact shape:

```json
{
  "items": [...],
  "total": 100,
  "page": 1,
  "per_page": 50
}
```

The field is `items` (NOT `data`, NOT `results`). The `PaginatedResponse` schema in `src/schemas/common.py` enforces this.

Single resource endpoints return the resource object directly (no wrapper).

Error responses return `{ "detail": "message" }` with appropriate HTTP status code.

---

## Database Schema (7 models)

### Models

| Model | Purpose | Key Fields (exact names) |
|-------|---------|-----------|
| User | User accounts | email (unique), username (unique), hashed_password, is_active, is_admin, api_key_hash |
| Category | Product categories | name, slug (unique, auto-generated from name), description, parent_id (self-referential) |
| Product | Inventory items | name, sku (unique), description, price, is_active, category_id, search_vector (TSVECTOR) |
| Warehouse | Storage locations | name, code (unique), address, is_active |
| StockLevel | Current inventory | product_id, warehouse_id, quantity, low_stock_threshold |
| StockTransfer | Inventory movements | product_id, from_warehouse_id, to_warehouse_id, quantity, notes |
| AuditLog | Activity tracking | user_id, action, resource_type, resource_id, details (JSON), ip_address |

### search_vector Implementation

The `search_vector` column is a plain `TSVECTOR` column — NOT a `server_default`, NOT a generated column. It is updated in the service/router layer when products are created or updated:

```python
# In the Product model — just a column, no server_default
search_vector: Mapped[Optional[str]] = mapped_column(TSVECTOR, nullable=True)

# In the router — update search_vector via UPDATE statement after create/update.
# After db.add(product) and db.flush() (so product.id is set):
from sqlalchemy import func, update

await db.execute(
    update(Product)
    .where(Product.id == product.id)
    .values(search_vector=func.to_tsvector(
        "english",
        Product.name + " " + func.coalesce(Product.description, "")
    ))
)
await db.commit()
```

**Why not `product.search_vector = func.to_tsvector(...)`?** Assigning a SQLAlchemy `func` object to an ORM attribute does NOT evaluate it — it stores the function expression, which may produce unexpected results on flush. Use an explicit `UPDATE` statement instead, which sends the `to_tsvector()` call to PostgreSQL where it belongs.

Do NOT use `server_default=text("to_tsvector(...)")` — it causes migration failures.

### Key Features

- **Full-text search:** TSVECTOR column + GIN index on Product for PostgreSQL full-text search with `ts_rank` relevance ordering
- **Self-referential categories:** `parent_id` enables subcategory hierarchy (5 top-level + 15 subcategories)
- **Category slug:** Auto-generated from `name` on create/update using basic slugification: lowercase, replace spaces/special chars with hyphens, strip leading/trailing hyphens. Example: `"Industrial Sensors"` → `"industrial-sensors"`. Do NOT add a `slugify` library — implement inline with `re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')`. If a slug collision occurs (409), the caller must use a unique name.
- **Cascade protection:** Cannot delete categories with products (400 error). Cannot delete warehouses with stock levels (400 error).
- **Soft-delete:** Products use `is_active` flag instead of hard delete
- **Unique constraints:** User email, username; Product SKU; Category slug; Warehouse code

### Indexes

- GIN index on Product search_vector for full-text search
- Standard B-tree indexes on foreign keys and unique fields
- Composite unique on StockLevel (product_id, warehouse_id)

---

## Authentication System

### JWT Authentication

- **Library:** PyJWT (`import jwt`). Do NOT use python-jose — this project uses PyJWT exclusively.
- **Access token:** Short-lived (configurable expiry)
- **Refresh token:** Long-lived for token renewal
- **Password hashing:** bcrypt with secure salt rounds

### API Key Authentication

- **Format:** `sk_` prefix + random hex characters
- **Storage:** SHA-256 hash (raw key never stored)
- **Lookup:** By key prefix for efficient retrieval
- **Header:** `X-API-Key`

### Dual Auth Dependency

Routes accept either:
1. `Authorization: Bearer <jwt_token>`
2. `X-API-Key: sk_...`

Both resolve to the authenticated user.

### Auth Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Create account (rate limited: 5/min) |
| POST | `/api/v1/auth/login` | Login, returns access + refresh tokens (rate limited: 10/min) |
| POST | `/api/v1/auth/refresh` | Refresh — decode the refresh token, generate a NEW access token with a new `exp`, return it (rate limited: 30/min) |
| GET | `/api/v1/auth/me` | Current user profile |
| POST | `/api/v1/auth/api-key` | Generate API key (returns raw key once, stores SHA-256 hash). Requires JWT auth. |
| DELETE | `/api/v1/auth/api-key` | Revoke API key. Requires JWT auth. |

---

## API Endpoints

### Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/health` | No | Health check with DB connectivity |

### Categories

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/categories` | Yes | List categories (with subcategory hierarchy) |
| POST | `/api/v1/categories` | Admin | Create category |
| GET | `/api/v1/categories/{id}` | Yes | Category detail with `product_count` (computed, not stored) |
| PUT | `/api/v1/categories/{id}` | Admin | Update category |
| DELETE | `/api/v1/categories/{id}` | Admin | Delete (400 if has products) |

### Products

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/products` | Yes | List with filters (category, price range, is_active), search, pagination, sorting |
| POST | `/api/v1/products` | Admin | Create product |
| GET | `/api/v1/products/{id}` | Yes | Detail with eager-loaded stock levels |
| PUT | `/api/v1/products/{id}` | Admin | Update product |
| DELETE | `/api/v1/products/{id}` | Admin | Soft-delete (set is_active=false), returns 200 with updated product |

**Product Search:** Full-text search via `?search=query` parameter. Uses PostgreSQL TSVECTOR with `ts_rank` for relevance ordering.

**Product Filters:**
- `category_id` — Filter by category
- `min_price` / `max_price` — Price range
- `is_active` — Active/inactive filter
- `sort_by` — Whitelist of sortable columns
- `page` / `per_page` — Pagination (max 100 per page)

### Warehouses

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/warehouses` | Yes | List warehouses |
| POST | `/api/v1/warehouses` | Admin | Create warehouse |
| GET | `/api/v1/warehouses/{id}` | Yes | Detail with stock level summary (see query below) |
| PUT | `/api/v1/warehouses/{id}` | Admin | Update warehouse |
| DELETE | `/api/v1/warehouses/{id}` | Admin | Delete warehouse (400 if has stock levels) |

**Warehouse Detail Stock Summary** — the `GET /warehouses/{id}` endpoint returns the warehouse with a `stock_summary` field containing aggregate stats. Use `func.count` and `func.sum` — do NOT use `func.case` (it doesn't exist in SQLAlchemy, use `case()` directly if needed):

```python
from sqlalchemy import func, select
from src.models import StockLevel

# In the warehouse detail endpoint:
result = await db.execute(
    select(
        func.count(StockLevel.id).label("total_items"),
        func.coalesce(func.sum(StockLevel.quantity), 0).label("total_quantity"),
    ).where(StockLevel.warehouse_id == warehouse.id)
)
summary = result.one()
```

### Stock Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/stock` | Yes | List stock levels |
| GET | `/api/v1/stock/alerts` | Yes | Low-stock alerts (quantity < threshold) |
| PUT | `/api/v1/stock/adjust` | Admin | Set stock level for a product+warehouse pair |
| POST | `/api/v1/stock/transfers` | Yes | Atomic stock transfer between warehouses |
| GET | `/api/v1/stock/transfers` | Yes | Transfer history |

**Stock Adjustment (`PUT /api/v1/stock/adjust`):**
- Sets the stock level for a given `product_id` + `warehouse_id` pair
- Creates the StockLevel record if it doesn't exist (upsert)
- Request body: `{ "product_id": "uuid", "warehouse_id": "uuid", "quantity": int, "low_stock_threshold": int (optional, default 10) }`
- Admin-only — used for initial inventory setup and manual corrections
- Records audit log entry with old and new quantity

**Atomic Stock Transfers:**
- Uses `SELECT FOR UPDATE` within a single transaction
- Validates sufficient stock at source (400 if insufficient)
- Validates different source/destination warehouses (400 if same)
- Auto-creates stock_level record at destination if not exists
- Records audit log entry

### Audit Log

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/audit` | Admin | Audit log with filters (user, action, resource_type, date range) |

### Showcase

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/showcase/stats` | No | Live DB metrics for showcase display |

**Response shape** (no auth, public endpoint for the WorkerMill showcase page):
```json
{
  "total_products": 50,
  "total_categories": 20,
  "total_warehouses": 3,
  "total_stock_transfers": 20,
  "low_stock_alerts": 10
}
```
All values are simple `COUNT(*)` queries against the respective tables. `low_stock_alerts` counts StockLevel records where `quantity < low_stock_threshold`. This endpoint is registered outside the `/api/v1/` router prefix — mount it directly on the FastAPI app.

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

All errors return `{ "detail": "message" }` format.

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

### Middleware (Pure ASGI — Do NOT Use BaseHTTPMiddleware)

All custom middleware (`RequestIdMiddleware`, `AccessLogMiddleware`) MUST be implemented as pure ASGI middleware, NOT Starlette's `BaseHTTPMiddleware`. `BaseHTTPMiddleware` runs the request handler in a threadpool executor, which creates a **different event loop** from the one async SQLAlchemy sessions are bound to. This causes `RuntimeError: Task got Future attached to a different loop` in any route that touches the database.

```python
# ✓ CORRECT — pure ASGI middleware
class RequestIdMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            request_id = str(uuid.uuid4())
            async def send_with_id(message):
                if message["type"] == "http.response.start":
                    headers = list(message.get("headers", []))
                    headers.append((b"x-request-id", request_id.encode()))
                    message["headers"] = headers
                await send(message)
            await self.app(scope, receive, send_with_id)
        else:
            await self.app(scope, receive, send)

# ✗ WRONG — causes event loop conflicts with async SQLAlchemy
class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        ...
```

### `src/database.py` (Verbatim — Do NOT Deviate)

This is the **exact** database module. The engine and session factory are created at module level. The `get_db` dependency yields a session per request. Tests override `get_db` via `app.dependency_overrides` to use a test engine on the test event loop (see `conftest.py`).

```python
"""Async database engine, session factory, and get_db dependency."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.config import settings

engine = create_async_engine(settings.DATABASE_URL)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    """Yield a database session per request. Override in tests."""
    async with async_session() as session:
        yield session
```

Do NOT add engine caching, lazy initialization, or `reset_engine()` functions. The engine is created once at import time. Tests handle the event loop mismatch by overriding `get_db` to use their own engine (see `conftest.py` `client` fixture). Do NOT import `engine` directly in routers — always use `Depends(get_db)`.

---

## Seed Data (CRITICAL — This Makes or Breaks the Demo)

This is a showcase app. The seed data IS the demo. A visitor who hits the API and gets empty responses will leave immediately. Every list endpoint must return rich, realistic data. The seed script MUST run on every deploy (see `railway.toml` `preDeployCommand`). An empty database is an automatic failure.

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
- Available at `/docs` (Swagger UI) and `/redoc` (ReDoc)
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

## Local Development

### `docker-compose.yml` (Verbatim — Do NOT Deviate)

This is the **exact and complete** `docker-compose.yml` — use it verbatim. Do NOT add a second Postgres service, do NOT add networks, do NOT add `init.sql` files, do NOT add extra environment variables or init args. One service, one volume, port 5432.

```yaml
services:
  postgres:
    image: postgres:17-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: shipapi
      POSTGRES_PASSWORD: shipapi
      POSTGRES_DB: shipapi
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shipapi"]
      interval: 5s
      timeout: 5s
      retries: 5
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Tests use the same Postgres instance on port 5432. The `conftest.py` creates a separate `shipapi_test` database — there is no need for a second Postgres service or a different port.

**Usage:**
```bash
docker compose down --remove-orphans   # clean up stale containers first
docker compose up -d --wait
# Run migrations
DATABASE_URL=postgresql+asyncpg://shipapi:shipapi@localhost:5432/shipapi alembic upgrade head
# Run seed
DATABASE_URL=postgresql+asyncpg://shipapi:shipapi@localhost:5432/shipapi python -m seed
# Run tests (uses separate test DB — conftest.py creates/drops it)
DATABASE_URL=postgresql+asyncpg://shipapi:shipapi@localhost:5432/shipapi_test pytest tests/ -v
# Run the app
DATABASE_URL=postgresql+asyncpg://shipapi:shipapi@localhost:5432/shipapi uvicorn src.main:app --reload --port 8000
```

### `.env.example`

```bash
# Pooled connection (app queries) — use asyncpg driver
DATABASE_URL=postgresql+asyncpg://shipapi:shipapi@localhost:5432/shipapi
# Direct connection (Alembic migrations) — same for local, different for Neon
DATABASE_URL_DIRECT=postgresql+asyncpg://shipapi:shipapi@localhost:5432/shipapi
# JWT — generate with: openssl rand -hex 32
JWT_SECRET_KEY=change-me-to-a-long-random-secret-key
PORT=8000
```

### `alembic.ini` (Verbatim — Do NOT Deviate)

This is the **exact and complete** `alembic.ini` — use it verbatim. The `script_location` MUST be `alembic` (NOT `alembic_migrations`, NOT `migrations`, NOT `db/migrations`).

```ini
[alembic]
script_location = alembic
prepend_sys_path = .
sqlalchemy.url = driver://user:pass@localhost/dbname

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

The `sqlalchemy.url` in alembic.ini is a placeholder — `alembic/env.py` overrides it with `DATABASE_URL` from the environment at runtime.

### `alembic/env.py` (Async Configuration)

This is the async Alembic env.py — use it as the skeleton. The key points: it reads `DATABASE_URL` from the environment, uses `create_async_engine`, and runs migrations inside `run_async`.

```python
import asyncio
import os

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from src.models import Base

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = os.environ["DATABASE_URL"]
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(os.environ["DATABASE_URL"])
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

---

## Testing

### Test Infrastructure

- `conftest.py` with test database, async httpx client, auth fixtures
- **Tests run against real PostgreSQL** — `docker compose up -d --wait` before running tests
- `conftest.py` creates the test database (`shipapi_test`), runs Alembic migrations, and drops it after the session
- Fixtures for authenticated admin and regular users
- All endpoints must have at least one test. Coverage is enforced by the E2E workflow tests — if an endpoint is broken, the workflow test catches it.
- **Path resolution:** Use `Path(__file__).parent.parent / "alembic.ini"` to locate the Alembic config. Do NOT hardcode absolute paths like `/workspace/...` or `/worktrees/...` — these are ephemeral build environment paths that don't exist in CI or production.

### pytest-asyncio Fixture Scoping (CRITICAL)

The async test fixtures MUST share a single event loop. Failure to do this causes `RuntimeError: Task got Future attached to a different loop` and `asyncpg InterfaceError: cannot perform operation: another operation is in progress`, which will fail every test that touches the database.

**Configure via `pyproject.toml`** (already included in the verbatim pyproject.toml below):

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
```

The `asyncio_default_fixture_loop_scope = "session"` setting ensures all async fixtures and tests share one event loop. Do NOT define a custom `event_loop` fixture in `conftest.py` — this was removed in pytest-asyncio 1.0 and will cause errors.

- The database engine fixture MUST also be `scope="session"` to avoid creating connections on different loops.
- Do NOT define a custom `event_loop` fixture — use the `asyncio_default_fixture_loop_scope` config instead.

### Test Files (10)

| File | Coverage |
|------|----------|
| `test_health.py` | Health endpoint |
| `test_auth.py` | Register, login, refresh, API key, expired tokens |
| `test_categories.py` | CRUD, cascade protection, slug uniqueness |
| `test_products.py` | CRUD, full-text search, filters, pagination, sorting |
| `test_warehouses.py` | CRUD, stock level summary in detail |
| `test_stock.py` | Stock adjust (upsert), atomic transfer atomicity, insufficient stock, alerts |
| `test_audit.py` | Filters, admin-only access |
| `test_rate_limiting.py` | 429 responses, retry headers |
| `test_errors.py` | Error format consistency across endpoints |
| `test_e2e_workflows.py` | End-to-end user journey tests (see below) |

### End-to-End Workflow Tests (CRITICAL)

The unit tests above test individual endpoints in isolation. The E2E tests below test **complete user journeys** as multi-step sequences where each step depends on the previous. These catch integration bugs that unit tests miss — wrong status codes, serialization errors, missing validations, broken relationships between endpoints.

**These tests MUST pass before merging. They run as a separate pytest invocation:**

```
uv run pytest tests/test_e2e_workflows.py -v --tb=short
```

If E2E tests fail, the worker MUST fix the underlying issue and re-run — do NOT skip them, do NOT mark them as expected failures.

**Test order matters.** The workflows are ordered from most fundamental to most complex:
1. **Error handling** — validates UUID params, auth, error format (if this fails, everything else will too)
2. **Auth lifecycle** — register, login, tokens, API keys
3. **Product lifecycle** — CRUD + search + audit
4. **Stock transfer** — multi-entity workflow with balance verification
5. **Rate limiting** — sends many requests, runs last to avoid polluting other tests

#### `test_e2e_workflows.py`

```python
"""
End-to-end workflow tests — multi-step user journeys that verify
the entire API works together, not just individual endpoints.

Each test class represents a complete user workflow.
Steps within a test are sequential and depend on previous steps.

Test order: error handling → auth → products → stock → rate limiting.
Ordered from most fundamental to most complex — foundational
failures appear first in the output for easier debugging.
"""
import uuid

import pytest
from httpx import AsyncClient


# ── Workflow 1: Auth Lifecycle ──────────────────────────────────────

class TestAuthWorkflow:
    """Register → Login → Access protected route → Refresh token → API key."""

    @pytest.mark.asyncio
    async def test_full_auth_lifecycle(self, client: AsyncClient):
        unique = uuid.uuid4().hex[:8]

        # Step 1: Register a new user
        resp = await client.post("/api/v1/auth/register", json={
            "email": f"e2e_{unique}@test.com",
            "username": f"e2e_{unique}",
            "password": "SecurePass123!",
        })
        assert resp.status_code == 201, f"Register failed: {resp.text}"

        # Step 2: Login with the new user
        resp = await client.post("/api/v1/auth/login", json={
            "email": f"e2e_{unique}@test.com",
            "password": "SecurePass123!",
        })
        assert resp.status_code == 200, f"Login failed: {resp.text}"
        tokens = resp.json()
        assert "access_token" in tokens
        assert "refresh_token" in tokens
        access_token = tokens["access_token"]
        refresh_token = tokens["refresh_token"]

        # Step 3: Access a protected route with the token
        headers = {"Authorization": f"Bearer {access_token}"}
        resp = await client.get("/api/v1/auth/me", headers=headers)
        assert resp.status_code == 200, f"Protected route failed: {resp.text}"
        assert resp.json()["email"] == f"e2e_{unique}@test.com"

        # Step 4: Refresh the token
        resp = await client.post("/api/v1/auth/refresh", json={
            "refresh_token": refresh_token,
        })
        assert resp.status_code == 200, f"Refresh failed: {resp.text}"
        new_access_token = resp.json()["access_token"]
        assert new_access_token != access_token  # Should be a new token

        # Step 5: Old token may still work (depending on expiry), new token works
        headers = {"Authorization": f"Bearer {new_access_token}"}
        resp = await client.get("/api/v1/auth/me", headers=headers)
        assert resp.status_code == 200

        # Step 6: Generate an API key
        resp = await client.post("/api/v1/auth/api-key", headers=headers)
        assert resp.status_code == 201, f"API key generation failed: {resp.text}"
        api_key = resp.json()["api_key"]
        assert api_key.startswith("sk_"), f"API key missing sk_ prefix: {api_key}"

        # Step 7: Access a protected route with the API key
        resp = await client.get("/api/v1/auth/me", headers={"X-API-Key": api_key})
        assert resp.status_code == 200, f"API key auth failed: {resp.text}"
        assert resp.json()["email"] == f"e2e_{unique}@test.com"

        # Step 8: Revoke the API key
        resp = await client.delete("/api/v1/auth/api-key", headers=headers)
        assert resp.status_code == 200, f"API key revocation failed: {resp.text}"

        # Step 9: Revoked API key should no longer work
        resp = await client.get("/api/v1/auth/me", headers={"X-API-Key": api_key})
        assert resp.status_code == 401, f"Revoked key still works: {resp.status_code}"


# ── Workflow 2: Product Lifecycle ───────────────────────────────────

class TestProductLifecycleWorkflow:
    """Login → Create category → Create product → Search → Update → Soft-delete → Verify audit."""

    @pytest.mark.asyncio
    async def test_full_product_lifecycle(self, client: AsyncClient, admin_headers: dict):
        unique = uuid.uuid4().hex[:8]

        # Step 1: Create a category
        resp = await client.post("/api/v1/categories", json={
            "name": f"E2E Category {unique}",
            "description": "Created by E2E test",
        }, headers=admin_headers)
        assert resp.status_code == 201, f"Create category failed: {resp.text}"
        category_id = resp.json()["id"]

        # Step 2: Create a product in that category
        resp = await client.post("/api/v1/products", json={
            "name": f"E2E Widget {unique}",
            "sku": f"E2E-{unique}",
            "description": "A test product for E2E workflows",
            "price": 29.99,
            "category_id": category_id,
        }, headers=admin_headers)
        assert resp.status_code == 201, f"Create product failed: {resp.text}"
        product = resp.json()
        product_id = product["id"]
        # Verify price serializes correctly (no Decimal errors)
        assert isinstance(product["price"], (int, float)), f"Price not numeric: {product['price']}"

        # Step 3: Search for the product by name
        resp = await client.get(
            f"/api/v1/products?search=E2E+Widget+{unique}",
            headers=admin_headers,
        )
        assert resp.status_code == 200, f"Search failed: {resp.text}"
        data = resp.json()
        assert data["total"] >= 1
        assert any(p["id"] == product_id for p in data["items"])

        # Step 4: Get product detail (verify eager loading works)
        resp = await client.get(f"/api/v1/products/{product_id}", headers=admin_headers)
        assert resp.status_code == 200, f"Get product failed: {resp.text}"
        assert resp.json()["name"] == f"E2E Widget {unique}"

        # Step 5: Update the product
        resp = await client.put(f"/api/v1/products/{product_id}", json={
            "name": f"E2E Widget {unique} Updated",
            "price": 39.99,
        }, headers=admin_headers)
        assert resp.status_code == 200, f"Update product failed: {resp.text}"
        assert resp.json()["price"] == 39.99

        # Step 6: Soft-delete the product
        resp = await client.delete(f"/api/v1/products/{product_id}", headers=admin_headers)
        assert resp.status_code == 200, f"Delete product failed: {resp.text}"

        # Step 7: Verify audit log captured the operations
        resp = await client.get("/api/v1/audit", headers=admin_headers)
        assert resp.status_code == 200, f"Audit log failed: {resp.text}"
        actions = [entry["action"] for entry in resp.json()["items"]]
        assert "create" in actions or "CREATE" in actions


# ── Workflow 3: Stock Transfer ──────────────────────────────────────

class TestStockTransferWorkflow:
    """Login → Create warehouses → Create product → Add stock → Transfer → Verify balances → Check alerts."""

    @pytest.mark.asyncio
    async def test_full_stock_transfer_workflow(self, client: AsyncClient, admin_headers: dict):
        unique = uuid.uuid4().hex[:8]

        # Step 1: Create two warehouses
        resp = await client.post("/api/v1/warehouses", json={
            "name": f"Source WH {unique}",
            "code": f"SRC-{unique}",
            "address": "123 Source St",
        }, headers=admin_headers)
        assert resp.status_code == 201, f"Create source warehouse failed: {resp.text}"
        source_wh_id = resp.json()["id"]

        resp = await client.post("/api/v1/warehouses", json={
            "name": f"Dest WH {unique}",
            "code": f"DST-{unique}",
            "address": "456 Dest Ave",
        }, headers=admin_headers)
        assert resp.status_code == 201, f"Create dest warehouse failed: {resp.text}"
        dest_wh_id = resp.json()["id"]

        # Step 2: Create a product
        resp = await client.post("/api/v1/categories", json={
            "name": f"Stock Test Cat {unique}",
        }, headers=admin_headers)
        assert resp.status_code == 201
        category_id = resp.json()["id"]

        resp = await client.post("/api/v1/products", json={
            "name": f"Stock Test Product {unique}",
            "sku": f"STP-{unique}",
            "description": "Product for stock transfer E2E test",
            "price": 10.00,
            "category_id": category_id,
        }, headers=admin_headers)
        assert resp.status_code == 201, f"Create product failed: {resp.text}"
        product_id = resp.json()["id"]

        # Step 3: Add stock to source warehouse via adjust endpoint
        resp = await client.put("/api/v1/stock/adjust", json={
            "product_id": product_id,
            "warehouse_id": source_wh_id,
            "quantity": 100,
            "low_stock_threshold": 10,
        }, headers=admin_headers)
        assert resp.status_code == 200, f"Stock adjust failed: {resp.text}"

        # Step 4: Transfer stock (should fail — no stock at source for SAME warehouse)
        resp = await client.post("/api/v1/stock/transfers", json={
            "product_id": product_id,
            "from_warehouse_id": source_wh_id,
            "to_warehouse_id": source_wh_id,
            "quantity": 5,
        }, headers=admin_headers)
        assert resp.status_code == 400, f"Same warehouse transfer should be 400: {resp.text}"

        # Step 5: Transfer stock successfully
        resp = await client.post("/api/v1/stock/transfers", json={
            "product_id": product_id,
            "from_warehouse_id": source_wh_id,
            "to_warehouse_id": dest_wh_id,
            "quantity": 30,
        }, headers=admin_headers)
        assert resp.status_code == 201, f"Stock transfer failed: {resp.text}"

        # Step 6: Verify balances — source should have 70, dest should have 30
        resp = await client.get("/api/v1/stock", headers=admin_headers)
        assert resp.status_code == 200, f"List stock failed: {resp.text}"
        stock_items = resp.json()["items"]
        source_stock = [s for s in stock_items if s["product_id"] == product_id and s["warehouse_id"] == source_wh_id]
        dest_stock = [s for s in stock_items if s["product_id"] == product_id and s["warehouse_id"] == dest_wh_id]
        assert len(source_stock) == 1 and source_stock[0]["quantity"] == 70, f"Source balance wrong: {source_stock}"
        assert len(dest_stock) == 1 and dest_stock[0]["quantity"] == 30, f"Dest balance wrong: {dest_stock}"

        # Step 7: Verify transfer history
        resp = await client.get("/api/v1/stock/transfers", headers=admin_headers)
        assert resp.status_code == 200, f"Transfer history failed: {resp.text}"
        transfers = resp.json()["items"]
        our_transfer = [t for t in transfers if t["product_id"] == product_id]
        assert len(our_transfer) >= 1, "Transfer not found in history"

        # Step 8: Check low stock alerts endpoint works
        resp = await client.get("/api/v1/stock/alerts", headers=admin_headers)
        assert resp.status_code == 200, f"Stock alerts failed: {resp.text}"


# ── Workflow 4: Error Handling & Edge Cases ─────────────────────────

class TestErrorHandlingWorkflow:
    """Verify the API returns correct error responses for common edge cases."""

    @pytest.mark.asyncio
    async def test_invalid_uuid_returns_422(self, client: AsyncClient, admin_headers: dict):
        """Invalid UUID path params must return 422, not 500."""
        for endpoint in [
            "/api/v1/products/not-a-uuid",
            "/api/v1/categories/invalid",
            "/api/v1/warehouses/garbage-id",
        ]:
            resp = await client.get(endpoint, headers=admin_headers)
            assert resp.status_code == 422, f"{endpoint} returned {resp.status_code}, expected 422"

    @pytest.mark.asyncio
    async def test_nonexistent_uuid_returns_404(self, client: AsyncClient, admin_headers: dict):
        """Valid UUID format but nonexistent resource must return 404."""
        fake_id = "00000000-0000-0000-0000-000000000000"
        for endpoint in [
            f"/api/v1/products/{fake_id}",
            f"/api/v1/categories/{fake_id}",
            f"/api/v1/warehouses/{fake_id}",
        ]:
            resp = await client.get(endpoint, headers=admin_headers)
            assert resp.status_code == 404, f"{endpoint} returned {resp.status_code}, expected 404"

    @pytest.mark.asyncio
    async def test_unauthorized_returns_401(self, client: AsyncClient):
        """Protected routes without auth must return 401."""
        resp = await client.get("/api/v1/products")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_error_format_consistency(self, client: AsyncClient, admin_headers: dict):
        """All error responses must have {"detail": "..."} format."""
        fake_id = "00000000-0000-0000-0000-000000000000"
        resp = await client.get(f"/api/v1/products/{fake_id}", headers=admin_headers)
        assert resp.status_code == 404
        body = resp.json()
        assert "detail" in body, f"Error response missing 'detail' key: {body}"

    @pytest.mark.asyncio
    async def test_x_request_id_on_every_response(self, client: AsyncClient):
        """Every response must include X-Request-Id header."""
        resp = await client.get("/api/v1/health")
        assert "x-request-id" in resp.headers, f"Missing X-Request-Id header"


# ── Workflow 5: Rate Limiting ───────────────────────────────────────

class TestRateLimitWorkflow:
    """Verify rate limiting triggers correctly on auth endpoints.

    NOTE: Uses /auth/register (5/min limit) instead of /auth/login (10/min)
    because admin_headers fixture and test_auth.py also hit /auth/login,
    sharing the same rate-limit bucket. This avoids cross-contamination.
    """

    @pytest.mark.asyncio
    async def test_register_rate_limit_triggers(self, client: AsyncClient):
        """Sending more than 5 register requests/min must trigger 429."""
        for i in range(10):
            resp = await client.post("/api/v1/auth/register", json={
                "email": f"ratelimit_{i}@test.com",
                "username": f"ratelimit_{i}",
                "password": "SecurePass123!",
            })
            if resp.status_code == 429:
                # Rate limit triggered — test passes
                return

        pytest.fail("Rate limit not triggered after 10 register requests")
```

**Key design principles for E2E tests:**

1. **Each test is a complete journey** — register through audit log, not just one endpoint.
2. **Use unique data per test** — `uuid.uuid4().hex[:8]` suffix prevents collisions between test runs.
3. **Assert on status codes AND response shapes** — catches both routing errors and serialization errors.
4. **Test UUID validation explicitly** — invalid UUIDs must return 422 (not 500), valid-but-nonexistent must return 404.
5. **Test rate limiting with the limiter enabled** — do NOT use `DISABLE_RATE_LIMIT` env var. The E2E test sends enough requests to trigger the limit naturally.
6. **Error messages in assertions** — every `assert` includes the response text so failures are debuggable.

### `conftest.py` (Verbatim Skeleton — Do NOT Deviate on Structure)

This is the **required structure** for `conftest.py`. The session-scoped fixtures ensure all async tests share one event loop and one database connection. The `seed_database` fixture populates the test DB with the admin user and seed data so that `admin_headers` works.

```python
"""Test configuration — async fixtures for database, client, and auth."""

import asyncio
import subprocess
import uuid
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.config import settings
from src.main import app

# Test database URL — same Postgres, different database name
# Use rsplit to replace ONLY the database name (last path segment), not the username in the authority
TEST_DB_URL = settings.DATABASE_URL.rsplit("/", 1)[0] + "/shipapi_test"
# Base URL without the database name — for connecting to create/drop the test DB
BASE_DB_URL = settings.DATABASE_URL.rsplit("/", 1)[0] + "/postgres"


@pytest.fixture(scope="session")
async def setup_test_database():
    """Create the test database, run migrations and seed, then drop on teardown."""
    # Connect to default 'postgres' DB to create/drop the test database
    engine = create_async_engine(BASE_DB_URL, isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        # Drop if exists (handles dirty state from crashed previous runs)
        await conn.execute(text("DROP DATABASE IF EXISTS shipapi_test"))
        await conn.execute(text("CREATE DATABASE shipapi_test"))
    await engine.dispose()

    # Run Alembic migrations against the test database
    alembic_ini = Path(__file__).parent.parent / "alembic.ini"
    subprocess.run(
        ["alembic", "-c", str(alembic_ini), "upgrade", "head"],
        env={**dict(__import__("os").environ), "DATABASE_URL": TEST_DB_URL},
        check=True,
    )

    # Seed the test database (creates demo@workermill.com admin user + sample data)
    subprocess.run(
        ["python", "-m", "seed"],
        env={**dict(__import__("os").environ), "DATABASE_URL": TEST_DB_URL},
        check=True,
        cwd=str(Path(__file__).parent.parent),
    )

    yield

    # Teardown — drop the test database
    engine = create_async_engine(BASE_DB_URL, isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        # Terminate any remaining connections
        await conn.execute(text(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = 'shipapi_test' AND pid <> pg_backend_pid()"
        ))
        await conn.execute(text("DROP DATABASE IF EXISTS shipapi_test"))
    await engine.dispose()


@pytest.fixture(scope="session")
async def db_engine(setup_test_database):
    """Create the async engine for the test database."""
    engine = create_async_engine(TEST_DB_URL)
    yield engine
    await engine.dispose()


@pytest.fixture(scope="session")
async def db_session_factory(db_engine):
    """Create a session factory bound to the test engine."""
    return async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture
async def db_session(db_session_factory):
    """Per-test database session with automatic rollback."""
    async with db_session_factory() as session:
        yield session
        await session.rollback()


@pytest.fixture(scope="session")
async def client(db_engine, setup_test_database) -> AsyncClient:
    """Session-scoped async HTTP client for the FastAPI app.

    CRITICAL: Override the app's get_db dependency to use the test engine.
    Without this, FastAPI routes use the engine from src/database.py which
    was created at import time on a different event loop, causing:
    RuntimeError: Task got Future attached to a different loop
    """
    from src.database import get_db

    test_session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with test_session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(scope="session")
async def admin_headers(client: AsyncClient) -> dict:
    """Login as the seeded admin user and return auth headers.

    MUST be session-scoped to share the event loop with `client`.
    Depends on seed data — demo@workermill.com / demo1234.
    """
    resp = await client.post("/api/v1/auth/login", json={
        "email": "demo@workermill.com",
        "password": "demo1234",
    })
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
async def regular_user_headers(client: AsyncClient) -> dict:
    """Register and login a non-admin user, return auth headers."""
    unique = uuid.uuid4().hex[:8]
    await client.post("/api/v1/auth/register", json={
        "email": f"regular_{unique}@test.com",
        "username": f"regular_{unique}",
        "password": "TestPass123!",
    })
    resp = await client.post("/api/v1/auth/login", json={
        "email": f"regular_{unique}@test.com",
        "password": "TestPass123!",
    })
    assert resp.status_code == 200, f"Regular user login failed: {resp.text}"
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
```

**Critical rules for `conftest.py`:**
- `setup_test_database`, `db_engine`, `client`, `admin_headers`, and `regular_user_headers` MUST all be `scope="session"`. Function-scoped async fixtures against a session-scoped client cause `asyncpg InterfaceError` event loop mismatches.
- The `client` fixture MUST override `app.dependency_overrides[get_db]` to use the test engine. Without this, FastAPI routes use the engine from `src/database.py` (created at import time on a different event loop), causing `RuntimeError: Task got Future attached to a different loop`. This is the #1 cause of test failures.
- The test database is created via `DROP IF EXISTS` + `CREATE` — this handles dirty state from crashed runs.
- Seed data is loaded via `python -m seed` subprocess — this creates the `demo@workermill.com` admin user that `admin_headers` depends on.
- **When tests fail with event loop errors, do NOT:** (1) remove `asyncio_default_fixture_loop_scope` from pyproject.toml, (2) change session-scoped fixtures to function scope, (3) add lazy engine initialization or `reset_engine()` to database.py, (4) add `TESTING` or `DISABLE_RATE_LIMIT` env vars. The correct fix is always to ensure the `get_db` override is working and all fixtures share `scope="session"`.

---

## Configuration Files

### `Dockerfile`

```dockerfile
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM python:3.13-slim AS backend-builder
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
# CRITICAL: README.md must be copied here because the build backend validates
# that the readme file declared in pyproject.toml exists during uv sync.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev
COPY . .

# Stage 3: Production image
FROM python:3.13-slim
WORKDIR /app
RUN groupadd -r shipapi && useradd -r -g shipapi shipapi
COPY --from=backend-builder /app /app
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
# CRITICAL: Railway's preDeployCommand runs bare `alembic` and `python` —
# without this PATH, those commands won't find the virtualenv binaries.
ENV PATH="/app/.venv/bin:$PATH"
USER shipapi
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')"
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**CRITICAL Dockerfile rules:**
- The builder stage `COPY` line MUST include `README.md`: `COPY pyproject.toml uv.lock README.md ./`. The build backend (`hatchling`) validates that the readme file declared in `pyproject.toml` exists when `uv sync` installs the project. Without `README.md`, the Docker build fails with `OSError: Readme file does not exist`.
- The production stage MUST copy `alembic.ini` — Railway's `preDeployCommand` runs `alembic upgrade head` which reads this file. Without it, the container crashes on startup.
- The frontend build stage MUST run before the production stage — `frontend/dist/` is copied into the final image and served by FastAPI's StaticFiles mount.

### `railway.toml`

```toml
[build]
builder = "DOCKERFILE"

[deploy]
healthcheckPath = "/api/v1/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
preDeployCommand = "alembic upgrade head && python -m seed"
```

### Railway Environment Variables (pre-configured in dashboard)

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Neon pooled connection (`postgresql+asyncpg://...@...-pooler...`) |
| `DATABASE_URL_DIRECT` | Neon direct connection (`postgresql+asyncpg://...@...`) |
| `JWT_SECRET_KEY` | Random 64-char hex secret |
| `PORT` | `8000` |

### GitHub Secrets (pre-configured)

`RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_SVC_ID`, `JWT_SECRET_KEY` — all set.

---

## CI/CD

### CI Workflow (`.github/workflows/ci.yml`) (Verbatim — Do NOT Deviate)

This is the **exact and complete** CI workflow — use it verbatim. Do NOT change the ruff/pytest paths, do NOT change the port (5432), do NOT add extra steps or caching. The `src/ tests/` path arguments on ruff are critical — without them, ruff checks `seed/` and `alembic/` which have different ignore rules via `per-file-ignores`.

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v7

      - name: Set up Python
        run: uv python install 3.13

      - name: Install dependencies
        run: uv sync --frozen

      - name: Start PostgreSQL
        run: |
          docker compose down --remove-orphans
          docker compose up -d --wait

      - name: Lint & format (backend)
        run: |
          uv run ruff check src/ tests/
          uv run ruff format --check src/ tests/

      - name: Type check (backend)
        run: uv run mypy src

      - name: Run unit tests (backend)
        env:
          DATABASE_URL: postgresql+asyncpg://shipapi:shipapi@localhost:5432/shipapi_test
        run: uv run pytest tests/ -v --tb=short --ignore=tests/test_e2e_workflows.py

      - name: Run E2E workflow tests (backend)
        env:
          DATABASE_URL: postgresql+asyncpg://shipapi:shipapi@localhost:5432/shipapi_test
        run: uv run pytest tests/test_e2e_workflows.py -v --tb=short

      - name: Stop PostgreSQL
        if: always()
        run: docker compose down

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install frontend dependencies
        run: cd frontend && npm ci

      - name: Lint (frontend)
        run: cd frontend && npm run lint

      - name: Type check (frontend)
        run: cd frontend && npx tsc --noEmit

      - name: Build (frontend)
        run: cd frontend && npm run build
```

### Deploy Workflow (`.github/workflows/deploy.yml`)

**Manual trigger only (`workflow_dispatch`).** Do NOT auto-deploy on every push to main — with 12 sequential epics merging PRs, auto-deploy would hammer Railway with redundant builds, risk rate limits, and cause smoke test failures against redeploying services. The final deployment epic triggers this workflow manually after all code is merged and CI passes.

```yaml
name: Deploy
on:
  workflow_dispatch:  # Manual trigger only — do NOT auto-deploy on every push

jobs:
  deploy:
    runs-on: ubuntu-latest
    container: ghcr.io/railwayapp/cli:latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Railway
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up --service shipapi --detach

  smoke-test:
    runs-on: ubuntu-latest
    needs: deploy
    if: success()
    steps:
      - name: Wait for deployment
        run: sleep 90

      - name: Smoke test production
        run: |
          URL="https://shipapi.workermill.com"

          # 1. Health check
          curl -sf "$URL/api/v1/health" | grep -q '"status"' || { echo "FAIL: Health"; exit 1; }

          # 2. Swagger UI loads
          curl -sf "$URL/docs" | grep -q "swagger" || { echo "FAIL: Swagger"; exit 1; }

          # 3. ReDoc loads
          curl -sf "$URL/redoc" | grep -q "redoc" || { echo "FAIL: ReDoc"; exit 1; }

          # 4. Login works
          TOKEN=$(curl -sf -X POST "$URL/api/v1/auth/login" \
            -H "Content-Type: application/json" \
            -d '{"email":"demo@workermill.com","password":"demo1234"}' \
            | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
          [ -n "$TOKEN" ] || { echo "FAIL: Login"; exit 1; }

          # 5. Seeded data exists
          PRODUCTS=$(curl -sf "$URL/api/v1/products" \
            -H "Authorization: Bearer $TOKEN" \
            | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('total', len(d.get('items',[]))))")
          [ "$PRODUCTS" -ge 40 ] || { echo "FAIL: Expected 40+ products, got $PRODUCTS"; exit 1; }

          # 6. Search works
          curl -sf "$URL/api/v1/products?search=test" \
            -H "Authorization: Bearer $TOKEN" | grep -q '"items"' || { echo "FAIL: Search"; exit 1; }

          # 7. X-Request-Id header present
          curl -sI "$URL/api/v1/health" | grep -qi "x-request-id" || { echo "FAIL: X-Request-Id"; exit 1; }

          echo "PASS: All smoke tests passed"
```

---

## Frontend — React Dashboard

The frontend is a **separate React 19 + Vite + TypeScript application** that lives in the `frontend/` directory of the same repo. It communicates with the FastAPI backend via REST API calls. The frontend is what visitors see when they open https://shipapi.workermill.com — it must be polished, interactive, and demonstrate a real product.

### Tech Stack (Frontend)

- **React 19** with TypeScript (strict mode)
- **Vite** for dev server and production builds
- **Tailwind CSS v4** for styling — dark theme by default, professional look. **v4 uses CSS-based configuration** (`@import "tailwindcss"` in `index.css` + `@theme` block for customization). There is NO `tailwind.config.ts` or `postcss.config.js` — those are v3 artifacts. Install with `@tailwindcss/vite` plugin in `vite.config.ts`.
- **shadcn/ui** components (Button, Card, Table, Dialog, Input, Badge, Tabs, etc.) — use the **`new-york`** style. Use **`tw-animate-css`** for animations — do NOT use `tailwindcss-animate` (deprecated for Tailwind v4). Use the verbatim `components.json` below — do NOT run `npx shadcn@latest init` (it may generate Tailwind v3 config files depending on version). Instead, create `components.json` manually and then add individual components with `npx shadcn@latest add button card table dialog input badge tabs`.
- **Recharts** for dashboard charts and visualizations
- **Axios** for API calls with JWT interceptor
- **React Router v7** for client-side routing — import from `react-router` (not `react-router-dom`, which is a v6 artifact)
- **Lucide React** for icons

### Project Structure (Frontend)

```
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── components.json          # shadcn/ui config
├── public/
│   └── favicon.ico
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css             # Tailwind v4 CSS-based config (@import "tailwindcss" + @theme)
    ├── lib/
    │   ├── api.ts            # Axios instance with JWT interceptor
    │   └── utils.ts          # cn() helper for tailwind merge
    ├── hooks/
    │   ├── useAuth.ts        # Auth context + token management
    │   └── useApi.ts         # Generic data fetching hook
    ├── components/
    │   ├── ui/               # shadcn/ui primitives
    │   ├── Layout.tsx         # App shell — sidebar + topbar + main content
    │   ├── Sidebar.tsx        # Navigation sidebar with links and branding
    │   ├── ProtectedRoute.tsx # Auth guard wrapper
    │   └── StatsCard.tsx      # Reusable metric card for dashboard
    └── pages/
        ├── LoginPage.tsx
        ├── DashboardPage.tsx
        ├── ProductsPage.tsx
        ├── CategoriesPage.tsx
        ├── WarehousesPage.tsx
        ├── StockPage.tsx
        ├── AuditPage.tsx
        └── ApiDocsPage.tsx
```

### `components.json` (Verbatim — Do NOT Deviate)

This is the **exact** shadcn/ui config for Tailwind v4. Do NOT run `npx shadcn@latest init` — it may generate a `tailwind.config.ts` file. Create this file manually.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

The `"config": ""` field is critical — it tells shadcn there is no `tailwind.config.ts` (Tailwind v4 uses CSS-based config). The `tsconfig.json` must include path aliases matching the `aliases` above:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

And `vite.config.ts` must include the path alias and Tailwind v4 plugin:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

### `src/index.css` (Verbatim Skeleton — Do NOT Deviate on Structure)

This is the Tailwind v4 CSS-based config. There is NO `tailwind.config.ts` or `postcss.config.js`. All theme customization happens here via `@theme inline`.

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar-background: var(--sidebar-background);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
}

@layer base {
  :root {
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.145 0 0);
    --card-foreground: oklch(0.985 0 0);
    --popover: oklch(0.145 0 0);
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.985 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --secondary: oklch(0.269 0 0);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.269 0 0);
    --muted-foreground: oklch(0.708 0 0);
    --accent: oklch(0.269 0 0);
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.396 0.141 25.723);
    --destructive-foreground: oklch(0.637 0.237 25.331);
    --border: oklch(0.269 0 0);
    --input: oklch(0.269 0 0);
    --ring: oklch(0.439 0 0);
    --radius: 0.625rem;
    --chart-1: oklch(0.488 0.243 264.376);
    --chart-2: oklch(0.696 0.17 162.48);
    --chart-3: oklch(0.769 0.188 70.08);
    --chart-4: oklch(0.627 0.265 303.9);
    --chart-5: oklch(0.645 0.246 16.439);
    --sidebar-background: oklch(0.145 0 0);
    --sidebar-foreground: oklch(0.985 0 0);
    --sidebar-primary: oklch(0.985 0 0);
    --sidebar-primary-foreground: oklch(0.205 0 0);
    --sidebar-accent: oklch(0.269 0 0);
    --sidebar-accent-foreground: oklch(0.985 0 0);
    --sidebar-border: oklch(0.269 0 0);
    --sidebar-ring: oklch(0.439 0 0);
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

This is the **dark theme by default** (slate palette, dark oklch values on `:root`). The `@theme inline` block maps CSS variables to Tailwind utility classes. The `@custom-variant dark` line enables `.dark` class toggling if needed. Chart colors are used by Recharts integration via shadcn/ui.

Do NOT add a separate `:root` light theme block — this is a dark-only showcase app.

### `src/lib/utils.ts` (Required by shadcn/ui)

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Install the dependencies: `npm install clsx tailwind-merge`. Every shadcn/ui component imports `cn` from `@/lib/utils`.

### `package.json` Dependencies (Frontend)

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.0.0",
    "axios": "^1.7.0",
    "recharts": "^2.15.0",
    "lucide-react": "^0.460.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^3.0.0",
    "class-variance-authority": "^0.7.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/node": "^22.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "tw-animate-css": "^1.0.0",
    "@eslint/js": "^9.0.0",
    "eslint": "^9.0.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "typescript-eslint": "^8.0.0",
    "globals": "^16.0.0"
  }
}
```

Do NOT install `tailwindcss-animate`, `react-router-dom`, `postcss`, or `autoprefixer`. `react-router-dom` is a v6 re-export — v7 uses `react-router` directly. `postcss` and `autoprefixer` are v3 artifacts replaced by `@tailwindcss/vite`.

### Pages

#### Login Page (`/login`)
- Clean login form with email + password fields
- Demo credentials pre-filled or shown as hint: `demo@workermill.com` / `demo1234`
- JWT token stored in localStorage, auto-redirect to dashboard on success
- "Built by WorkerMill" footer with link

#### Dashboard (`/` — protected)
- **Summary stats row**: Total Products, Total Categories, Total Warehouses, Low Stock Alerts — each in a card with icon and count fetched from API
- **Charts section**:
  - Bar chart: stock levels by warehouse (fetch each warehouse detail via `GET /warehouses/{id}` which includes stock summary, or aggregate from `GET /stock?warehouse_id={id}`)
  - Pie chart: products by category (fetch categories list, each includes product count)
  - Line chart or area chart: recent audit activity over time (from `GET /audit/` entries, group by date client-side)
- **Recent activity feed**: Last 10 audit log entries in a compact list
- **Quick actions**: buttons to "Add Product", "Transfer Stock", "View API Docs"

#### Products Page (`/products` — protected)
- **Data table** with columns: Name, SKU, Category, Price, Status, Created
- **Search bar** using full-text search endpoint (`/products/?search=...`)
- **Filters**: category dropdown, status filter (active/discontinued)
- **Pagination** with page size selector
- **Create product dialog**: form with all fields (name, sku, description, category_id, price)
- **Row click** → product detail view or edit dialog
- **Delete** with confirmation

#### Categories Page (`/categories` — protected)
- **Data table**: Name, Description, Product Count
- **Create / Edit / Delete** with dialogs
- Click category → filtered products list

#### Warehouses Page (`/warehouses` — protected)
- **Card grid layout**: each warehouse as a card showing name, code, address, active status, and total stock quantity (sum of all StockLevel records for that warehouse)
- **Stock summary** per warehouse from API
- **Create / Edit warehouse** dialogs
- Click warehouse → stock detail view for that warehouse

#### Stock Management Page (`/stock` — protected)
- **Stock levels table**: Product, Warehouse, Quantity, Last Updated
- **Transfer stock dialog**: source warehouse, destination warehouse, product, quantity — calls atomic transfer endpoint
- **Adjust stock dialog**: warehouse, product, new quantity, low_stock_threshold — calls `PUT /api/v1/stock/adjust`
- **Low stock alerts**: highlighted rows for items below threshold
- **Filters**: by warehouse, by product

#### Audit Log Page (`/audit` — protected)
- **Searchable, filterable audit log table**
- Columns: Timestamp, Action, Entity Type, Entity ID, User, Details
- **Filters**: action type, entity type, date range
- **Pagination**
- Formatted JSON details in expandable rows

#### API Documentation Page (`/api-docs` — protected)
- **Embedded iframe** or redirect to the FastAPI Swagger UI at `/docs`
- Alternative: link cards to both `/docs` (Swagger) and `/redoc` (ReDoc)

### API Integration

The frontend uses Axios with a JWT interceptor:
- On login: store `access_token` and `refresh_token` in localStorage
- All API calls include `Authorization: Bearer <token>` header
- On 401: attempt token refresh using `/auth/refresh`, retry original request
- On refresh failure: redirect to login
- Base URL: configured via `VITE_API_URL` env var (defaults to `/api/v1` for same-origin since all endpoints are under `/api/v1/`, or the full backend URL + `/api/v1` for separate deploys)

### CORS Configuration

The backend MUST allow CORS from the frontend origin. **Do NOT use `allow_origins=["*"]` with `allow_credentials=True`** — this is invalid per the Fetch specification and browsers will block the request silently. Since the frontend is served from the same origin (FastAPI StaticFiles mount), CORS is only needed for local development where Vite runs on a different port.

```python
import os
from fastapi.middleware.cors import CORSMiddleware

# CORS origins — same-origin in production, localhost in dev
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

In Railway, `CORS_ORIGINS` does not need to be set — the frontend is served from the same origin via StaticFiles. For local development, the default `http://localhost:5173` covers the Vite dev server.

### Frontend Deployment

The frontend builds to static files (`frontend/dist/`) and is served by the FastAPI backend using `StaticFiles`:

```python
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

# Serve frontend static files (after all API routes)
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(frontend_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dir, "assets")), name="static")

    @app.get("/{path:path}")
    async def serve_frontend(path: str):
        """Serve React SPA — all non-API routes return index.html"""
        file_path = os.path.join(frontend_dir, path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_dir, "index.html"))
```

The verbatim Dockerfile (in Configuration Files above) already includes the frontend build stage.

### Design Requirements

- **Dark theme** — dark gray/slate backgrounds, not pure black. Professional, modern look.
- **Responsive** — works on desktop (1280px+) and tablet (768px+). Mobile is nice-to-have.
- **Loading states** — skeleton loaders on data tables, spinner on form submissions
- **Error states** — toast notifications for API errors, inline form validation
- **Empty states** — should NEVER happen in the demo (seed data covers this), but include friendly messages just in case
- **Transitions** — subtle fade/slide animations on page transitions and dialog open/close
- **"Built by WorkerMill"** — footer link on every page, links to https://workermill.com

---

## Development Environment

- **uv** is pre-installed. Run `source $HOME/.local/bin/env` before any `uv` commands to ensure it is on PATH.
- **Python 3.13** is available via uv — do not attempt to install Python separately.
- **Docker and Docker Compose** are available for running PostgreSQL. Always run `docker compose down --remove-orphans` before `docker compose up -d --wait` to clean up stale containers from previous runs.
- All quality gate commands must be prefixed with `source $HOME/.local/bin/env &&` to ensure uv is available.

---

## `pyproject.toml` (Verbatim — Do NOT Deviate)

This is the **exact and complete** `pyproject.toml` — use it verbatim. Do NOT add extra lint rules (especially NOT `TCH`/`ARG`/`C4`), do NOT change the line-length, do NOT add `strict = true` to mypy, do NOT add extra pytest options. These settings are tuned to avoid false positives that waste revision cycles.

```toml
[project]
name = "shipapi"
version = "0.1.0"
description = "Production-grade inventory management REST API"
readme = "README.md"
requires-python = ">=3.13"
dependencies = [
    "fastapi",
    "sqlalchemy[asyncio]",
    "asyncpg",
    "alembic",
    "pydantic[email]",
    "pydantic-settings",
    "PyJWT",
    "bcrypt",
    "slowapi",
    "httpx",
    "uvicorn",
]

[dependency-groups]
dev = [
    "pytest",
    "pytest-asyncio",
    "ruff",
    "mypy",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src"]

[tool.ruff]
line-length = 120
target-version = "py313"

[tool.ruff.lint]
select = ["E", "F", "W", "I", "N", "UP", "B", "A", "SIM", "RUF", "S", "PL", "INP", "DTZ"]
ignore = ["UP017", "PLW0603"]

[tool.ruff.lint.per-file-ignores]
"src/routers/*.py" = ["B008"]
"tests/*.py" = ["S101", "PLR2004"]
"seed/*.py" = ["PLR2004"]
"alembic/**/*.py" = ["INP001"]

[tool.ruff.lint.flake8-bugbear]
extend-immutable-calls = ["fastapi.Depends", "fastapi.Query", "fastapi.Path", "fastapi.Body", "fastapi.Header"]

[tool.mypy]
python_version = "3.13"
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
ignore_missing_imports = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
```

This file is verbatim — copy it exactly. Do NOT modify lint rules, line-length, mypy flags, or pytest options.
