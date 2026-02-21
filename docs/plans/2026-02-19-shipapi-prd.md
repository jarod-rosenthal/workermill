# ShipAPI PRD — Full Build Specification

> **"ShipAPI — Built by WorkerMill"**
>
> Production-grade inventory management REST API with JWT auth, rate limiting, full-text search, audit logging, and auto-generated OpenAPI docs. Deployed to Railway (compute) + Neon (database). Built entirely by autonomous AI workers.

## Source of Truth

- **Spec**: This document
- **Target repo**: `workermill-examples/shipapi` (GitHub, public)
- **Live URL**: https://shipapi.workermill.com
- **Compute**: Railway (Hobby plan, Docker container)
- **Database**: Neon PostgreSQL (free tier, serverless)
- **CI/CD**: GitHub Actions → Railway CLI deploy

---

## ⛔ Global Worker Constraints — EVERY Card MUST Follow These

**These rules apply to EVERY card in this PRD. Workers MUST follow them on every commit, no exceptions.**

### Pre-Commit Quality Gate (MANDATORY)

Before EVERY `git commit`, workers MUST run the following commands **in this exact order** and fix ALL errors before committing:

```bash
# Step 1: Auto-fix formatting
uv run ruff format .

# Step 2: Auto-fix lint errors where possible
uv run ruff check . --fix

# Step 3: Verify zero lint errors remain
uv run ruff check .

# Step 4: Verify formatting is clean
uv run ruff format --check .

# Step 5: Type check (if src/ files were modified)
uv run mypy src --strict
```

**If ANY of steps 3-5 produce errors, DO NOT commit.** Fix the errors and re-run from step 1.

**Why this matters:** CI enforces `ruff check .` and `ruff format --check .`. If a worker commits code that violates these checks, CI will fail, the deploy workflow will not run, and the live demo will go down or stay stale. **A broken CI pipeline means a broken showcase.**

### Import Ordering (Critical — Ruff Rule I001)

The `pyproject.toml` enables Ruff rule `I` (isort-compatible import sorting). This means:

- Standard library imports come first (`import os`, `from datetime import datetime`)
- Third-party imports come second (`import pytest`, `from fastapi import FastAPI`)
- Local imports come third (`from src.config import settings`)
- Each group is separated by a blank line
- Within each group, imports are sorted alphabetically

`ruff format .` does NOT fix import ordering — only `ruff check . --fix` fixes it. **Always run both.**

### Post-Push Verification (MANDATORY)

After every `git push`, workers MUST:

1. Check GitHub Actions CI status (wait for it to complete)
2. If CI fails: read the failure log, fix the issue, run the pre-commit quality gate again, push the fix
3. Do NOT move on to the next task until CI is green

### Test File Quality Gate

When creating or modifying test files (`tests/*.py`), the same pre-commit quality gate applies. Test files are linted and format-checked by CI just like source files.

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | FastAPI | Automatic OpenAPI generation, async support, Pydantic validation |
| ORM | SQLAlchemy 2.0 (async) | Mature, flexible, async support |
| Async Driver | asyncpg | High-performance async PostgreSQL driver |
| Migrations | Alembic | Standard SQLAlchemy migration tool |
| Database | PostgreSQL 16 (Neon) | Serverless, full-text search, JSON support |
| Validation | Pydantic V2 | Fast validation, OpenAPI schema generation |
| Settings | pydantic-settings | Type-safe env var loading |
| Auth | python-jose (JWT) + bcrypt (direct) | JWT tokens + bcrypt password hashing (do NOT use passlib — incompatible with bcrypt 4+) |
| Rate Limiting | slowapi | FastAPI-native rate limiting |
| Testing | pytest + pytest-asyncio + httpx | Async test client for FastAPI |
| Linting | Ruff | Fast Python linter + formatter |
| Type Checking | mypy (strict) | Static type verification |
| Package Manager | uv | Fast Python dependency management |
| Container | Docker (multi-stage) | Slim production image |
| Compute | Railway | Docker container hosting with auto-HTTPS |
| CI/CD | GitHub Actions | Automated test + deploy pipeline |

---

## Pre-Provisioned Resources

These resources are set up **before any worker starts**. Workers do NOT create accounts or sign up for services — they use what is already provisioned.

### GitHub Repository

| Resource | Details |
|----------|---------|
| Repository | `workermill-examples/shipapi` (public, empty) |
| Status | **Pre-created by human** |
| Agent access | Push via GitHub PAT (already configured in WorkerMill org settings) |

### Railway (Compute)

| Resource | Details |
|----------|---------|
| Plan | Hobby ($5/month, includes $5 usage credit) |
| Project | `astonishing-reflection` (ID: `d3e4fc24-8307-46c7-a4cc-750e83d886b3`) |
| Service | `shipapi` (ID: `6b4eae14-7cb0-43f6-b269-b31697da23bc`) |
| Environment | `production` (ID: `a008981e-5f0a-4237-890b-63e24cdf5c69`) |
| Custom domain | `shipapi.workermill.com` → `sdzhxz4l.up.railway.app` |
| Status | **All provisioned and ready** |

**GitHub repo secrets (already set):**

| Secret | Value | Purpose |
|--------|-------|---------|
| `RAILWAY_TOKEN` | *(set)* | Project token for `railway up` deploys |
| `RAILWAY_SVC_ID` | `6b4eae14-7cb0-43f6-b269-b31697da23bc` | Service ID for `--service` flag |

**Railway environment variables (already set on the service):**

| Variable | Value | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | Neon pooled connection string (asyncpg, sslmode=require) | App database connection |
| `DATABASE_URL_DIRECT` | Neon direct connection string (asyncpg, sslmode=require) | Alembic migrations |
| `JWT_SECRET_KEY` | 64-char random hex string | JWT token signing |
| `PORT` | `8000` | Railway injects PORT; set explicitly for consistency |

> **CRITICAL**: Railway dynamically assigns a PORT. The app MUST read `PORT` from the environment and bind to it. The Dockerfile CMD uses `$PORT`. Railway also requires the app to bind to `0.0.0.0`, not `127.0.0.1`.

### Neon (Database)

| Resource | Details |
|----------|---------|
| Plan | Free tier (0.5 GB storage, 100 CU-hours/month) |
| Endpoint | `ep-damp-shape-aiwgevtj` |
| Region | `us-east-1` |
| Database | `neondb` |
| User | `neondb_owner` |
| Status | **Provisioned and ready** |

**Connection strings are already set as Railway environment variables.** Agents do NOT need to know the password — they read `DATABASE_URL` and `DATABASE_URL_DIRECT` from `os.environ` at runtime.

**Connection string formats (for reference — actual values are in Railway env vars):**

```
# DATABASE_URL — Pooled connection (app runtime, uses PgBouncer):
postgresql+asyncpg://neondb_owner:***@ep-damp-shape-aiwgevtj-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require

# DATABASE_URL_DIRECT — Direct connection (Alembic migrations, persistent):
postgresql+asyncpg://neondb_owner:***@ep-damp-shape-aiwgevtj.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require
```

Note: The pooled connection has `-pooler` in the hostname. The direct connection does not. The database name is `neondb` (Neon default), not `shipapi`.

> **CRITICAL**: Neon requires `sslmode=require` on all connections. Connections without SSL will be rejected. The `+asyncpg` dialect prefix is required for SQLAlchemy async engine.

### DNS (Custom Domain)

| Record | Type | Value | Status |
|--------|------|-------|--------|
| `shipapi.workermill.com` | CNAME | `sdzhxz4l.up.railway.app` | **Created in Route53, propagating** |

Railway automatically provisions a Let's Encrypt SSL certificate after the CNAME propagates (~minutes). No ACM certificate needed.

### GitHub Repository Secrets

Already configured in `workermill-examples/shipapi` repo settings:

| Secret | Status | Purpose |
|--------|--------|---------|
| `RAILWAY_TOKEN` | **Set** | Railway project token for CLI deploys |
| `RAILWAY_SVC_ID` | **Set** (`6b4eae14-7cb0-43f6-b269-b31697da23bc`) | Service ID for `--service` flag |

> **NOTE**: `DATABASE_URL` and `JWT_SECRET_KEY` are NOT in GitHub secrets — they live in Railway's environment variables and are injected at container runtime. Only Railway deployment credentials go in GitHub secrets.

---

## Project Structure

```
shipapi/
├── src/
│   ├── __init__.py
│   ├── main.py                    # FastAPI app, CORS, lifespan, exception handlers
│   ├── config.py                  # Settings from env vars (pydantic-settings)
│   ├── database.py                # SQLAlchemy async engine + session factory
│   ├── dependencies.py            # FastAPI dependency injection (get_db, get_current_user)
│   ├── models/
│   │   ├── __init__.py
│   │   ├── base.py                # SQLAlchemy DeclarativeBase + common mixins
│   │   ├── user.py
│   │   ├── category.py
│   │   ├── product.py
│   │   ├── warehouse.py
│   │   ├── stock_level.py
│   │   ├── stock_transfer.py
│   │   └── audit_log.py
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── auth.py                # Login, register, token response
│   │   ├── category.py
│   │   ├── product.py
│   │   ├── warehouse.py
│   │   ├── stock.py
│   │   ├── audit.py
│   │   ├── common.py              # PaginatedResponse, ErrorResponse
│   │   └── health.py
│   ├── api/
│   │   ├── __init__.py
│   │   ├── router.py              # Main API router, mounts all sub-routers
│   │   ├── auth.py                # POST register, login, refresh; GET me
│   │   ├── categories.py          # CRUD
│   │   ├── products.py            # CRUD + search
│   │   ├── warehouses.py          # CRUD + stock
│   │   ├── stock.py               # Update, transfer, alerts
│   │   ├── audit.py               # GET audit log
│   │   └── health.py              # GET health check
│   ├── services/
│   │   ├── __init__.py
│   │   ├── auth.py                # JWT creation, password hashing, API key generation
│   │   ├── audit.py               # Audit log recording
│   │   └── stock.py               # Transfer logic (atomic transaction)
│   └── middleware/
│       ├── __init__.py
│       ├── rate_limit.py          # slowapi rate limiting
│       └── error_handler.py       # Global exception handlers
├── alembic/
│   ├── env.py                     # Async migration runner, uses DATABASE_URL_DIRECT
│   ├── script.mako                # Migration template
│   └── versions/                  # Migration files (auto-generated)
├── alembic.ini                    # Alembic config (sqlalchemy.url read from env)
├── tests/
│   ├── __init__.py
│   ├── conftest.py                # Fixtures: async client, test DB, auth headers
│   ├── test_health.py
│   ├── test_auth.py
│   ├── test_categories.py
│   ├── test_products.py
│   ├── test_warehouses.py
│   ├── test_stock.py
│   ├── test_audit.py
│   ├── test_rate_limit.py
│   └── test_errors.py
├── seed/
│   └── seed.py                    # Demo data seed script (idempotent)
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Lint, typecheck, test on push/PR
│       └── deploy.yml             # Build and deploy to Railway on merge to main
├── Dockerfile                     # Multi-stage (builder + slim runtime)
├── docker-compose.yml             # Local dev (PostgreSQL only)
├── railway.toml                   # Railway deployment config
├── pyproject.toml                 # Project config (uv, ruff, mypy, pytest)
├── uv.lock                        # Locked dependencies
├── .python-version                # 3.13
├── .env.example                   # All required env vars documented
├── .gitignore
├── .dockerignore
├── CLAUDE.md                      # Worker instructions for this repo
└── README.md                      # Setup, architecture, API docs
```

---

## Configuration Files

### pyproject.toml

```toml
[project]
name = "shipapi"
version = "1.0.0"
description = "Production inventory management API — Built by WorkerMill"
requires-python = ">=3.13"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.34",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.30",
    "alembic>=1.14",
    "pydantic>=2.10",
    "pydantic-settings>=2.7",
    "python-jose[cryptography]>=3.3",
    "bcrypt>=4.0",
    "slowapi>=0.1",
    "python-multipart>=0.0.18",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.25",
    "httpx>=0.28",
    "ruff>=0.9",
    "mypy>=1.14",
    "coverage>=7.6",
]

[tool.ruff]
target-version = "py313"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W", "UP", "B", "SIM", "RUF"]

[tool.mypy]
python_version = "3.13"
strict = true
plugins = ["pydantic.mypy"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
asyncio_default_test_loop_scope = "session"
testpaths = ["tests"]

[tool.coverage.run]
source = ["src"]

[tool.coverage.report]
fail_under = 80
```

### Dockerfile

```dockerfile
# Stage 1: Build
FROM python:3.13-slim AS builder
WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy application code
COPY src/ src/
COPY alembic/ alembic/
COPY alembic.ini .
COPY seed/ seed/

# Stage 2: Runtime
FROM python:3.13-slim
WORKDIR /app

# Copy virtual environment and application from builder
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src src/
COPY --from=builder /app/alembic alembic/
COPY --from=builder /app/alembic.ini .
COPY --from=builder /app/seed seed/

# Use the virtual environment
ENV PATH="/app/.venv/bin:$PATH"

# Non-root user
RUN addgroup --gid 1001 appgroup && adduser --disabled-password --uid 1001 --ingroup appgroup appuser
USER appuser

EXPOSE 8000

# Railway sets PORT dynamically — read it at runtime
CMD ["sh", "-c", "uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

> **CRITICAL**: The CMD uses `sh -c` to expand the `$PORT` variable at runtime. Railway injects `PORT` as an environment variable. The `${PORT:-8000}` fallback ensures local Docker runs default to 8000.

### .dockerignore

```dockerignore
.git
.github
.venv
__pycache__
*.pyc
.env
.env.*
!.env.example
tests/
*.md
.ruff_cache
.mypy_cache
.pytest_cache
docker-compose.yml
```

### docker-compose.yml (local development only)

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: shipapi
      POSTGRES_PASSWORD: localdev
      POSTGRES_DB: shipapi
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shipapi"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

> **NOTE**: `docker-compose.yml` is for local development only. It runs PostgreSQL locally so developers can work without a Neon connection. The API itself runs via `uv run uvicorn` locally, NOT inside Docker.

### railway.toml

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/api/v1/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

### .env.example

```bash
# Database — Neon PostgreSQL
# Pooled connection (app runtime, uses PgBouncer):
DATABASE_URL=postgresql+asyncpg://neondb_owner:YOUR_PASSWORD@ep-damp-shape-aiwgevtj-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require
# Direct connection (Alembic migrations, persistent connection):
DATABASE_URL_DIRECT=postgresql+asyncpg://neondb_owner:YOUR_PASSWORD@ep-damp-shape-aiwgevtj.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require

# Auth
JWT_SECRET_KEY=change-me-to-a-random-64-character-string

# App
PORT=8000
```

### .gitignore

```gitignore
# Python
__pycache__/
*.py[cod]
*$py.class
*.egg-info/
dist/
build/
.venv/

# Environment / secrets
.env
.env.*
!.env.example

# IDE
.idea/
.vscode/
*.swp
*.swo

# Testing
.pytest_cache/
.coverage
htmlcov/

# Linting
.ruff_cache/
.mypy_cache/

# OS
.DS_Store
Thumbs.db
```

---

## Application Configuration

### src/config.py

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Database
    database_url: str  # Pooled Neon connection (app runtime)
    database_url_direct: str = ""  # Direct Neon connection (migrations)

    # Auth
    jwt_secret_key: str
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7

    # App
    app_name: str = "ShipAPI"
    app_version: str = "1.0.0"
    debug: bool = False

    model_config = {"env_file": ".env", "case_sensitive": False}

settings = Settings()
```

### src/database.py

```python
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from src.config import settings

# Use pooled connection for app runtime
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,  # Verify connection health (handles Neon scale-to-zero)
    pool_size=5,
    max_overflow=10,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
```

> **CRITICAL**: `pool_pre_ping=True` is required for Neon. Neon scales compute to zero after inactivity. Without `pool_pre_ping`, stale connections cause `ConnectionRefusedError`. This setting tests each connection before use.

### src/main.py (lifespan pattern)

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: verify database connection
    yield
    # Shutdown: dispose engine
    await engine.dispose()

app = FastAPI(
    title="ShipAPI",
    description="Production inventory management API — Built by WorkerMill",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=[...],  # See OpenAPI section
)
```

---

## Database Schema

### 7 Tables

All tables use UUID primary keys and include `created_at` / `updated_at` timestamps.

#### users

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default uuid4 |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| name | VARCHAR(100) | NOT NULL |
| password_hash | VARCHAR(255) | NOT NULL |
| role | VARCHAR(20) | NOT NULL, default "user" (values: "user", "admin") |
| api_key_hash | VARCHAR(255) | UNIQUE, nullable |
| api_key_prefix | VARCHAR(10) | nullable (stores "sk_xxxxx" prefix for identification) |
| is_active | BOOLEAN | NOT NULL, default true |
| created_at | TIMESTAMPTZ | NOT NULL, default now() |
| updated_at | TIMESTAMPTZ | NOT NULL, default now(), on update now() |

#### categories

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default uuid4 |
| name | VARCHAR(100) | NOT NULL |
| description | TEXT | nullable |
| parent_id | UUID | FK → categories.id, nullable (self-referential for tree) |
| created_at | TIMESTAMPTZ | NOT NULL, default now() |
| updated_at | TIMESTAMPTZ | NOT NULL, default now() |

#### products

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default uuid4 |
| name | VARCHAR(200) | NOT NULL |
| sku | VARCHAR(50) | UNIQUE, NOT NULL |
| description | TEXT | nullable |
| price | NUMERIC(10,2) | NOT NULL, CHECK (price >= 0) |
| weight_kg | NUMERIC(8,3) | nullable |
| category_id | UUID | FK → categories.id, NOT NULL |
| is_active | BOOLEAN | NOT NULL, default true |
| search_vector | TSVECTOR | Computed: `to_tsvector('english', name || ' ' || coalesce(description, ''))` |
| created_at | TIMESTAMPTZ | NOT NULL, default now() |
| updated_at | TIMESTAMPTZ | NOT NULL, default now() |

**Index**: GIN index on `search_vector` for full-text search performance.

#### warehouses

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default uuid4 |
| name | VARCHAR(100) | NOT NULL |
| location | VARCHAR(200) | NOT NULL |
| capacity | INTEGER | NOT NULL, CHECK (capacity > 0) |
| is_active | BOOLEAN | NOT NULL, default true |
| created_at | TIMESTAMPTZ | NOT NULL, default now() |
| updated_at | TIMESTAMPTZ | NOT NULL, default now() |

#### stock_levels

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default uuid4 |
| product_id | UUID | FK → products.id, NOT NULL |
| warehouse_id | UUID | FK → warehouses.id, NOT NULL |
| quantity | INTEGER | NOT NULL, default 0, CHECK (quantity >= 0) |
| min_threshold | INTEGER | NOT NULL, default 10, CHECK (min_threshold >= 0) |
| updated_at | TIMESTAMPTZ | NOT NULL, default now() |

**Constraint**: UNIQUE(product_id, warehouse_id) — one stock level per product per warehouse.

#### stock_transfers

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default uuid4 |
| product_id | UUID | FK → products.id, NOT NULL |
| from_warehouse_id | UUID | FK → warehouses.id, NOT NULL |
| to_warehouse_id | UUID | FK → warehouses.id, NOT NULL |
| quantity | INTEGER | NOT NULL, CHECK (quantity > 0) |
| initiated_by | UUID | FK → users.id, NOT NULL |
| notes | TEXT | nullable |
| created_at | TIMESTAMPTZ | NOT NULL, default now() |

**Constraint**: CHECK(from_warehouse_id != to_warehouse_id) — cannot transfer to same warehouse.

#### audit_logs

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default uuid4 |
| user_id | UUID | FK → users.id, NOT NULL |
| action | VARCHAR(20) | NOT NULL (values: "create", "update", "delete", "transfer") |
| resource_type | VARCHAR(50) | NOT NULL (values: "product", "category", "warehouse", "stock_level") |
| resource_id | UUID | NOT NULL |
| changes | JSONB | nullable (for updates: `{"field": {"old": x, "new": y}}`) |
| ip_address | VARCHAR(45) | nullable |
| created_at | TIMESTAMPTZ | NOT NULL, default now() |

**Index**: Index on `(resource_type, created_at)` for filtered queries.

### Alembic Configuration

**alembic.ini** — set `sqlalchemy.url` to empty string; it's loaded from env at runtime:
```ini
[alembic]
script_location = alembic
sqlalchemy.url =
```

**alembic/env.py** — async migration runner:
```python
# Key points:
# - Import ALL models from src.models so autogenerate detects them
# - Read DATABASE_URL_DIRECT from env (NOT the pooled connection)
# - Use async engine with asyncpg
# - Pooled connections (PgBouncer) don't support DDL — use direct connection for migrations
```

The migration env.py MUST use `DATABASE_URL_DIRECT` (the non-pooled connection) because PgBouncer in transaction mode does not support DDL statements like `CREATE TABLE`.

### Running Migrations

**Locally:**
```bash
DATABASE_URL_DIRECT=postgresql+asyncpg://shipapi:localdev@localhost:5432/shipapi \
  uv run alembic upgrade head
```

**On Railway (pre-deploy command in railway.toml):**

Add a pre-deploy command that runs migrations before the app starts:
```toml
[deploy]
preDeployCommand = "alembic upgrade head"
```

> **CRITICAL**: The `preDeployCommand` runs in the same container as the app, with all Railway environment variables available. It uses `DATABASE_URL_DIRECT` to run migrations over the direct (non-pooled) Neon connection. This runs BEFORE the healthcheck, so the database is ready when the app starts.

---

## API Endpoints

All endpoints are prefixed with `/api/v1`.

### Health Check

| Endpoint | Method | Auth | Rate Limit | Description |
|----------|--------|------|------------|-------------|
| `/api/v1/health` | GET | None | None | Service health with DB status |

**Response (200):**
```json
{
  "status": "ok",
  "database": "connected",
  "version": "1.0.0",
  "built_by": "WorkerMill"
}
```

The health check MUST verify database connectivity by executing a simple query (`SELECT 1`). If the database is unreachable, return:
```json
{
  "status": "degraded",
  "database": "disconnected",
  "version": "1.0.0",
  "built_by": "WorkerMill"
}
```
Still return HTTP 200 — Railway's healthcheck only checks status code. A non-200 would cause Railway to consider the deployment failed.

### Authentication

| Endpoint | Method | Auth | Rate Limit | Description |
|----------|--------|------|------------|-------------|
| `POST /api/v1/auth/register` | POST | None | 5/min per IP | Create user account |
| `POST /api/v1/auth/login` | POST | None | 10/min per IP | Get access + refresh tokens |
| `POST /api/v1/auth/refresh` | POST | Refresh token | 30/min per IP | Refresh access token |
| `GET /api/v1/auth/me` | GET | JWT or API Key | 100/min | Current user profile |

**POST /auth/register — Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "name": "Jane Smith"
}
```

**POST /auth/register — Response (201):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "Jane Smith",
  "role": "user",
  "api_key": "sk_abc123def456...",
  "created_at": "2026-02-19T00:00:00Z"
}
```

> **NOTE**: `api_key` is returned ONLY on registration. The raw key is never stored — only its SHA-256 hash. The user must save it immediately.

**POST /auth/login — Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**POST /auth/login — Response (200):**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 1800
}
```

**JWT Implementation Details:**
- Access token: 30-minute expiry, contains `sub` (user_id), `email`, `role`
- Refresh token: 7-day expiry, single-use (rotated on refresh)
- Password hashing: bcrypt directly (`bcrypt.hashpw`/`bcrypt.checkpw`/`bcrypt.gensalt`, do NOT use passlib)
- API key: 64-char random string with `sk_` prefix, stored as SHA-256 hash
- Algorithm: HS256

**Auth dependency (dual auth):**
```python
# FastAPI dependency that extracts user from either:
# 1. Authorization: Bearer <jwt_access_token>
# 2. X-API-Key: sk_...
# Returns User object or raises 401
async def get_current_user(
    authorization: str | None = Header(None),
    x_api_key: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> User: ...
```

### Categories

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/categories` | GET | JWT/API Key | List all categories (flat with parent_id) |
| `POST /api/v1/categories` | POST | Admin only | Create category |
| `GET /api/v1/categories/{id}` | GET | JWT/API Key | Category detail with products |
| `PUT /api/v1/categories/{id}` | PUT | Admin only | Update category |
| `DELETE /api/v1/categories/{id}` | DELETE | Admin only | Delete category |

- List returns flat array with `parent_id` field (client assembles tree)
- Delete returns 400 if category has products (cascade protection)
- Category detail includes paginated products list
- All write operations create audit log entries

### Products

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/products` | GET | JWT/API Key | List (paginated, filterable, searchable) |
| `POST /api/v1/products` | POST | JWT/API Key | Create product |
| `GET /api/v1/products/{id}` | GET | JWT/API Key | Product detail with stock levels |
| `PUT /api/v1/products/{id}` | PUT | JWT/API Key | Update product |
| `DELETE /api/v1/products/{id}` | DELETE | Admin only | Soft-delete (is_active = false) |

**GET /products query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `per_page` | int | 20 | Items per page (max 100) |
| `sort_by` | string | "created_at" | Sort field: name, price, created_at, sku |
| `sort_order` | string | "desc" | Sort direction: asc, desc |
| `search` | string | null | Full-text search on name + description |
| `category_id` | UUID | null | Filter by category |
| `min_price` | float | null | Minimum price filter |
| `max_price` | float | null | Maximum price filter |
| `is_active` | bool | null | Active/inactive filter |

**Paginated response format (used by all list endpoints):**
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 50,
    "total_pages": 3
  }
}
```

**Full-text search implementation:**
```sql
-- PostgreSQL computed column on products table:
-- search_vector = to_tsvector('english', name || ' ' || coalesce(description, ''))
-- GIN index on search_vector
-- Query: WHERE search_vector @@ plainto_tsquery('english', :search_term)
-- Results ordered by ts_rank(search_vector, query) DESC when search is active
```

Filters can be combined: `?category_id=X&min_price=10&search=widget&sort_by=price&sort_order=asc`

Product detail includes current stock levels per warehouse.

Soft delete sets `is_active = false` — product still exists for FK references.

### Warehouses

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/warehouses` | GET | JWT/API Key | List warehouses |
| `POST /api/v1/warehouses` | POST | Admin only | Create warehouse |
| `GET /api/v1/warehouses/{id}` | GET | JWT/API Key | Warehouse detail with stock summary |
| `PUT /api/v1/warehouses/{id}` | PUT | JWT/API Key | Update warehouse |
| `GET /api/v1/warehouses/{id}/stock` | GET | JWT/API Key | Paginated stock levels |

Warehouse detail includes summary: total products stocked, total quantity, capacity utilization percentage.

### Stock Management

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `PUT /api/v1/stock/{product_id}/{warehouse_id}` | PUT | JWT/API Key | Update stock level |
| `POST /api/v1/stock/transfer` | POST | JWT/API Key | Transfer between warehouses |
| `GET /api/v1/stock/alerts` | GET | JWT/API Key | Products below min threshold |

**POST /stock/transfer — Request:**
```json
{
  "product_id": "uuid",
  "from_warehouse_id": "uuid",
  "to_warehouse_id": "uuid",
  "quantity": 50,
  "notes": "Rebalancing East Coast inventory"
}
```

**Transfer atomicity requirements:**
1. Verify source has sufficient quantity
2. Decrement source stock level
3. Increment destination stock level (create stock_level record if doesn't exist)
4. Record StockTransfer entry with `initiated_by` = current user
5. ALL steps in a single database transaction
6. Return 400 `INSUFFICIENT_STOCK` if source quantity < transfer quantity
7. Return 400 if from_warehouse_id == to_warehouse_id

**GET /stock/alerts — Response:**
Returns products where any `stock_level.quantity < stock_level.min_threshold`. Response includes product info, warehouse info, current quantity, min threshold. Paginated. Sortable by severity (how far below threshold).

### Audit Log

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/audit-log` | GET | Admin only | Query audit logs |

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `page`, `per_page` | int | Pagination |
| `start_date` | ISO 8601 | Filter: created_at >= start_date |
| `end_date` | ISO 8601 | Filter: created_at <= end_date |
| `action` | string | Filter by action (create, update, delete, transfer) |
| `resource_type` | string | Filter by resource (product, category, warehouse, stock_level) |
| `user_id` | UUID | Filter by user |

**Audit recording service:**
Called from every write endpoint. Records:
- `user_id`: who performed the action
- `action`: create | update | delete | transfer
- `resource_type`: product | category | warehouse | stock_level
- `resource_id`: UUID of affected resource
- `changes`: JSON diff `{"field": {"old": x, "new": y}}` for updates
- `ip_address`: from request (`request.client.host`)
- `created_at`: timestamp

---

## Rate Limiting

Configure `slowapi` with per-key limits:

| Endpoint Group | Limit | Key Function |
|---------------|-------|-------------|
| `POST /auth/register` | 5/min | IP address |
| `POST /auth/login` | 10/min | IP address |
| `POST /auth/refresh` | 30/min | IP address |
| All other authenticated endpoints | 100/min | API key or user_id from JWT |

**Response headers on EVERY response:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1708300800
```

**When rate limit exceeded — Response (429):**
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Try again in 45 seconds.",
    "details": []
  }
}
```
Include `Retry-After: 45` header.

> **NOTE**: slowapi uses in-memory storage by default. This is acceptable for a single-instance showcase. Rate limit state resets on container restart.

---

## Error Handling

All error responses MUST follow this standard format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": []
  }
}
```

**Error codes and HTTP status mapping:**

| Code | HTTP Status | When |
|------|-------------|------|
| `VALIDATION_ERROR` | 422 | Pydantic validation failure |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `ALREADY_EXISTS` | 409 | Duplicate unique field (email, SKU) |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `FORBIDDEN` | 403 | Insufficient permissions (non-admin) |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INSUFFICIENT_STOCK` | 400 | Transfer with insufficient quantity |
| `INVALID_OPERATION` | 400 | Invalid operation (e.g., delete category with products) |
| `INTERNAL_ERROR` | 500 | Unhandled exception |

**Global exception handlers to register:**
- `RequestValidationError` → 422 with field-level details
- `HTTPException` → standard format with code mapping
- `IntegrityError` (SQLAlchemy) → 409 `ALREADY_EXISTS`
- `Exception` → 500 `INTERNAL_ERROR` (log full traceback, return generic message — NO stack trace in response)

**Pydantic validation error detail format:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {"field": "price", "message": "Input should be greater than or equal to 0"},
      {"field": "email", "message": "value is not a valid email address"}
    ]
  }
}
```

---

## OpenAPI Documentation

FastAPI auto-generates OpenAPI 3.1. Enhance for showcase quality:

**Swagger UI**: `GET /docs`
**ReDoc**: `GET /redoc`

**FastAPI app configuration:**
```python
app = FastAPI(
    title="ShipAPI",
    description="Production inventory management API — Built by WorkerMill",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=[
        {"name": "Health", "description": "Service health check"},
        {"name": "Auth", "description": "Authentication, registration, and API key management"},
        {"name": "Categories", "description": "Product category management (tree structure)"},
        {"name": "Products", "description": "Product CRUD with full-text search and filtering"},
        {"name": "Warehouses", "description": "Warehouse management and stock overview"},
        {"name": "Stock", "description": "Stock levels, atomic transfers, and low-stock alerts"},
        {"name": "Audit", "description": "Audit log queries (admin only)"},
    ],
)
```

**Requirements:**
- Every endpoint has request body examples and response examples
- Error responses documented on every endpoint (401, 403, 404, 422, 429)
- Security schemes (Bearer JWT + API Key) shown in Swagger UI "Authorize" button
- Can authenticate in Swagger UI and make real API calls against the live deployment
- Tag grouping matches the table above

---

## CORS and Middleware

```python
# CORS: Allow all origins for showcase (API is public)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Request ID middleware**: Generate `X-Request-Id` UUID header on every response.

**Structured access logging**: Log each request as structured JSON:
```json
{"method": "GET", "path": "/api/v1/products", "status": 200, "duration_ms": 12, "request_id": "uuid"}
```

---

## Seed Data

`seed/seed.py` populates the database with demo data. The script MUST be idempotent — running it twice does not create duplicates (use check-before-insert pattern).

### 1 Admin User

| Field | Value |
|-------|-------|
| Email | `demo@workermill.com` |
| Password | `demo1234` |
| Name | `Demo Admin` |
| Role | `admin` |
| API Key | `sk_demo_shipapi_2026_showcase_key` |

### 5 Top-Level Categories (with subcategories)

1. **Electronics** → Smartphones, Laptops, Accessories
2. **Clothing** → Men's, Women's, Kids'
3. **Home & Garden** → Kitchen, Outdoor, Decor
4. **Sports** → Running, Cycling, Swimming
5. **Books** → Fiction, Technical, Business

### 50 Products

Distributed across categories with realistic:
- Names (e.g., "Ultra HD 4K Monitor 32-inch", "Organic Cotton T-Shirt")
- SKUs (e.g., `ELEC-MON-001`, `CLTH-TSH-012`)
- Descriptions (2-3 sentences, meaningful for full-text search testing — include varied vocabulary so searching "monitor", "running shoes", "organic" all return relevant results)
- Prices ($5.99 – $2,499.99)
- Weights (0.1 – 25.0 kg)
- Mix: 45 active (`is_active = true`), 5 inactive (`is_active = false`)

### 3 Warehouses

1. **East Coast Hub** — New York, NY (capacity: 10,000)
2. **West Coast Hub** — Los Angeles, CA (capacity: 8,000)
3. **Central Warehouse** — Chicago, IL (capacity: 12,000)

### 150 Stock Levels

Each product has stock in 1-3 warehouses:
- ~10 products have at least one stock level below `min_threshold` (for alerts testing)
- Quantities range from 0 to 500
- Min thresholds range from 5 to 50

### 20 Stock Transfers

Recent transfer history (past 30 days), all initiated by demo admin user.

### 50 Audit Log Entries

Mix of create/update/delete/transfer operations from the past 30 days.

### Running Seed

**Locally:**
```bash
DATABASE_URL=postgresql+asyncpg://shipapi:localdev@localhost:5432/shipapi \
  uv run python seed/seed.py
```

**On Railway:**
```bash
railway run python seed/seed.py
```

> The seed script uses the same SQLAlchemy async engine as the app. It imports models from `src.models` and creates records using the ORM.

---

## Testing

### Test Configuration

Tests run against a real PostgreSQL database (no mocks for database operations).

**tests/conftest.py fixtures:**

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `test_db` | session | Creates test database, runs migrations, drops after |
| `async_client` | function | `httpx.AsyncClient` against test FastAPI app |
| `auth_headers` | function | JWT headers for a regular user |
| `admin_headers` | function | JWT headers for an admin user |
| `seeded_db` | session | Database populated with seed data |

**In CI (GitHub Actions):** Tests run against a PostgreSQL 16 service container. Connection string: `postgresql+asyncpg://test:test@localhost:5432/shipapi_test`

**Locally:** Tests run against the `docker-compose.yml` PostgreSQL instance.

### Test Files and Coverage

| File | What it tests |
|------|--------------|
| `test_health.py` | Health check returns DB status |
| `test_auth.py` | Register, login, refresh, me, API key auth, duplicate email (409) |
| `test_categories.py` | CRUD, admin restriction, cascade protection (can't delete with products) |
| `test_products.py` | CRUD, search, filtering, pagination, sorting, combined filters |
| `test_warehouses.py` | CRUD, stock summary, admin restriction on create |
| `test_stock.py` | Update, transfer (atomic), insufficient stock (400), same-warehouse (400), alerts |
| `test_audit.py` | Query with filters, admin-only (403 for non-admin) |
| `test_rate_limit.py` | Rate limit enforcement, 429 response, Retry-After header |
| `test_errors.py` | Error format consistency across all error types |

### Key Test Scenarios

1. **Auth lifecycle**: Register → login → access protected endpoint → refresh → access again
2. **Product search**: Seed products → search "monitor" → verify results contain monitor products
3. **Stock transfer atomicity**: Transfer → verify source decremented AND destination incremented → verify transfer record
4. **Insufficient stock**: Attempt transfer exceeding available → verify 400 → verify no partial update
5. **Audit trail**: Create product → update product → verify 2 audit entries with correct changes diff
6. **Pagination**: Seed 50 products → request page 1 (20 items) → verify `total=50`, `total_pages=3`
7. **Combined filters**: `?category_id=X&min_price=10&max_price=100&sort_by=price&sort_order=asc`
8. **Rate limiting**: Send requests exceeding limit → verify 429 on excess request
9. **Error format**: Verify all error responses match `{"error": {"code": ..., "message": ..., "details": ...}}`
10. **Dual auth**: Same endpoint works with both JWT Bearer token and X-API-Key header

### Running Tests

```bash
# All tests
uv run pytest tests/ -v --cov=src --cov-report=term-missing

# Single file
uv run pytest tests/test_auth.py -v

# With coverage threshold enforcement
uv run pytest tests/ --cov=src --cov-fail-under=80
```

---

## CI/CD Pipelines

### CI Pipeline — `.github/workflows/ci.yml`

Runs on every push and PR. Must pass before merge.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  quality:
    name: Lint, Type Check & Test
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: shipapi_test
        ports:
          - "5432:5432"
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: astral-sh/setup-uv@v5
        with:
          version: "latest"

      - name: Install dependencies
        run: uv sync --frozen

      - name: Lint
        run: uv run ruff check .

      - name: Format check
        run: uv run ruff format --check .

      - name: Type check
        run: uv run mypy src --strict

      - name: Run tests
        run: uv run pytest tests/ -v --cov=src --cov-report=term-missing --cov-fail-under=80
        env:
          DATABASE_URL: postgresql+asyncpg://test:test@localhost:5432/shipapi_test
          DATABASE_URL_DIRECT: postgresql+asyncpg://test:test@localhost:5432/shipapi_test
          JWT_SECRET_KEY: test-secret-key-for-ci-only
```

### Deploy Pipeline — `.github/workflows/deploy.yml`

**CRITICAL: Deploy MUST only run after CI passes.** Uses `workflow_run` trigger to wait for the CI workflow to complete successfully. This prevents deploying broken code that would take the demo offline.

```yaml
name: Deploy

on:
  workflow_run:
    workflows: ["CI"]
    branches: [main]
    types: [completed]

jobs:
  deploy:
    runs-on: ubuntu-latest
    # CRITICAL: Only deploy if CI workflow succeeded
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    container: ghcr.io/railwayapp/cli:latest

    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Railway
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up --service shipapi --detach
```

> **CRITICAL**: The `workflow_run` trigger with `if: conclusion == 'success'` ensures deploys NEVER happen when CI fails. If CI has ANY failure (lint, format, type check, tests), the deploy job is skipped and the demo stays on the last working version. **This is the deploy's only protection — there are no branch protection rules configured.** If CI is broken, the demo cannot be updated until CI is fixed.

> **NOTE**: Railway's `preDeployCommand` in `railway.toml` handles Alembic migrations automatically before the app starts. No separate migration step needed in the deploy workflow.

---

## Quality Gates

| Gate | Threshold | Command |
|------|-----------|---------|
| Lint | 0 errors | `uv run ruff check .` |
| Format | Fully formatted | `uv run ruff format --check .` |
| Types | 0 errors (strict mode) | `uv run mypy src --strict` |
| Tests | 100% pass, >80% coverage | `uv run pytest --cov=src --cov-fail-under=80` |
| Build | Successful Docker build | `docker build .` |
| Health | Returns 200 | `curl -f https://shipapi.workermill.com/api/v1/health` |
| Docs | Swagger + ReDoc accessible | `curl -f https://shipapi.workermill.com/docs` |

---

## Known Issues from Build Logs (Post-Mortem)

> **This section documents actual problems encountered during the initial build. Workers executing follow-up cards MUST check for and fix these issues.**

### Issue 1: mypy Errors in `src/database.py` — BLOCKING CI

**Status: UNRESOLVED — currently breaking CI**

After PR #9 merged (CI/CD Pipelines, last successful deploy at 2026-02-20T00:37Z), a subsequent commit introduced 2 mypy errors in `src/database.py`:

```
src/database.py:10: error: Missing type parameters for generic type "dict"  [type-arg]
src/database.py:20: error: Missing type parameters for generic type "dict"  [type-arg]
Found 2 errors in 1 file (checked 43 source files)
```

These are `dict` type annotations missing type parameters (e.g., `dict` should be `dict[str, Any]`). Since CI runs `mypy src --strict`, these cause the entire CI pipeline to fail, which blocks all deployments.

**Fix:** Change bare `dict` to `dict[str, Any]` (or the appropriate type parameters) in `src/database.py` lines 10 and 20.

### Issue 2: Unsorted Imports in `tests/test_showcase.py` — BLOCKING CI

**Status: UNRESOLVED — currently breaking CI**

PR #11 (Interactive Demo Experience) introduced `tests/test_showcase.py` with an import sorting violation:

```
tests/test_showcase.py:13: I001 [*] Import block is un-sorted or un-formatted
  11 |   """
  12 |
  13 | / import pytest
  14 | | from httpx import AsyncClient
```

The QA engineer who wrote the test file ran ruff only on `src/` files, NOT on `tests/`. CI checks ALL files with `ruff check .`.

**Fix:** Run `uv run ruff check --fix tests/test_showcase.py` to auto-sort the imports.

### Issue 3: passlib/bcrypt 5.x Incompatibility

**Status: RESOLVED in PR #3 — documented for prevention**

`passlib 1.7.4` is incompatible with `bcrypt >= 4.1.0`. The `detect_wrap_bug` test in passlib sends passwords > 72 bytes, which bcrypt 4+ rejects with `ValueError`. This was the single most time-consuming issue across the entire build.

**Resolution:** passlib was replaced entirely with direct `bcrypt` usage (`bcrypt.hashpw`/`checkpw`/`gensalt`).

**PRD Prevention:** The `pyproject.toml` in this PRD specifies `passlib[bcrypt]>=1.7` — this MUST be changed. Use `bcrypt>=4.0` directly instead:

```toml
# WRONG — causes runtime ValueError
"passlib[bcrypt]>=1.7",

# RIGHT — direct bcrypt usage
"bcrypt>=4.0",
```

### Issue 4: Pre-Existing mypy Errors Accumulated Across Tasks

**Status: PARTIALLY RESOLVED**

From PR #2 onwards, mypy errors in model files (SQLAlchemy forward reference strings, missing `jose` type stubs) accumulated. By PR #4, there were 11 pre-existing errors that every worker documented as "not my code" and left unfixed.

Key error sources:
- Model files: Forward reference F821 errors in `warehouse.py`, `stock_transfer.py`, `stock_level.py`, `category.py`, `product.py`, `audit_log.py`
- `src/api/auth.py`: Missing `jose` type stubs (fixed by adding `types-python-jose` to dev deps)
- FastAPI router decorators: "Untyped decorator" warnings

**PRD Prevention:** The CI pipeline MUST enforce `mypy src --strict` with 0 errors from the FIRST card. Each card must fix any mypy errors it introduces before merging.

### Issue 5: `record_audit` vs `record_audit_log` Naming Mismatch

**Status: FRAGILE WORKAROUND IN PLACE**

`src/services/__init__.py` exports `record_audit`, but the actual function in `src/services/audit.py` is named `record_audit_log`. A QA engineer added an alias (`record_audit = record_audit_log`) as a workaround.

**Fix:** Rename the function to `record_audit` consistently, or update all consumers to use `record_audit_log`.

### Issue 6: Warehouse/Stock Routers Not Mounted

**Status: RESOLVED in PR #8**

PR #5 created `src/api/warehouses.py` and `src/api/stock.py` but did NOT mount them in `src/api/router.py`. This was only discovered in PR #8 when tests needed the endpoints. The test suite worker had to add the 4-line router registration.

**PRD Prevention:** Any card that creates a new router file MUST also update `src/api/router.py` to mount it. The card spec should explicitly list `src/api/router.py` as a target file.

### Issue 7: Event Loop Issues in Test Suite (pytest-asyncio)

**Status: RESOLVED**

Tests using `pytest-asyncio` had event loop lifecycle issues. The fix required setting BOTH config options in `pyproject.toml`:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
asyncio_default_test_loop_scope = "session"
```

### Issue 8: Coverage.py Underreports Async Code

**Status: KNOWN LIMITATION**

Without `concurrency = ["asyncio"]` in coverage config, per-file coverage for async service functions is misleadingly low (e.g., `src/services/stock.py` shows 27% when tests clearly execute all paths). The overall 88% exceeds the 80% threshold.

**Optional fix:** Add to `pyproject.toml`:

```toml
[tool.coverage.run]
source = ["src"]
concurrency = ["asyncio"]
```

### Issue 9: Deploy.yml Has No Smoke Test

**Status: GAP**

The actual deployed `deploy.yml` (from PR #9) does NOT include smoke tests. It just runs `railway up --service shipapi --detach` and exits. The PRD specifies smoke tests but the worker didn't implement them.

**Fix:** Add smoke test step after deploy (curl health check + docs endpoints with retry loop).

---

## CLAUDE.md for Target Repo

The agents MUST create a `CLAUDE.md` in the root of `workermill-examples/shipapi` with these conventions:

```markdown
# CLAUDE.md

## Quick Reference

| Task | Command |
|------|---------|
| Install dependencies | `uv sync` |
| Run API locally | `uv run uvicorn src.main:app --reload --port 8000` |
| Start local PostgreSQL | `docker compose up -d db` |
| Run migrations | `uv run alembic upgrade head` |
| Create migration | `uv run alembic revision --autogenerate -m "description"` |
| Run seed | `uv run python seed/seed.py` |
| Run tests | `uv run pytest tests/ -v` |
| Run tests (coverage) | `uv run pytest tests/ --cov=src --cov-report=term-missing` |
| Lint | `uv run ruff check .` |
| Format | `uv run ruff format .` |
| Type check | `uv run mypy src --strict` |

## Local Development

1. `docker compose up -d db` — Start PostgreSQL
2. `cp .env.example .env` — Copy env template, fill in values
3. `uv sync` — Install dependencies
4. `uv run alembic upgrade head` — Run migrations
5. `uv run python seed/seed.py` — Load demo data
6. `uv run uvicorn src.main:app --reload --port 8000` — Start API

## Environment Variables

- `DATABASE_URL` — SQLAlchemy async connection string (pooled for app)
- `DATABASE_URL_DIRECT` — Direct connection string (for Alembic migrations)
- `JWT_SECRET_KEY` — Secret key for JWT signing (min 32 chars)
- `PORT` — Server port (default 8000, Railway sets dynamically)

## Conventions

- All endpoints prefixed with `/api/v1`
- UUID primary keys on all tables
- Pydantic V2 schemas for all request/response models
- Async SQLAlchemy throughout (no sync operations)
- Every write operation creates an audit log entry
- Standard error format: `{"error": {"code": "...", "message": "...", "details": [...]}}`
- Paginated responses: `{"data": [...], "pagination": {"page", "per_page", "total", "total_pages"}}`

## Deployment

- **Platform**: Railway (Docker container)
- **Database**: Neon PostgreSQL (serverless)
- **Deploy**: Push to main → GitHub Actions → `railway up`
- **Migrations**: Run automatically via `preDeployCommand` in `railway.toml`
- **URL**: https://shipapi.workermill.com
```

---

## README.md

The agents MUST create a `README.md` covering:

1. **Title and tagline** — "ShipAPI — Production Inventory Management API"
2. **"Built by WorkerMill" badge** — Link to workermill.com
3. **Live demo links** — Swagger UI, ReDoc, health check URL
4. **Demo credentials** — Email, password, API key for testing
5. **Quick start** — Clone, docker compose up, uv sync, migrate, seed, run
6. **API endpoint summary table** — All endpoints with method, auth, description
7. **Architecture diagram** — Text-based: Railway → FastAPI → Neon PostgreSQL
8. **Tech stack table** — Same as this PRD
9. **Testing** — How to run tests locally
10. **Deployment** — How Railway + Neon deployment works

---

## Acceptance Criteria (Final State)

When all work is complete, the following MUST be true:

### API Functionality
- [ ] `GET /api/v1/health` returns 200 with database status
- [ ] User registration, login, token refresh all work
- [ ] JWT Bearer auth and X-API-Key auth both work on protected endpoints
- [ ] Category CRUD with admin restrictions
- [ ] Product CRUD with pagination, sorting, filtering
- [ ] Full-text search on products returns relevant results ranked by relevance
- [ ] Warehouse CRUD with stock summary
- [ ] Stock update, atomic transfer, and alerts endpoint all work
- [ ] Stock transfer is atomic (all-or-nothing in a single transaction)
- [ ] Insufficient stock transfer returns 400 (no partial update)
- [ ] Every write operation creates an audit log entry with changes diff
- [ ] Audit log query supports date range, action, resource type, user filters
- [ ] Audit log is admin-only (403 for non-admin)

### Production Hardening
- [ ] Rate limiting enforced: 5/min register, 10/min login, 100/min authenticated
- [ ] 429 responses include `Retry-After` header
- [ ] Rate limit headers (`X-RateLimit-*`) on all responses
- [ ] All errors follow standard format: `{"error": {"code", "message", "details"}}`
- [ ] Pydantic validation errors include field-level details
- [ ] CORS configured for public access
- [ ] X-Request-Id on all responses

### Documentation
- [ ] `GET /docs` shows Swagger UI with all endpoints grouped by tag
- [ ] `GET /redoc` shows ReDoc documentation
- [ ] Every endpoint has request/response examples
- [ ] Error responses documented on every endpoint
- [ ] Security schemes shown in Swagger UI "Authorize" button
- [ ] CLAUDE.md documents local dev setup and conventions
- [ ] README.md documents architecture, setup, API summary, demo credentials

### Seed Data
- [ ] Demo user authenticates with `demo@workermill.com` / `demo1234`
- [ ] Demo user's API key works: `X-API-Key: sk_demo_shipapi_2026_showcase_key`
- [ ] 5 categories with subcategories present
- [ ] 50 products across categories
- [ ] 3 warehouses with stock levels
- [ ] `GET /products?search=monitor` returns relevant results
- [ ] `GET /stock/alerts` returns ~10 products below threshold
- [ ] Seed script is idempotent (safe to run multiple times)

### Testing
- [ ] `uv run pytest tests/ -v` — all tests pass
- [ ] `uv run pytest tests/ --cov=src --cov-fail-under=80` — >80% coverage
- [ ] Tests run against real PostgreSQL (not mocked)
- [ ] Stock transfer atomicity verified in tests
- [ ] Search relevance verified in tests
- [ ] Rate limiting verified in tests
- [ ] Error format consistency verified in tests

### Quality
- [ ] `uv run ruff check .` — 0 errors
- [ ] `uv run ruff format --check .` — fully formatted
- [ ] `uv run mypy src --strict` — 0 errors
- [ ] Docker image builds successfully, size < 200MB
- [ ] Container runs as non-root user

### Deployment
- [ ] Railway deployment succeeds via `railway up`
- [ ] `preDeployCommand` runs Alembic migrations before app start
- [ ] Railway healthcheck passes at `/api/v1/health`
- [ ] `https://shipapi.workermill.com/api/v1/health` returns 200
- [ ] CI workflow runs on push/PR (lint, typecheck, test)
- [ ] Deploy workflow triggers on merge to main
- [ ] Smoke tests pass post-deploy (health + docs + auth)

### Cost
- [ ] Railway: ~$5/month (Hobby plan)
- [ ] Neon: $0/month (free tier, 0.5 GB storage sufficient for demo data)
- [ ] Total: ~$5/month

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Workers skip `ruff check` on test files** | CI fails, deploy blocked, demo goes down | Global constraint: always run `ruff check .` and `ruff format .` on ALL files (not just `src/`) before every commit |
| **mypy errors accumulate across multi-card builds** | Later cards inherit unfixed errors; CI fails | Each card MUST leave `mypy src --strict` at 0 errors — fix pre-existing errors if touched |
| **passlib + bcrypt 4+/5.x incompatibility** | `ValueError` at runtime, auth completely broken | Use `bcrypt` directly (`bcrypt.hashpw`/`checkpw`), NEVER use passlib |
| **Cross-story naming mismatches** | `ImportError` or fragile aliases | Workers must read sibling files before defining exports; use exact names from existing code |
| **New routers not mounted in `router.py`** | Endpoints return 404, features silently missing | Any card creating a new router MUST also update `src/api/router.py` |
| **CI broken = deploy blocked indefinitely** | Demo stays on last working version (or goes down) | deploy.yml uses `workflow_run` with `if: conclusion == 'success'` — fix CI ASAP |
| Neon free tier compute limit (100 CU-hours/month) | DB goes to sleep, cold start on first request | `pool_pre_ping=True` handles reconnection; health check returns 200 even if DB disconnected |
| Neon 0.5 GB storage limit | Can't seed if data exceeds limit | 50 products + audit logs is well under 0.5 GB |
| Railway Hobby plan: 2 custom domain limit | Can't add more subdomains | Only need 1 domain for this project |
| slowapi in-memory rate limiting | State lost on container restart | Acceptable for single-instance showcase |
| Railway cold start after inactivity | First request slow (~2-5s) | Health check warms container; Railway keeps containers alive on Hobby plan |
| GitHub Actions CI needs PostgreSQL service | Slower CI (container startup) | PostgreSQL service container starts in ~5s, negligible impact |
| Neon connection pooling (PgBouncer) + DDL | Migrations fail over pooled connection | Use `DATABASE_URL_DIRECT` for Alembic, `DATABASE_URL` (pooled) for app |

---

## Worker Execution Notes

### What Workers CAN Do

| Action | How |
|--------|-----|
| Push code to GitHub repo | GitHub PAT (already configured) |
| Create GitHub Actions workflows | Write `.yml` files, push to repo |
| Deploy to Railway | `railway up` via GitHub Actions with `RAILWAY_TOKEN` |
| Run migrations on Railway | Automatic via `preDeployCommand` in `railway.toml` |
| Run seed on Railway | `railway run python seed/seed.py` (if Railway CLI available) or as a one-time ECS-style run |
| Read CI failure logs | GitHub Actions API |
| Verify deployment | `curl` against live URL |

### What Workers CANNOT Do (Already Done)

All of these have been pre-provisioned. Workers should NOT attempt to create or modify these:

| Action | Status |
|--------|--------|
| Create Railway account/project/service | **Done** — project `astonishing-reflection`, service `shipapi` |
| Create Neon account/database | **Done** — endpoint `ep-damp-shape-aiwgevtj`, database `neondb` |
| Create GitHub repo | **Done** — `workermill-examples/shipapi` |
| Set Railway environment variables | **Done** — `DATABASE_URL`, `DATABASE_URL_DIRECT`, `JWT_SECRET_KEY`, `PORT` |
| Set GitHub repo secrets | **Done** — `RAILWAY_TOKEN`, `RAILWAY_SVC_ID` |
| Add DNS CNAME record | **Done** — `shipapi.workermill.com` → `sdzhxz4l.up.railway.app` |
| Generate JWT secret key | **Done** — 64-char hex, set in Railway |

### Seeding Production Data

The seed script needs to run once against the Neon database after the first deployment. Options:

1. **Via `preDeployCommand`** — Not ideal (runs on every deploy, must be idempotent)
2. **Via Railway CLI** — `railway run python seed/seed.py` (runs one-off command in Railway environment)
3. **Via GitHub Actions** — Add a manual workflow dispatch that runs the seed

Recommended: Make the seed idempotent and run it via a one-time GitHub Actions workflow dispatch, or include it as part of the first deploy's `preDeployCommand` with a guard (e.g., check if admin user exists before seeding).

### CI/CD Iteration Pattern (MANDATORY)

**Before pushing, workers MUST run the full quality gate locally:**

```
BEFORE git push:
  1. uv run ruff format .                    ← Auto-fix formatting
  2. uv run ruff check . --fix               ← Auto-fix lint errors
  3. uv run ruff check .                     ← Verify 0 remaining errors
  4. uv run ruff format --check .            ← Verify formatting is clean
  5. uv run mypy src --strict                ← Verify 0 type errors
  6. uv run pytest tests/ -v                 ← Verify tests pass
  If ANY of steps 3-6 fail, fix and restart from step 1.
  Only push when ALL 6 steps pass.
```

**After pushing:**

```
Worker pushes code to main branch
  → GitHub Actions triggers CI (ci.yml)
  → Worker MUST wait for CI to complete (check via GitHub Actions API)
  → If ANY step fails (lint, typecheck, test):
      Worker reads failure output via GitHub Actions API
      Worker fixes the root cause locally
      Worker runs full quality gate again (steps 1-6 above)
      Worker pushes fix
      CI loop repeats
  → When CI passes:
      Deploy workflow (deploy.yml) auto-triggers via workflow_run
      railway up deploys to Railway
      preDeployCommand runs migrations
  → Worker verifies deployment:
      curl -f https://shipapi.workermill.com/api/v1/health
      curl -f https://shipapi.workermill.com/docs
  → If health check fails: investigate, fix, push again
  → When health check passes: Deployment complete
```

**CRITICAL:** Workers MUST NOT move on to the next task until CI is green and (if this is the final card) the live URL returns 200. A broken CI blocks ALL future deployments.
