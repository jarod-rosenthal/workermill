# ShipAPI PRD — Full Build & Deployment Plan

> **"ShipAPI — Built by WorkerMill"**
>
> Production-grade inventory management REST API with JWT auth, rate limiting, full-text search, audit logging, and auto-generated OpenAPI docs. Deployed to AWS via Terraform. Built entirely by autonomous AI workers.

## Source of Truth

- **Spec**: `docs/SHOWCASE_PROJECTS.md` → "Project 2: ShipAPI"
- **Target repo**: `workermill-examples/shipapi` (GitHub)
- **Live URL**: https://shipapi.workermill.dev
- **Deployment**: AWS ECS Fargate (API) + RDS PostgreSQL (database) + ALB (HTTPS)
- **CI/CD**: GitHub Actions with `ubuntu-latest` runners

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | FastAPI | Automatic OpenAPI generation, async support, Pydantic validation |
| ORM | SQLAlchemy 2.0 (async) | Mature, flexible, async support |
| Migrations | Alembic | Standard SQLAlchemy migration tool |
| Database | PostgreSQL 16 | Full-text search, JSON support, reliability |
| Validation | Pydantic V2 | Fast validation, OpenAPI schema generation |
| Auth | python-jose (JWT) + passlib (bcrypt) | Standard JWT implementation |
| Rate Limiting | slowapi | FastAPI-native rate limiting |
| Testing | pytest + httpx (async) | Async test client for FastAPI |
| Linting | Ruff | Fast Python linter + formatter |
| Type Checking | mypy (strict) | Static type verification |
| Package Manager | uv | Fast Python dependency management |
| Container | Docker (multi-stage) | Slim production image |
| IaC | Terraform | AWS resource provisioning |
| CI/CD | GitHub Actions | Automated test + deploy pipeline |

---

## Ticket Mapping

Each ticket maps to a phase of the build. Tickets are **sequential** — each depends on the previous.

| Ticket | Phase | Title | Personas |
|--------|-------|-------|----------|
| SHIP-1 | Phase 0 | Bootstrap repository, AWS infrastructure, and CI/CD | devops_engineer |
| SHIP-2 | Phase 1 | Build the core API (auth, CRUD, search, audit) | backend_developer |
| SHIP-3 | Phase 2 | Build rate limiting, error handling, and OpenAPI docs | backend_developer |
| SHIP-4 | Phase 3 | Build seed data and integration tests | backend_developer, qa_engineer |
| SHIP-5 | Phase 4 | Deploy to production and validate | devops_engineer |

> **No frontend ticket.** ShipAPI is an API-only showcase. The interactive documentation (Swagger UI + ReDoc) serves as the "frontend".

---

## Pre-Provisioned Resources

These resources are set up **before** any worker ticket starts. Workers do NOT create these — they use them.

### AWS Resources (provisioned via Terraform by human)

| Resource | Status | Details |
|----------|--------|---------|
| AWS Account | ✅ | `AWS_ACCOUNT_ID` (us-east-1) |
| Route53 Hosted Zone | ✅ | `workermill.dev` (existing) |
| ACM Certificate | ✅ | `*.workermill.dev` (existing wildcard) |
| ECR Repository | ⏳ Create during SHIP-1 | `workermill-examples/shipapi` |
| GitHub Actions OIDC | ✅ | Existing IAM OIDC provider for GitHub |
| IAM Deploy Role | ⏳ Create during SHIP-1 | `shipapi-github-deploy` |
| S3 Terraform State | ⏳ Create during SHIP-1 | `shipapi-terraform-state-AWS_ACCOUNT_ID` |

### GitHub Resources

| Resource | Status | Details |
|----------|--------|---------|
| Repository | ⏳ Create during SHIP-1 | `workermill-examples/shipapi` (public) |
| GitHub Secrets | ⏳ Configure during SHIP-1 | `AWS_DEPLOY_ROLE_ARN`, `DATABASE_URL`, `JWT_SECRET_KEY` |

### DNS

| Record | Type | Value |
|--------|------|-------|
| `shipapi.workermill.dev` | A (alias) | → ALB DNS (created by Terraform) |

---

## SHIP-1: Bootstrap Repository, AWS Infrastructure, and CI/CD

**Personas:** devops_engineer
**Estimated stories:** 8
**Dependencies:** None (first ticket)

### What This Ticket Delivers

A fully scaffolded Python/FastAPI project with:
1. Project structure with all dependencies
2. AWS infrastructure provisioned via Terraform (VPC, ECS, RDS, ALB, ECR)
3. Docker multi-stage build working
4. GitHub Actions CI pipeline (lint, typecheck, test)
5. GitHub Actions CD pipeline (build → push → terraform apply → smoke test)
6. Health check endpoint responding locally
7. First deploy to AWS with health check passing at `https://shipapi.workermill.dev`

### Phase 0.1 — Repository Scaffolding

Create the `workermill-examples/shipapi` repository with this structure:

```
shipapi/
├── src/
│   ├── __init__.py
│   ├── main.py                    # FastAPI app, CORS, exception handlers
│   ├── config.py                  # Settings from env vars (pydantic-settings)
│   ├── database.py                # SQLAlchemy async engine + session
│   ├── dependencies.py            # FastAPI dependency injection (get_db, get_current_user)
│   ├── models/
│   │   ├── __init__.py
│   │   ├── base.py                # SQLAlchemy Base + common mixins
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
│   │   ├── router.py              # Main API router
│   │   ├── auth.py                # POST register, login, refresh, GET me
│   │   ├── categories.py          # CRUD
│   │   ├── products.py            # CRUD + search
│   │   ├── warehouses.py          # CRUD + stock
│   │   ├── stock.py               # Update, transfer, alerts
│   │   ├── audit.py               # GET audit log
│   │   └── health.py              # GET health check
│   ├── services/
│   │   ├── __init__.py
│   │   ├── auth.py                # JWT creation, password hashing
│   │   ├── audit.py               # Audit log recording
│   │   └── stock.py               # Transfer logic (atomic)
│   └── middleware/
│       ├── __init__.py
│       ├── rate_limit.py          # slowapi rate limiting
│       └── error_handler.py       # Global exception handlers
├── alembic/
│   ├── env.py
│   ├── versions/                  # Migration files
│   └── alembic.ini
├── tests/
│   ├── __init__.py
│   ├── conftest.py                # Fixtures (async client, test DB, auth headers)
│   ├── test_health.py
│   ├── test_auth.py
│   ├── test_categories.py
│   ├── test_products.py
│   ├── test_warehouses.py
│   ├── test_stock.py
│   └── test_audit.py
├── seed/
│   └── seed.py                    # Demo data seed script
├── infrastructure/
│   ├── main.tf                    # Provider config, backend (S3)
│   ├── variables.tf               # Environment, region, app config
│   ├── outputs.tf                 # API URL, DB endpoint, ALB DNS
│   ├── vpc.tf                     # VPC, public/private subnets, NAT gateway
│   ├── ecs.tf                     # ECS cluster, task definition, service
│   ├── rds.tf                     # RDS PostgreSQL (private subnet)
│   ├── alb.tf                     # ALB + HTTPS listener + target group
│   ├── ecr.tf                     # ECR repository
│   ├── secrets.tf                 # Secrets Manager (DB URL, JWT secret)
│   ├── iam.tf                     # ECS task role, execution role, deploy role
│   ├── security_groups.tf         # ALB SG, ECS SG, RDS SG
│   ├── cloudwatch.tf              # Log group for ECS
│   └── route53.tf                 # DNS record (shipapi.workermill.dev)
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Lint, typecheck, test on push/PR
│       └── deploy.yml             # Build, push, terraform apply, smoke test
├── Dockerfile                     # Multi-stage (builder + slim runtime)
├── docker-compose.yml             # Local dev (PostgreSQL + app)
├── pyproject.toml                 # Project config (uv, ruff, mypy, pytest)
├── uv.lock                        # Locked dependencies
├── .python-version                # 3.12
├── .env.example                   # All required env vars documented
├── .gitignore
├── CLAUDE.md                      # Worker instructions and conventions
├── WORKERMILL.md                  # Build metadata (filled after completion)
└── README.md                      # Setup, architecture, API docs
```

**pyproject.toml dependencies:**
```toml
[project]
name = "shipapi"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.34",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.30",
    "alembic>=1.14",
    "pydantic>=2.10",
    "pydantic-settings>=2.7",
    "python-jose[cryptography]>=3.3",
    "passlib[bcrypt]>=1.7",
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
```

**Acceptance criteria:**
- Repository created on GitHub at `workermill-examples/shipapi`
- `uv sync` installs all dependencies
- `uv run uvicorn src.main:app --reload` starts FastAPI on port 8000
- `uv run ruff check .` passes
- `uv run mypy src --strict` passes (with initial stubs)
- `.env.example` documents all required variables
- `GET /api/v1/health` returns `{"status": "ok", "database": "connected"}`
- CLAUDE.md written with local dev setup and conventions
- README.md documents setup, architecture, and API endpoint summary

### Phase 0.2 — Docker Build

Multi-stage Dockerfile for production-slim images:

```dockerfile
# Stage 1: Build
FROM python:3.12-slim AS builder
WORKDIR /app
RUN pip install uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY src/ src/
COPY alembic/ alembic/
COPY alembic.ini .

# Stage 2: Runtime
FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src src/
COPY --from=builder /app/alembic alembic/
COPY --from=builder /app/alembic.ini .
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**docker-compose.yml for local dev:**
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: shipapi
      POSTGRES_PASSWORD: localdev
      POSTGRES_DB: shipapi
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql+asyncpg://shipapi:localdev@db:5432/shipapi
      JWT_SECRET_KEY: local-dev-secret-key-change-in-production
    depends_on:
      - db

volumes:
  pgdata:
```

**Acceptance criteria:**
- `docker compose up` starts PostgreSQL + API
- `docker compose up api` builds the image successfully
- Container size < 200MB
- Health check responds at `http://localhost:8000/api/v1/health`

### Phase 0.3 — Terraform Infrastructure

All AWS resources in `infrastructure/`. Workers apply Terraform directly using the devops_engineer persona.

**VPC Layout:**
- VPC: `10.0.0.0/16`
- 2 public subnets: `10.0.1.0/24`, `10.0.2.0/24` (ALB)
- 2 private subnets: `10.0.10.0/24`, `10.0.11.0/24` (ECS, RDS)
- NAT Gateway in public subnet (ECS outbound internet)
- Internet Gateway for ALB

**ECS Fargate:**
- Cluster: `shipapi`
- Service: `shipapi-api` (desired count: 1)
- Task: 0.25 vCPU, 0.5 GB memory
- Container: port 8000
- Health check: `/api/v1/health`
- CloudWatch log group: `/ecs/shipapi` (14-day retention)

**RDS PostgreSQL 16:**
- Instance: `db.t4g.micro`, 20 GB gp3
- Private subnet only, no public access
- DB name: `shipapi`
- Credentials in Secrets Manager: `shipapi/database-url`
- Automated backups: 7 days

**Application Load Balancer:**
- Public subnets
- HTTPS listener (443) using `*.workermill.dev` ACM cert
- HTTP listener (80) → redirect to HTTPS
- Target group → ECS service (port 8000)
- Health check: `/api/v1/health` (interval 30s, healthy threshold 2)

**ECR Repository:**
- `workermill-examples/shipapi`
- Lifecycle policy: keep last 10 images

**Secrets Manager:**
- `shipapi/database-url` — Full PostgreSQL connection string
- `shipapi/jwt-secret-key` — JWT signing secret (generated, 64 chars)

**IAM Roles:**
- ECS task execution role (ECR pull + CloudWatch + Secrets Manager read)
- ECS task role (minimal — no AWS SDK calls from app)
- GitHub Actions deploy role (OIDC, scoped to ECR push + ECS deploy + Terraform state)

**Security Groups:**
- ALB SG: inbound 443/80 from `0.0.0.0/0`, outbound to ECS SG
- ECS SG: inbound 8000 from ALB SG only, outbound all (NAT for image pulls)
- RDS SG: inbound 5432 from ECS SG only, no outbound

**Route53:**
- A record (alias): `shipapi.workermill.dev` → ALB DNS

**Terraform State:**
- S3 backend: `shipapi-terraform-state-AWS_ACCOUNT_ID` / `shipapi/terraform.tfstate`
- DynamoDB lock table: `shipapi-terraform-lock`

**Acceptance criteria:**
- `terraform init` succeeds
- `terraform plan` shows expected resources (~25-30)
- `terraform apply` completes without errors
- ALB health check passes (green target)
- `https://shipapi.workermill.dev/api/v1/health` returns 200
- RDS is NOT publicly accessible
- ECS service is running with 1 healthy task

### Phase 0.4 — GitHub Actions CI/CD

**CI Pipeline** (`.github/workflows/ci.yml`):

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
        ports: ['5432:5432']
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
      - run: uv sync --frozen
      - run: uv run ruff check .
      - run: uv run ruff format --check .
      - run: uv run mypy src --strict
      - run: uv run pytest tests/ -v --cov=src --cov-report=term-missing
        env:
          DATABASE_URL: postgresql+asyncpg://test:test@localhost:5432/shipapi_test
          JWT_SECRET_KEY: test-secret-key
      - run: uv run pip-audit
```

**Deploy Pipeline** (`.github/workflows/deploy.yml`):

```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    name: Build, Push & Deploy
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1

      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr-login

      - name: Build and push Docker image
        env:
          ECR_REGISTRY: ${{ steps.ecr-login.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/workermill-examples/shipapi:$IMAGE_TAG .
          docker build -t $ECR_REGISTRY/workermill-examples/shipapi:latest .
          docker push $ECR_REGISTRY/workermill-examples/shipapi:$IMAGE_TAG
          docker push $ECR_REGISTRY/workermill-examples/shipapi:latest

      - uses: hashicorp/setup-terraform@v3

      - name: Terraform apply
        working-directory: infrastructure
        run: |
          terraform init
          terraform apply -auto-approve -var="image_tag=${{ github.sha }}"

      - name: Run database migrations
        run: |
          # Run Alembic migrations via ECS run-task
          aws ecs run-task \
            --cluster shipapi \
            --task-definition shipapi-migrate \
            --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$ECS_SG]}" \
            --launch-type FARGATE \
            --overrides '{"containerOverrides":[{"name":"api","command":["alembic","upgrade","head"]}]}'

      - name: Wait for deployment
        run: |
          aws ecs wait services-stable --cluster shipapi --services shipapi-api
          sleep 30

      - name: Smoke test
        run: |
          # Health check
          curl -f https://shipapi.workermill.dev/api/v1/health

          # OpenAPI docs accessible
          curl -f https://shipapi.workermill.dev/docs
          curl -f https://shipapi.workermill.dev/redoc

          # Auth flow works
          TOKEN=$(curl -s -X POST https://shipapi.workermill.dev/api/v1/auth/login \
            -H 'Content-Type: application/json' \
            -d '{"email":"demo@shipapi.dev","password":"demo1234"}' | jq -r '.access_token')

          # Authenticated API call
          curl -f -H "Authorization: Bearer $TOKEN" \
            https://shipapi.workermill.dev/api/v1/products
```

**GitHub Secrets (to be configured during SHIP-1):**

| Secret | Purpose |
|--------|---------|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN for GitHub Actions OIDC |

> Other secrets (DATABASE_URL, JWT_SECRET_KEY) are stored in AWS Secrets Manager and injected via ECS task definition — they are NOT in GitHub Secrets.

**Acceptance criteria:**
- CI runs on push to main and PRs
- CI passes: ruff check, ruff format, mypy strict, pytest, pip-audit
- Deploy triggers on merge to main
- Deploy builds Docker image and pushes to ECR
- Terraform apply updates infrastructure
- Migrations run via ECS run-task
- Smoke test confirms health + docs + auth flow
- Failed CI blocks PR merge

### Phase 0.5 — Alembic Migration Setup

Initialize Alembic with async SQLAlchemy support:

```python
# alembic/env.py — async migration runner
# Uses asyncpg, reads DATABASE_URL from env
# Imports all models from src.models for autogenerate
```

Create initial migration with all 7 tables:
- `users`
- `categories`
- `products` (with full-text search vector + GIN index)
- `warehouses`
- `stock_levels` (unique constraint on product_id + warehouse_id)
- `stock_transfers`
- `audit_logs`

**Acceptance criteria:**
- `alembic upgrade head` creates all tables
- `alembic downgrade base` drops all tables
- Full-text search GIN index on `products.search_vector`
- All foreign keys and constraints correct
- Migration is idempotent (running twice doesn't error)

### SHIP-1 Definition of Done

- [ ] Repository `workermill-examples/shipapi` has full project structure
- [ ] `uv sync` installs all dependencies
- [ ] `docker compose up` starts PostgreSQL + API locally
- [ ] `GET /api/v1/health` returns 200 locally with DB status
- [ ] `uv run ruff check .` passes
- [ ] `uv run ruff format --check .` passes
- [ ] `uv run mypy src --strict` passes
- [ ] Alembic migration creates all 7 tables
- [ ] Terraform provisions: VPC, ECS, RDS, ALB, ECR, Secrets Manager, Route53
- [ ] `https://shipapi.workermill.dev/api/v1/health` returns 200
- [ ] RDS is in private subnet, not publicly accessible
- [ ] CI workflow runs on push/PR (lint, typecheck, test)
- [ ] Deploy workflow builds → pushes → deploys → smoke tests
- [ ] CLAUDE.md written with conventions and local dev setup
- [ ] README.md documents architecture, setup, and API summary

---

## SHIP-2: Build the Core API (Auth, CRUD, Search, Audit)

**Personas:** backend_developer
**Estimated stories:** 12
**Dependencies:** SHIP-1 complete

### What This Ticket Delivers

All core API routes functional: authentication, product/category/warehouse CRUD, stock management, full-text search, and audit logging. Every write operation creates an audit log entry.

### Phase 1.1 — Authentication (JWT)

Implement JWT-based auth with dual authentication (JWT tokens + API keys):

**Endpoints:**
| Endpoint | Method | Auth | Rate Limit |
|----------|--------|------|------------|
| `POST /api/v1/auth/register` | Create user account | Public | 5/min |
| `POST /api/v1/auth/login` | Get access + refresh tokens | Public | 10/min |
| `POST /api/v1/auth/refresh` | Refresh access token | Refresh token | 30/min |
| `GET /api/v1/auth/me` | Current user profile | JWT or API Key | 100/min |

**JWT Implementation:**
- Access token: 30-minute expiry, contains `user_id`, `email`, `role`
- Refresh token: 7-day expiry, single-use (rotated on refresh)
- Password hashing: bcrypt with 12 rounds
- API key: 64-char random string per user, `sk_` prefix, stored as SHA-256 hash

**Auth dependency:**
```python
# FastAPI dependency that extracts user from either:
# 1. Authorization: Bearer <jwt_access_token>
# 2. X-API-Key: sk_...
# Returns User object or raises 401
async def get_current_user(
    authorization: str = Header(None),
    x_api_key: str = Header(None),
    db: AsyncSession = Depends(get_db),
) -> User: ...
```

**Admin check dependency:**
```python
async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, detail="Admin access required")
    return user
```

**Acceptance criteria:**
- Register creates user with hashed password and generated API key
- Login returns `access_token` + `refresh_token` + `token_type` + `expires_in`
- Refresh rotates tokens (old refresh token invalidated)
- Protected endpoints return 401 without valid auth
- Both JWT and API key auth work on protected endpoints
- Duplicate email returns 409 with standard error format
- Unit tests for all auth endpoints (success + error paths)

### Phase 1.2 — Category CRUD

**Endpoints:**
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `GET /api/v1/categories` | GET | JWT/API Key | List categories (tree structure) |
| `POST /api/v1/categories` | POST | Admin | Create category |
| `GET /api/v1/categories/{id}` | GET | JWT/API Key | Category detail with products |
| `PUT /api/v1/categories/{id}` | PUT | Admin | Update category |
| `DELETE /api/v1/categories/{id}` | DELETE | Admin | Delete category |

**Category tree:** Categories support optional `parent_id` for nesting. List endpoint returns flat list with `parent_id` field (client assembles tree).

**Acceptance criteria:**
- CRUD operations work with proper validation
- Create/update/delete restricted to admin role
- Delete cascades check (can't delete category with products)
- Category detail includes paginated products list
- Audit log entry created for create/update/delete
- Unit tests for all category endpoints

### Phase 1.3 — Product CRUD + Full-Text Search

**Endpoints:**
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `GET /api/v1/products` | GET | JWT/API Key | List (paginated, filterable, searchable) |
| `POST /api/v1/products` | POST | JWT/API Key | Create product |
| `GET /api/v1/products/{id}` | GET | JWT/API Key | Product detail with stock levels |
| `PUT /api/v1/products/{id}` | PUT | JWT/API Key | Update product |
| `DELETE /api/v1/products/{id}` | DELETE | Admin | Soft-delete (set `is_active = false`) |

**Query parameters for GET /products:**
- `page` (default: 1), `per_page` (default: 20, max: 100)
- `sort_by` (name, price, created_at, sku), `sort_order` (asc, desc)
- `search` — Full-text search on name + description using PostgreSQL `ts_vector`
- `category_id` — Filter by category
- `min_price`, `max_price` — Price range filter
- `is_active` — Active/inactive filter

**Full-text search implementation:**
```python
# PostgreSQL computed column on products table:
# search_vector = to_tsvector('english', name || ' ' || coalesce(description, ''))
# GIN index on search_vector
# Query: WHERE search_vector @@ plainto_tsquery('english', :search_term)
```

**Acceptance criteria:**
- CRUD operations with all product fields
- Pagination with `page`, `per_page`, `total`, `total_pages` in response
- Sorting by any allowed field
- Full-text search returns relevant results (ranked by relevance)
- Category filter, price range filter, active filter all work
- Filters can be combined (e.g., `?category_id=X&min_price=10&search=widget`)
- Product detail includes current stock levels per warehouse
- Soft delete sets `is_active = false` (product still exists for references)
- Audit log entry for create/update/delete
- Unit tests for all product endpoints including search and filtering

### Phase 1.4 — Warehouse CRUD

**Endpoints:**
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `GET /api/v1/warehouses` | GET | JWT/API Key | List warehouses |
| `POST /api/v1/warehouses` | POST | Admin | Create warehouse |
| `GET /api/v1/warehouses/{id}` | GET | JWT/API Key | Warehouse detail |
| `PUT /api/v1/warehouses/{id}` | PUT | JWT/API Key | Update warehouse |
| `GET /api/v1/warehouses/{id}/stock` | GET | JWT/API Key | Stock levels for warehouse |

**Warehouse detail** includes summary: total products stocked, total quantity, capacity utilization.

**Acceptance criteria:**
- CRUD operations with validation
- Create restricted to admin
- Warehouse detail includes stock summary
- Stock endpoint returns paginated stock levels for the warehouse
- Audit log for create/update
- Unit tests for all warehouse endpoints

### Phase 1.5 — Stock Management (Update, Transfer, Alerts)

**Endpoints:**
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `PUT /api/v1/stock/{product_id}/{warehouse_id}` | PUT | JWT/API Key | Update stock level |
| `POST /api/v1/stock/transfer` | POST | JWT/API Key | Transfer between warehouses |
| `GET /api/v1/stock/alerts` | GET | JWT/API Key | Products below min threshold |

**Stock transfer (most critical operation):**
```python
# POST /api/v1/stock/transfer
# Body: { product_id, from_warehouse_id, to_warehouse_id, quantity }
# Must:
# 1. Verify source has sufficient quantity
# 2. Decrement source stock level
# 3. Increment destination stock level (create if doesn't exist)
# 4. Record StockTransfer entry
# 5. ALL in a single database transaction
# 6. Return 400 if insufficient stock
```

**Stock alerts:**
```python
# GET /api/v1/stock/alerts
# Returns products where any stock_level.quantity < stock_level.min_threshold
# Response includes: product info, warehouse info, current quantity, min threshold
# Paginated, sortable by severity (how far below threshold)
```

**Acceptance criteria:**
- Stock update sets quantity and min_threshold
- Transfer is atomic (both sides update or neither does)
- Transfer fails with 400 if insufficient source stock
- Transfer creates StockTransfer record with `initiated_by` (current user)
- Alerts endpoint returns products below threshold across all warehouses
- Audit log for stock update and transfer
- Unit tests for transfer (success, insufficient stock, same warehouse error)

### Phase 1.6 — Audit Log

**Endpoints:**
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `GET /api/v1/audit-log` | GET | Admin | Query audit logs |

**Query parameters:**
- `page`, `per_page` — Pagination
- `start_date`, `end_date` — Date range filter (ISO 8601)
- `action` — Filter by action (create, update, delete, transfer)
- `resource_type` — Filter by resource (product, category, warehouse, stock_level)
- `user_id` — Filter by user

**Audit recording service:**
```python
# Called from every write endpoint. Records:
# - user_id: who performed the action
# - action: create | update | delete | transfer
# - resource_type: product | category | warehouse | stock_level
# - resource_id: UUID of affected resource
# - changes: JSON diff { field: { old: x, new: y } } for updates
# - ip_address: from request
# - created_at: timestamp
```

**Acceptance criteria:**
- Every write operation (create, update, delete, transfer) creates audit entry
- Audit log records `changes` JSON with old/new values for updates
- Query supports date range, action, resource type, and user filters
- Audit log is admin-only (403 for non-admin)
- Audit entries include IP address from request
- Unit tests for audit query with filters

### SHIP-2 Definition of Done

- [ ] Authentication: register, login, refresh, me — all working
- [ ] JWT + API key dual auth on all protected endpoints
- [ ] Category CRUD with admin restrictions
- [ ] Product CRUD with pagination, sorting, filtering
- [ ] Full-text search on products (name + description)
- [ ] Warehouse CRUD with stock summary
- [ ] Stock update, atomic transfer, and alerts endpoint
- [ ] Audit log records every write operation with changes diff
- [ ] Audit log query with date range, action, resource, user filters
- [ ] `uv run ruff check .` passes
- [ ] `uv run ruff format --check .` passes
- [ ] `uv run mypy src --strict` passes
- [ ] `uv run pytest tests/ -v` passes with >80% coverage on `src/api/`
- [ ] All endpoints return standard error format on failure

---

## SHIP-3: Build Rate Limiting, Error Handling, and OpenAPI Docs

**Personas:** backend_developer
**Estimated stories:** 6
**Dependencies:** SHIP-2 complete

### What This Ticket Delivers

Production hardening: rate limiting per API key, consistent error responses, and fully documented OpenAPI 3.1 spec with interactive Swagger UI and ReDoc.

### Phase 2.1 — Rate Limiting (slowapi)

Configure `slowapi` with per-key rate limits:

| Endpoint Group | Limit | Key |
|---------------|-------|-----|
| `POST /auth/register` | 5/min | IP address |
| `POST /auth/login` | 10/min | IP address |
| `POST /auth/refresh` | 30/min | IP address |
| All other endpoints | 100/min | API key or user_id |

**Implementation:**
```python
# slowapi limiter with Redis-free in-memory backend (fine for single-instance)
# Key function extracts API key from header or user_id from JWT
# Returns 429 with Retry-After header when exceeded
# Rate limit headers on every response: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
```

**Acceptance criteria:**
- Rate limits enforced per configuration
- 429 response with `Retry-After` header when limit exceeded
- Rate limit headers on all responses
- Rate limit resets after window expires
- Unit test: verify 429 after exceeding limit

### Phase 2.2 — Consistent Error Handling

Global exception handlers for consistent error format across all endpoints:

**Standard error response:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "price", "message": "Must be greater than 0" }
    ]
  }
}
```

**Error codes and HTTP status mapping:**
| Code | HTTP Status | When |
|------|-------------|------|
| `VALIDATION_ERROR` | 422 | Pydantic validation failure |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `ALREADY_EXISTS` | 409 | Duplicate unique field |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INSUFFICIENT_STOCK` | 400 | Transfer with insufficient quantity |
| `INTERNAL_ERROR` | 500 | Unhandled exception |

**Exception handlers:**
```python
# Register global handlers for:
# - RequestValidationError → 422 with field-level details
# - HTTPException → standard format with code mapping
# - IntegrityError → 409 ALREADY_EXISTS
# - Exception → 500 INTERNAL_ERROR (log full traceback, return generic message)
```

**Acceptance criteria:**
- ALL error responses follow the standard format (no FastAPI default error JSON)
- Pydantic validation errors include field names and messages
- Database integrity errors (duplicate key) return 409
- Unhandled exceptions return 500 with generic message (no stack trace in response)
- Unit tests verify error format for each error type

### Phase 2.3 — OpenAPI Documentation

FastAPI auto-generates OpenAPI 3.1 spec. Enhance it for showcase quality:

**Swagger UI:** `GET /docs` — Interactive API explorer
**ReDoc:** `GET /redoc` — Clean API reference documentation

**Enhancements over defaults:**
- Custom title, description, version, contact info
- Tag grouping (Auth, Categories, Products, Warehouses, Stock, Audit)
- Request/response examples on every endpoint
- Error response schemas documented on every endpoint
- Security schemes documented (Bearer JWT + API Key)
- Pagination response model with metadata

```python
app = FastAPI(
    title="ShipAPI",
    description="Production inventory management API — Built by WorkerMill",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=[
        {"name": "Auth", "description": "Authentication and API key management"},
        {"name": "Categories", "description": "Product category management"},
        {"name": "Products", "description": "Product CRUD with full-text search"},
        {"name": "Warehouses", "description": "Warehouse management"},
        {"name": "Stock", "description": "Stock levels, transfers, and alerts"},
        {"name": "Audit", "description": "Audit log queries"},
        {"name": "Health", "description": "Service health check"},
    ],
)
```

**Acceptance criteria:**
- `GET /docs` shows Swagger UI with all endpoints grouped by tag
- `GET /redoc` shows ReDoc documentation
- Every endpoint has request body examples and response examples
- Error responses documented on every endpoint (401, 403, 404, 422, 429)
- Security schemes (JWT + API Key) shown in Swagger UI "Authorize" button
- Can authenticate in Swagger UI and make real API calls
- OpenAPI spec validates against `openapi-spec-validator`

### Phase 2.4 — CORS and Production Middleware

```python
# CORS: Allow all origins for showcase (API is public)
# Trusted host: shipapi.workermill.dev
# Request ID middleware: X-Request-Id header on every response
# Access logging: structured JSON logs for each request
```

**Acceptance criteria:**
- CORS headers present on all responses
- X-Request-Id header on every response (UUID)
- Structured JSON access logs (method, path, status, duration_ms, request_id)

### SHIP-3 Definition of Done

- [ ] Rate limiting enforced: 5/min register, 10/min login, 100/min authenticated
- [ ] 429 responses include `Retry-After` header
- [ ] Rate limit headers on all responses
- [ ] All errors follow standard format: `{ error: { code, message, details } }`
- [ ] Pydantic validation errors include field-level details
- [ ] `GET /docs` shows Swagger UI with all endpoints, examples, and auth
- [ ] `GET /redoc` shows ReDoc documentation
- [ ] Every endpoint has documented request/response examples
- [ ] CORS configured for public access
- [ ] X-Request-Id on all responses
- [ ] `uv run ruff check .` passes
- [ ] `uv run mypy src --strict` passes
- [ ] `uv run pytest tests/` passes with >80% coverage

---

## SHIP-4: Build Seed Data and Integration Tests

**Personas:** backend_developer, qa_engineer
**Estimated stories:** 6
**Dependencies:** SHIP-3 complete

### What This Ticket Delivers

Rich demo data that makes the API documentation meaningful, plus comprehensive integration tests that validate the full request lifecycle against a real database.

### Phase 3.1 — Seed Data Script

`seed/seed.py` populates the database with demo data:

**1 admin user:**
- Email: `demo@shipapi.dev`
- Password: `demo1234`
- Name: `Demo Admin`
- Role: `admin`
- API key: `sk_demo_shipapi_2026_showcase_key` (for easy testing)

**5 categories:**
1. Electronics (subcategories: Smartphones, Laptops, Accessories)
2. Clothing (subcategories: Men's, Women's, Kids')
3. Home & Garden (subcategories: Kitchen, Outdoor, Decor)
4. Sports (subcategories: Running, Cycling, Swimming)
5. Books (subcategories: Fiction, Technical, Business)

**50 products:** Distributed across categories with realistic:
- Names (e.g., "Ultra HD 4K Monitor 32-inch", "Organic Cotton T-Shirt")
- SKUs (e.g., "ELEC-MON-001", "CLTH-TSH-012")
- Descriptions (2-3 sentences, meaningful for full-text search testing)
- Prices ($5.99 – $2,499.99)
- Weights (0.1 – 25.0 kg)
- Mix of `is_active = true` (45) and `is_active = false` (5)

**3 warehouses:**
1. "East Coast Hub" — New York, NY (capacity: 10,000)
2. "West Coast Hub" — Los Angeles, CA (capacity: 8,000)
3. "Central Warehouse" — Chicago, IL (capacity: 12,000)

**150 stock levels:** Each product has stock in 1-3 warehouses:
- ~10 products have at least one stock level below `min_threshold` (for alerts testing)
- Quantities range from 0 to 500
- Min thresholds range from 5 to 50

**20 stock transfers:** Recent transfer history (past 30 days)

**50 audit log entries:** Mix of create/update/delete/transfer operations

**Seed must be idempotent:** Check-before-insert pattern. Running twice does not create duplicates.

**Acceptance criteria:**
- `uv run python seed/seed.py` populates all data
- Running seed twice does not create duplicates
- Demo user can authenticate with `demo@shipapi.dev` / `demo1234`
- Demo user's API key works: `X-API-Key: sk_demo_shipapi_2026_showcase_key`
- `GET /products?search=monitor` returns relevant results
- `GET /stock/alerts` returns ~10 products below threshold
- `GET /audit-log` returns 50 entries
- All categories, products, warehouses, stock levels present

### Phase 3.2 — Integration Tests

Tests that run against a real PostgreSQL database (no mocks):

```
tests/
├── conftest.py              # Shared fixtures
│   ├── async_client          # httpx.AsyncClient against test app
│   ├── test_db              # Fresh PostgreSQL per test session
│   ├── auth_headers         # JWT headers for authenticated requests
│   ├── admin_headers        # JWT headers for admin user
│   └── seeded_db            # DB with seed data loaded
├── test_health.py           # Health check returns DB status
├── test_auth.py             # Register, login, refresh, me, API key
├── test_categories.py       # CRUD, admin restriction, cascade check
├── test_products.py         # CRUD, search, filtering, pagination, sorting
├── test_warehouses.py       # CRUD, stock summary
├── test_stock.py            # Update, transfer (atomic), alerts
├── test_audit.py            # Query with filters, admin-only
├── test_rate_limit.py       # Rate limit enforcement
└── test_errors.py           # Error format consistency
```

**Key integration test scenarios:**

1. **Auth lifecycle:** Register → login → access protected endpoint → refresh → access again
2. **Product search:** Seed products → search for "monitor" → verify relevance ranking
3. **Stock transfer atomicity:** Transfer → verify source decremented AND destination incremented → verify transfer record exists
4. **Insufficient stock:** Attempt transfer exceeding available → verify 400 → verify no partial update
5. **Audit trail:** Create product → update product → verify 2 audit entries with correct changes diff
6. **Pagination:** Seed 50 products → request page 1 (20 items) → verify total=50, total_pages=3
7. **Combined filters:** `?category_id=X&min_price=10&max_price=100&sort_by=price&sort_order=asc`
8. **Rate limiting:** Send 101 requests → verify 429 on 101st
9. **Error format:** Verify all error responses match `{ error: { code, message, details } }`

**Acceptance criteria:**
- All integration tests pass against real PostgreSQL
- Tests run in CI (GitHub Actions service container)
- Test database is isolated (doesn't affect production)
- Stock transfer atomicity verified (concurrent test if possible)
- Search relevance verified (exact match ranked higher)
- >80% code coverage on `src/api/` and `src/services/`

### Phase 3.3 — OpenAPI Spec Validation

Validate the generated OpenAPI spec:

```bash
# Validate spec is valid OpenAPI 3.1
uv run python -c "
from src.main import app
from openapi_spec_validator import validate
validate(app.openapi())
print('OpenAPI spec is valid')
"
```

Add to CI pipeline as a quality gate.

**Acceptance criteria:**
- OpenAPI spec passes validation
- CI fails if spec is invalid
- All endpoints documented with examples

### SHIP-4 Definition of Done

- [ ] Seed script creates: 1 admin user, 5 categories, 50 products, 3 warehouses, 150 stock levels, 20 transfers, 50 audit entries
- [ ] Seed is idempotent (safe to run multiple times)
- [ ] Demo user authenticates with both password and API key
- [ ] Integration tests pass for all endpoints
- [ ] Stock transfer atomicity verified in tests
- [ ] Full-text search returns relevant results in tests
- [ ] Rate limiting verified in tests
- [ ] Error format consistency verified in tests
- [ ] OpenAPI spec validates
- [ ] >80% code coverage
- [ ] `uv run ruff check .` passes
- [ ] `uv run mypy src --strict` passes
- [ ] All tests pass in CI

---

## SHIP-5: Deploy to Production and Validate

**Personas:** devops_engineer
**Estimated stories:** 5
**Dependencies:** SHIP-2 complete minimum (SHIP-3 and SHIP-4 are nice-to-have)

### What This Ticket Delivers

Production deployment verified end-to-end. Live URL functional, seeded with demo data, and passing all smoke tests. Full CI/CD pipeline operational.

### Phase 4.1 — Production Deployment Verification

Verify the full deployment pipeline works:

1. Push to main triggers deploy workflow
2. Docker image builds and pushes to ECR
3. Terraform apply updates ECS task definition
4. ECS service deploys new task
5. ALB health check passes
6. `https://shipapi.workermill.dev/api/v1/health` returns 200

**Acceptance criteria:**
- ECS service running with 1 healthy task
- ALB target group shows healthy target
- Health check returns `{"status": "ok", "database": "connected"}`
- CloudWatch logs show application startup

### Phase 4.2 — Database Migration & Seed

Run against production RDS:

1. Alembic migrations create all tables
2. Seed script populates demo data
3. Verify data via API endpoints

```bash
# Via ECS run-task (migrations)
aws ecs run-task --cluster shipapi --task-definition shipapi-migrate ...

# Via ECS run-task (seed)
aws ecs run-task --cluster shipapi --task-definition shipapi-seed \
  --overrides '{"containerOverrides":[{"name":"api","command":["python","seed/seed.py"]}]}'
```

**Acceptance criteria:**
- All 7 tables created in production database
- Seed data loaded (admin user, categories, products, warehouses, stock)
- `demo@shipapi.dev` / `demo1234` can authenticate via API
- API returns seeded data correctly

### Phase 4.3 — Full Smoke Test Suite

Run comprehensive smoke tests against production:

```bash
BASE_URL=https://shipapi.workermill.dev

# 1. Health check
curl -f $BASE_URL/api/v1/health

# 2. OpenAPI docs accessible
curl -f $BASE_URL/docs
curl -f $BASE_URL/redoc

# 3. Register a new user
curl -s -X POST $BASE_URL/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.dev","password":"smoketest123","name":"Smoke Test"}' \
  | jq '.email'

# 4. Login as demo user
TOKEN=$(curl -s -X POST $BASE_URL/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@shipapi.dev","password":"demo1234"}' \
  | jq -r '.access_token')

# 5. List categories (should return 5)
curl -f -H "Authorization: Bearer $TOKEN" $BASE_URL/api/v1/categories | jq '.data | length'

# 6. List products with pagination
curl -f -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/products?page=1&per_page=10" \
  | jq '.pagination.total'

# 7. Full-text search
curl -f -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/products?search=monitor" \
  | jq '.data | length'

# 8. List warehouses
curl -f -H "Authorization: Bearer $TOKEN" $BASE_URL/api/v1/warehouses | jq '.data | length'

# 9. Stock alerts
curl -f -H "Authorization: Bearer $TOKEN" $BASE_URL/api/v1/stock/alerts | jq '.data | length'

# 10. Audit log (admin only)
curl -f -H "Authorization: Bearer $TOKEN" $BASE_URL/api/v1/audit-log | jq '.data | length'

# 11. API key auth
curl -f -H "X-API-Key: sk_demo_shipapi_2026_showcase_key" $BASE_URL/api/v1/products \
  | jq '.pagination.total'

# 12. Rate limit headers present
curl -sI -H "Authorization: Bearer $TOKEN" $BASE_URL/api/v1/products \
  | grep -i "x-ratelimit"
```

**Acceptance criteria:**
- All 12 smoke test steps pass
- Response times < 200ms p95 for list endpoints
- No 5xx errors in CloudWatch logs

### Phase 4.4 — CI/CD Pipeline Verification

Verify the full pipeline works end-to-end:

1. **CI gate:** Push branch → CI runs → lint, typecheck, test, pip-audit all pass
2. **Deploy gate:** Merge to main → Docker build → ECR push → Terraform apply → ECS deploy → smoke test
3. **Failure handling:** Intentionally break a test → CI blocks merge

**Pipeline flow:**
```
Push to branch
  → CI: ruff check → ruff format → mypy strict → pytest → pip-audit
  → All pass → PR mergeable

Merge to main
  → Deploy: docker build → ECR push → terraform apply → ECS deploy → alembic migrate → smoke test
  → Deployment live at shipapi.workermill.dev
```

**Acceptance criteria:**
- CI runs on every push and PR
- Failed CI blocks PR merge
- Merge to main triggers full deploy pipeline
- Smoke tests pass post-deploy

### Phase 4.5 — WORKERMILL.md Build Metadata

Create `WORKERMILL.md` documenting the build:

```markdown
# Built by WorkerMill

## Build Summary
- **Stories completed:** N
- **Total iterations:** N (CI failures fixed)
- **Build time:** N hours
- **AI cost:** $N.NN
- **Quality gates passed:** lint, typecheck, tests (>80% coverage), mypy strict, pip-audit, openapi validation

## Task Log
Link to WorkerMill task log showing the entire build process.

## Architecture
[Auto-generated from actual implementation]
```

### SHIP-5 Definition of Done

- [ ] `https://shipapi.workermill.dev/api/v1/health` returns 200
- [ ] `GET /docs` shows Swagger UI with all endpoints documented
- [ ] `GET /redoc` shows ReDoc documentation
- [ ] Demo user can authenticate (password + API key)
- [ ] Product listing: pagination, filtering, sorting, full-text search all work
- [ ] Stock transfer works end-to-end
- [ ] Stock alerts return products below threshold
- [ ] Rate limiting returns 429 after 100 requests/minute
- [ ] All write operations create audit log entries
- [ ] Error responses follow standard format consistently
- [ ] RDS is in private subnet, not publicly accessible
- [ ] CI pipeline runs on push (lint, typecheck, test, pip-audit)
- [ ] Deploy pipeline: build → push → terraform → deploy → smoke test
- [ ] Response time < 200ms p95 for list endpoints
- [ ] WORKERMILL.md documents build metadata
- [ ] "Built by WorkerMill" in API description and health endpoint

---

## Quality Gates (All Tickets)

| Gate | Threshold | Tool |
|------|-----------|------|
| Lint | 0 errors | `ruff check .` |
| Format | Fully formatted | `ruff format --check .` |
| Types | 0 errors (strict mode) | `mypy src --strict` |
| Tests | 100% pass, >80% coverage | `pytest --cov=src` |
| Security | 0 known vulnerabilities | `pip-audit` |
| Build | Successful Docker build | `docker build .` |
| OpenAPI | Valid spec, all endpoints documented | `openapi-spec-validator` |
| Smoke test | Health + auth + query all pass | `curl` against live URL |

---

## Execution Order

```
SHIP-1 ─── SHIP-2 ─── SHIP-3 ─── SHIP-4 ─── SHIP-5
(infra      (core       (hardening  (seed &     (deploy &
 & repo)     API)        & docs)     tests)      validate)
```

- **All tickets are strictly sequential** (each depends on the previous)
- **Minimum viable showcase:** SHIP-1 + SHIP-2 + SHIP-5 (skip SHIP-3 and SHIP-4 if needed)
- **Full showcase:** All 5 tickets

---

## Worker Execution Notes

### Autonomous Execution Requirements

Each ticket must be executable **without human input** after creation. Workers need:

1. **Repository access:** GitHub PAT with `workermill-examples` org write access
2. **AWS credentials:** OIDC-based role assumption (no long-lived keys)
3. **Terraform state:** S3 backend with DynamoDB lock (created in SHIP-1)
4. **CI/CD iteration loop:** Workers read CI failure logs, fix code, push again until green

### CI/CD Iteration Pattern

```
Worker pushes code to branch
  → GitHub Actions triggers CI
  → If ANY step fails:
      Worker reads failure output via GitHub Actions API
      Worker fixes the root cause
      Worker pushes again
      Loop repeats
  → When CI passes:
      Merge to main
      Deploy pipeline runs automatically
      Smoke test validates deployment
```

### What Workers Can Do Autonomously

| Action | Autonomous? | How |
|--------|-------------|-----|
| Create GitHub repo | ✅ | GitHub API via PAT |
| Scaffold Python project | ✅ | Write files, install deps |
| Write Terraform configs | ✅ | Create .tf files |
| Run `terraform apply` | ✅ | devops_engineer persona has AWS CLI |
| Build Docker images | ✅ | Kaniko (daemon-less, ECS-compatible) |
| Push to ECR | ✅ | AWS CLI with task role credentials |
| Deploy to ECS | ✅ | AWS CLI `update-service --force-new-deployment` |
| Run Alembic migrations | ✅ | ECS run-task with command override |
| Run seed script | ✅ | ECS run-task with command override |
| Configure GitHub Secrets | ✅ | GitHub API via PAT |
| Create GitHub Actions workflows | ✅ | Write .yml files to repo |
| Read CI failure logs | ✅ | GitHub Actions API |
| Set up branch protection | ✅ | GitHub API |
| Create DNS records | ✅ | Terraform (Route53) |

### Cross-Ticket Context

Each ticket's CLAUDE.md is updated with conventions established in previous tickets. Workers read CLAUDE.md at the start of each ticket for context continuity.

**CLAUDE.md accumulates:**
- SHIP-1: Local dev setup, Docker commands, Terraform commands, project structure
- SHIP-2: API patterns, auth flow, error handling conventions, test patterns
- SHIP-3: Rate limiting config, OpenAPI documentation standards
- SHIP-4: Seed data details, integration test patterns
- SHIP-5: Deployment verification procedures

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Terraform state conflicts | Deploy blocked | DynamoDB lock table prevents concurrent applies |
| RDS provisioning time | 10-15 min delay | Worker waits; RDS is one-time setup |
| NAT Gateway cost | ~$30/month | Acceptable for showcase; can switch to NAT instance if needed |
| ECS Fargate cold start | First request slow (~5s) | Health check warms the container; ALB waits for healthy |
| Docker build failures | Deploy blocked | Multi-stage build minimizes failure surface; pin all versions |
| Alembic migration conflicts | Schema drift | Single migration in initial setup; subsequent changes are additive |
| Rate limiting in-memory | Lost on restart | Acceptable for single-instance showcase; Redis option documented |
| GitHub Actions OIDC setup | Deploy role creation | Use existing OIDC provider; scope role to this repo only |
| Full-text search locale | Wrong results for non-English | Use `'english'` dictionary; document limitation |
| Cross-ticket context loss | Worker deviates | CLAUDE.md updated every ticket; PRD is source of truth |

---

## Estimated Monthly Cost

| Resource | Estimated Cost |
|----------|---------------|
| ECS Fargate (0.25 vCPU, 0.5 GB, 24/7) | ~$9 |
| RDS db.t4g.micro (24/7) | ~$13 |
| NAT Gateway (data processing) | ~$5 |
| ALB (fixed + LCU) | ~$7 |
| Route53 (hosted zone) | $0.50 |
| ECR (storage) | ~$1 |
| CloudWatch (logs) | ~$1 |
| Secrets Manager (2 secrets) | ~$1 |
| S3 (Terraform state) | < $0.01 |
| **Total** | **~$37-38/month** |
