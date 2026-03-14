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
6. **All path parameters referencing model IDs MUST be typed `uuid.UUID`**, not `str`. FastAPI validates UUID format automatically and returns 422 for invalid values — this prevents `psycopg2 DataError` crashes when garbage strings hit the database. Example:
   ```python
   import uuid
   @router.get("/{product_id}")
   def get_product(product_id: uuid.UUID, db: Session = Depends(get_db)):
       result = db.execute(select(Product).where(Product.id == product_id))
   ```
   Do NOT use `product_id: str` — psycopg2 will throw `DataError: invalid UUID` instead of a clean error response.
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
11. **`TYPE_CHECKING` guards for cross-model imports** — models referencing other models (e.g., Product -> Category) must import inside `if TYPE_CHECKING:` and use string annotations (`"Category"` not `Category`) in relationships to avoid circular imports.
12. **All primary keys are UUIDs.** Define as `id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)`. Do NOT use `SERIAL`, `BIGSERIAL`, or `Integer` primary keys.
13. **No hardcoded absolute paths** — do NOT use paths containing `/workspace/`, `/worktrees/`, `/tmp/`, or any build-environment directory. Use `Path(__file__).parent` for relative resolution. These paths break in CI, Docker, and production.
14. **Dependency list is locked** — do NOT add packages not in the `pyproject.toml` below. In particular: no `structlog`, `loguru`, `python-jose`, `passlib`, or `python-slugify`. If it's not in the dependency list, you don't need it.
15. **Tests run against real PostgreSQL** — do NOT mock the database, do NOT use SQLite. Features like `TSVECTOR`, `SELECT FOR UPDATE`, and GIN indexes are PostgreSQL-only. Use `docker compose up -d --wait` before running tests.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | FastAPI | Latest |
| Language | Python | 3.13 |
| ORM | SQLAlchemy 2.0 | Sync with psycopg2 |
| Database | PostgreSQL (Neon) | With connection pooling |
| Migrations | Alembic | Standard config |
| Validation | Pydantic V2 + pydantic-settings | BaseModel with field validators, Settings class |
| Auth | JWT (access + refresh) + API keys | PyJWT for tokens, bcrypt for passwords, SHA-256 for API keys |
| Rate Limiting | slowapi | Per-endpoint limits |
| Testing | pytest + FastAPI TestClient | Unit + E2E workflow tests |
| Type Checking | mypy | Non-strict (see pyproject.toml) |
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
- **Sync SQLAlchemy** — all database operations use sync SQLAlchemy with psycopg2
- **Docker image <200MB**, non-root user
- **mypy** on `src/` directory (non-strict — see pyproject.toml)
- **API prefix:** All endpoints under `/api/v1/` (exception: `/showcase/stats` is a public stats endpoint outside this prefix — no auth required)
- **Standard error format:** `{ "detail": "message" }` with appropriate HTTP status codes
- **X-Request-Id** header on every response for traceability
- **All tests run against real PostgreSQL** — no mocking the database. Use `docker-compose` to spin up Postgres locally.

### Pre-Commit Quality Gates

```
docker compose down --remove-orphans
docker compose up -d --wait
uv run ruff check src/ tests/
uv run ruff format --check src/ tests/
uv run mypy src
DATABASE_URL=postgresql://shipapi:shipapi@localhost:5432/shipapi_test uv run pytest tests/ -v --tb=short --ignore=tests/test_e2e_workflows.py
DATABASE_URL=postgresql://shipapi:shipapi@localhost:5432/shipapi_test uv run pytest tests/test_e2e_workflows.py -v --tb=short
docker compose down
cd frontend && npm run lint
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

Tests MUST pass against a real Postgres instance before pushing. Do NOT mock SQLAlchemy sessions or use SQLite as a test database — features like `TSVECTOR`, `SELECT FOR UPDATE`, and GIN indexes only work on real PostgreSQL.

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
│   ├── database.py           — create_engine, sessionmaker, get_db dependency
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
│   ├── conftest.py           — fixtures: test DB create/drop, TestClient, auth helpers
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
│   ├── env.py                — reads DATABASE_URL from environment
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
# WRONG: from src.database import engine
# RIGHT: db: Session = Depends(get_db)
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

db.execute(
    update(Product)
    .where(Product.id == product.id)
    .values(search_vector=func.to_tsvector(
        "english",
        Product.name + " " + func.coalesce(Product.description, "")
    ))
)
db.commit()
```

**Why not `product.search_vector = func.to_tsvector(...)`?** Assigning a SQLAlchemy `func` object to an ORM attribute does NOT evaluate it — it stores the function expression, which may produce unexpected results on flush. Use an explicit `UPDATE` statement instead, which sends the `to_tsvector()` call to PostgreSQL where it belongs.

Do NOT use `server_default=text("to_tsvector(...)")` — it causes migration failures.

### Key Features

- **Full-text search:** TSVECTOR column + GIN index on Product for PostgreSQL full-text search with `ts_rank` relevance ordering
- **Self-referential categories:** `parent_id` enables subcategory hierarchy (5 top-level + 15 subcategories)
- **Category slug:** Auto-generated from `name` on create/update using basic slugification: lowercase, replace spaces/special chars with hyphens, strip leading/trailing hyphens. Example: `"Industrial Sensors"` -> `"industrial-sensors"`. Do NOT add a `slugify` library — implement inline with `re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')`. If a slug collision occurs (409), the caller must use a unique name.
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
result = db.execute(
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

### Middleware

Use standard Starlette middleware for `RequestIdMiddleware` and `AccessLogMiddleware`. Do NOT use `BaseHTTPMiddleware` — use pure ASGI middleware instead.

### `src/database.py`

Sync database setup using SQLAlchemy with psycopg2:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from src.config import settings

engine = create_engine(settings.DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)


def get_db():
    """Yield a database session per request. Override in tests."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

Do NOT add engine caching, lazy initialization, or `reset_engine()` functions. The engine is created once at import time. Do NOT import `engine` directly in routers — always use `Depends(get_db)`.

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
DATABASE_URL=postgresql://shipapi:shipapi@localhost:5432/shipapi alembic upgrade head
# Run seed
DATABASE_URL=postgresql://shipapi:shipapi@localhost:5432/shipapi python -m seed
# Run tests (uses separate test DB — conftest.py creates/drops it)
DATABASE_URL=postgresql://shipapi:shipapi@localhost:5432/shipapi_test pytest tests/ -v
# Run the app
DATABASE_URL=postgresql://shipapi:shipapi@localhost:5432/shipapi uvicorn src.main:app --reload --port 8000
```

### `.env.example`

```bash
# Database connection — psycopg2 driver
DATABASE_URL=postgresql://shipapi:shipapi@localhost:5432/shipapi
# Direct connection (Alembic migrations) — same for local, different for Neon
DATABASE_URL_DIRECT=postgresql://shipapi:shipapi@localhost:5432/shipapi
# JWT — generate with: openssl rand -hex 32
JWT_SECRET_KEY=change-me-to-a-long-random-secret-key
PORT=8000
```

### Alembic Configuration

Standard `alembic.ini` with `script_location = alembic`. The `sqlalchemy.url` in alembic.ini is a placeholder — `alembic/env.py` overrides it with `DATABASE_URL` from the environment at runtime. The `script_location` MUST be `alembic` (NOT `alembic_migrations`, NOT `migrations`, NOT `db/migrations`).

`alembic/env.py` reads `DATABASE_URL` from the environment and uses standard (sync) SQLAlchemy to run migrations.

---

## Testing

### Test Infrastructure

- `conftest.py` creates a test database (`shipapi_test`), runs Alembic migrations, seeds it, provides a `TestClient` fixture, and provides `admin_headers` and `regular_user_headers` fixtures. Drops the test database on teardown.
- **Tests run against real PostgreSQL** — `docker compose up -d --wait` before running tests
- All endpoints must have at least one test. Coverage is enforced by the E2E workflow tests — if an endpoint is broken, the workflow test catches it.
- **Path resolution:** Use `Path(__file__).parent.parent / "alembic.ini"` to locate the Alembic config. Do NOT hardcode absolute paths like `/workspace/...` or `/worktrees/...`.

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

The unit tests above test individual endpoints in isolation. The E2E tests test **complete user journeys** as multi-step sequences where each step depends on the previous. These catch integration bugs that unit tests miss — wrong status codes, serialization errors, missing validations, broken relationships between endpoints.

**These tests MUST pass before merging. They run as a separate pytest invocation:**

```
uv run pytest tests/test_e2e_workflows.py -v --tb=short
```

If E2E tests fail, the worker MUST fix the underlying issue and re-run — do NOT skip them, do NOT mark them as expected failures.

**5 workflow test classes, ordered from most fundamental to most complex:**

1. **Error handling** (`TestErrorHandlingWorkflow`) — validates UUID params return 422, nonexistent resources return 404, missing auth returns 401, all errors use `{"detail": "..."}` format, every response includes X-Request-Id header
2. **Auth lifecycle** (`TestAuthWorkflow`) — register -> login -> access protected route -> refresh token -> generate API key -> access with API key -> revoke key -> verify revoked key fails
3. **Product lifecycle** (`TestProductLifecycleWorkflow`) — create category -> create product -> search for product -> get detail -> update -> soft-delete -> verify audit log captured operations
4. **Stock transfer** (`TestStockTransferWorkflow`) — create warehouses -> create product -> adjust stock -> attempt same-warehouse transfer (400) -> transfer between warehouses -> verify balances -> check transfer history -> check alerts endpoint
5. **Rate limiting** (`TestRateLimitWorkflow`) — sends 10+ register requests, verifies 429 is triggered. Runs last to avoid polluting other tests' rate limit buckets.

**Key principles:** Each test uses `uuid.uuid4().hex[:8]` suffix for unique data. Every `assert` includes the response text for debuggable failures. Rate limiting is tested with the limiter enabled — do NOT use `DISABLE_RATE_LIMIT` env var.

---

## Configuration Files

### Dockerfile

Multi-stage Docker build: node frontend build -> uv backend dependency install -> python:3.13-slim runtime, non-root user, <200MB. The builder stage `COPY` line MUST include `README.md` (hatchling validates it exists). The production stage MUST set `ENV PATH="/app/.venv/bin:$PATH"` so Railway's `preDeployCommand` can find `alembic` and `python`. Frontend `dist/` is copied into the final image and served by FastAPI's StaticFiles mount.

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
| `DATABASE_URL` | Neon pooled connection (`postgresql://...@...-pooler...`) |
| `DATABASE_URL_DIRECT` | Neon direct connection (`postgresql://...@...`) |
| `JWT_SECRET_KEY` | Random 64-char hex secret |
| `PORT` | `8000` |

### GitHub Secrets (pre-configured)

`RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_SVC_ID`, `JWT_SECRET_KEY` — all set.

---

## CI/CD

### CI Workflow (`.github/workflows/ci.yml`)

GitHub Actions CI: lint (`ruff check src/ tests/`), format (`ruff format --check src/ tests/`), typecheck (`mypy src`), pytest against postgres (unit tests and E2E tests as separate invocations), frontend lint + typecheck + build. Uses `docker compose` for postgres, `uv` for Python, Node 20 for frontend. The `src/ tests/` path arguments on ruff are critical — without them, ruff checks `seed/` and `alembic/` which have different ignore rules. `DATABASE_URL` uses `postgresql://` format.

### Deploy Workflow (`.github/workflows/deploy.yml`)

**Manual trigger only (`workflow_dispatch`).** Do NOT auto-deploy on every push to main — with 12 sequential epics merging PRs, auto-deploy would hammer Railway with redundant builds. Uses Railway CLI container (`ghcr.io/railwayapp/cli:latest`) to deploy. Includes smoke tests after deployment: health check, Swagger UI, ReDoc, login, seeded data verification (40+ products), search, X-Request-Id header.

---

## Frontend — React Dashboard

The frontend is a **separate React 19 + Vite + TypeScript application** that lives in the `frontend/` directory of the same repo. It communicates with the FastAPI backend via REST API calls. The frontend is what visitors see when they open https://shipapi.workermill.com — it must be polished, interactive, and demonstrate a real product.

### Tech Stack (Frontend)

- **React 19** with TypeScript (strict mode)
- **Vite** for dev server and production builds
- **Tailwind CSS v4** for styling — dark theme by default, professional look. **v4 uses CSS-based configuration** (`@import "tailwindcss"` in `index.css` + `@theme` block for customization). There is NO `tailwind.config.ts` or `postcss.config.js` — those are v3 artifacts. Install with `@tailwindcss/vite` plugin in `vite.config.ts`.
- **shadcn/ui** components (Button, Card, Table, Dialog, Input, Badge, Tabs, etc.) — use the **`new-york`** style, `tw-animate-css` for animations (NOT `tailwindcss-animate`). shadcn/ui new-york style, Tailwind v4 CSS-based config (no tailwind.config.ts).
- **Recharts** for dashboard charts and visualizations
- **Axios** for API calls with JWT interceptor
- **React Router v7** for client-side routing — import from `react-router` (not `react-router-dom`, which is a v6 artifact)
- **Lucide React** for icons

### Frontend Theme

Dark theme using shadcn/ui slate palette, oklch colors. Dark-only — do NOT add a separate light theme. `@theme inline` block maps CSS variables to Tailwind utility classes. Chart colors are used by Recharts integration via shadcn/ui.

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
  - Bar chart: stock levels by warehouse
  - Pie chart: products by category
  - Line chart or area chart: recent audit activity over time
- **Recent activity feed**: Last 10 audit log entries in a compact list
- **Quick actions**: buttons to "Add Product", "Transfer Stock", "View API Docs"

#### Products Page (`/products` — protected)
- **Data table** with columns: Name, SKU, Category, Price, Status, Created
- **Search bar** using full-text search endpoint (`/products/?search=...`)
- **Filters**: category dropdown, status filter (active/discontinued)
- **Pagination** with page size selector
- **Create product dialog**: form with all fields (name, sku, description, category_id, price)
- **Row click** -> product detail view or edit dialog
- **Delete** with confirmation

#### Categories Page (`/categories` — protected)
- **Data table**: Name, Description, Product Count
- **Create / Edit / Delete** with dialogs
- Click category -> filtered products list

#### Warehouses Page (`/warehouses` — protected)
- **Card grid layout**: each warehouse as a card showing name, code, address, active status, and total stock quantity
- **Stock summary** per warehouse from API
- **Create / Edit warehouse** dialogs
- Click warehouse -> stock detail view for that warehouse

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
- Base URL: configured via `VITE_API_URL` env var (defaults to `/api/v1` for same-origin)

### CORS Configuration

The backend MUST allow CORS from the frontend origin. **Do NOT use `allow_origins=["*"]` with `allow_credentials=True`** — this is invalid per the Fetch specification and browsers will block the request silently. Since the frontend is served from the same origin (FastAPI StaticFiles mount), CORS is only needed for local development where Vite runs on a different port. Default origins: `http://localhost:5173`.

### Frontend Deployment

The frontend builds to static files (`frontend/dist/`) and is served by the FastAPI backend using `StaticFiles`. Mount `/assets` for static files, then a catch-all `/{path:path}` route that serves `index.html` for React Router SPA routing. The Dockerfile includes the frontend build stage.

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

- **uv** is pre-installed and on PATH. Do NOT prefix commands with `source $HOME/.local/bin/env &&` — just call `uv` directly.
- **Python 3.13** is available via uv — do not attempt to install Python separately.
- **Docker and Docker Compose** are available for running PostgreSQL. Always run `docker compose down --remove-orphans` before `docker compose up -d --wait` to clean up stale containers from previous runs.

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
    "sqlalchemy",
    "psycopg2-binary",
    "alembic",
    "pydantic[email]",
    "pydantic-settings",
    "PyJWT",
    "bcrypt",
    "slowapi",
    "uvicorn",
]

[dependency-groups]
dev = [
    "pytest",
    "httpx",
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
```

This file is verbatim — copy it exactly. Do NOT modify lint rules, line-length, mypy flags, or pytest options.
