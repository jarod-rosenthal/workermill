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
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 1,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/1",
    "commentCount": 4,
    "personas": [
      "backend_developer",
      "devops_engineer"
    ],
    "description": `Scaffold the ShipAPI project from scratch: pyproject.toml with pinned dependencies, Docker and Compose config for Railway deployment, FastAPI app skeleton with async database layer, and CLAUDE.md developer documentation. This is the foundation epic that every subsequent ticket builds on.`,
    "buildLog": `***REMOVED******REMOVED*** Epic Implementation

This PR consolidates all stories from Epic SAPFB-1.

***REMOVED******REMOVED******REMOVED*** Stories Included

- **Project metadata, dependencies & tooling config complete**
  - Files: .env.example, .gitignore, .python-version (+3 more)
- **Docker, Compose & Railway deployment config complete**
  - Files: .dockerignore, .env.example, .gitignore (+7 more)
- **FastAPI app skeleton, config & database layer complete**
  - Files: .env.example, .gitignore, .python-version (+12 more)
- **Developer documentation \u2014 CLAUDE.md complete**
  - Files: .dockerignore, .env.example, .gitignore (+17 more)

***REMOVED******REMOVED******REMOVED*** Branches Merged

- \`story/sapfb-1/0-project-metadata-dependencies\`
- \`story/sapfb-1/1-docker-compose-railway-deploym\`
- \`story/sapfb-1/2-fastapi-app-skeleton-config-da\`
- \`story/sapfb-1/3-developer-documentation-claude\`

***REMOVED******REMOVED******REMOVED*** Code Quality

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
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 2,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/2",
    "commentCount": 5,
    "personas": [
      "backend_developer"
    ],
    "description": `Define the SQLAlchemy foundation: base mixins (timestamps, soft-delete), User model with password hashing, Catalog models (Category, Product with TSVECTOR full-text search), Inventory models (Warehouse, StockLevel), cross-entity models (StockTransfer, AuditLog), and Alembic async migration config.`,
    "buildLog": `***REMOVED******REMOVED*** Epic Implementation

This PR consolidates all stories from Epic SAPFB-2.

***REMOVED******REMOVED******REMOVED*** Stories Included

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

***REMOVED******REMOVED******REMOVED*** Branches Merged

- \`story/sapfb-2/0-foundation-base-mixins-and-use\`
- \`story/sapfb-2/1-catalog-models-category-and-pr\`
- \`story/sapfb-2/2-inventory-models-warehouse-and\`
- \`story/sapfb-2/3-cross-entity-models-stocktrans\`
- \`story/sapfb-2/4-model-registry-and-alembic-asy\`

***REMOVED******REMOVED******REMOVED*** Code Quality

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
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 3,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/3",
    "commentCount": 5,
    "personas": [
      "backend_developer",
      "security_engineer"
    ],
    "description": `Implement Pydantic V2 request/response schemas for auth flows, core authentication service with JWT token handling, FastAPI dependency injection layer, auth API endpoints (register, login, refresh, me), and health endpoint with main.py router wiring.`,
    "buildLog": `***REMOVED******REMOVED*** Epic Implementation

This PR consolidates all stories from Epic SAPFB-3.

***REMOVED******REMOVED******REMOVED*** Stories Included

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

***REMOVED******REMOVED******REMOVED*** Branches Merged

- \`story/sapfb-3/0-pydantic-v2-request-response-s\`
- \`story/sapfb-3/1-core-authentication-service\`
- \`story/sapfb-3/2-fastapi-dependency-injection-l\`
- \`story/sapfb-3/3-auth-api-endpoints\`
- \`story/sapfb-3/4-health-endpoint-api-router-and\`

***REMOVED******REMOVED******REMOVED*** Code Quality

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
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 4,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/4",
    "commentCount": 5,
    "personas": [
      "backend_developer",
      "security_engineer"
    ],
    "description": `Build the middleware stack: structured error handling with consistent JSON responses, request-ID and access logging middleware, audit recording service with query endpoint, rate limiting infrastructure with sliding-window algorithm, and wire everything into main.py with rate limits applied to auth endpoints.`,
    "buildLog": `***REMOVED******REMOVED*** Epic Implementation

This PR consolidates all stories from Epic SAPFB-4.

***REMOVED******REMOVED******REMOVED*** Stories Included

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

***REMOVED******REMOVED******REMOVED*** Branches Merged

- \`story/sapfb-4/0-error-handling-middleware\`
- \`story/sapfb-4/1-request-id-and-access-logging\`
- \`story/sapfb-4/2-audit-recording-service-schema\`
- \`story/sapfb-4/3-rate-limiting-infrastructure\`
- \`story/sapfb-4/4-wire-middleware-into-main-py-a\`

***REMOVED******REMOVED******REMOVED*** Code Quality

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
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 5,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/5",
    "commentCount": 4,
    "personas": [
      "backend_developer"
    ],
    "description": `Add Pydantic schemas for warehouse and stock entities, implement the stock service layer with atomic transfer operations, build warehouse CRUD API routes, and stock API routes with full router registration.`,
    "buildLog": `***REMOVED******REMOVED*** Epic Implementation

This PR consolidates all stories from Epic SAPFB-6.

***REMOVED******REMOVED******REMOVED*** Stories Included

- **Pydantic schemas for warehouse and stock complete**
  - Files: docs/plans/2026-02-19-warehouse-stock-schemas.md, pyproject.toml, src/schemas/__init__.py (+5 more)
- **Stock service layer with atomic transfers complete**
  - Files: docs/plans/2026-02-19-warehouse-stock-schemas.md, pyproject.toml, src/schemas/__init__.py (+7 more)
- **Warehouse CRUD API routes complete**
  - Files: docs/plans/2026-02-19-warehouse-stock-schemas.md, pyproject.toml, src/api/router.py (+9 more)
- **Stock API routes and router registration complete**
  - Files: docs/plans/2026-02-19-warehouse-stock-schemas.md, pyproject.toml, src/api/router.py (+10 more)

***REMOVED******REMOVED******REMOVED*** Branches Merged

- \`story/sapfb-6/0-pydantic-schemas-for-warehouse\`
- \`story/sapfb-6/1-stock-service-layer-with-atomi\`
- \`story/sapfb-6/2-warehouse-crud-api-routes\`
- \`story/sapfb-6/3-stock-api-routes-and-router-re\`

***REMOVED******REMOVED******REMOVED*** Code Quality

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
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 6,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/6",
    "commentCount": 5,
    "personas": [
      "backend_developer"
    ],
    "description": `Implement catalog-layer schemas (Category, Product), reusable pagination utility, category CRUD endpoints with cascade-delete protection, product CRUD endpoints with full-text search, and endpoint test suites for both categories and products.`,
    "buildLog": `***REMOVED******REMOVED*** Epic Implementation

This PR consolidates all stories from Epic SAPFB-5.

***REMOVED******REMOVED******REMOVED*** Stories Included

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

***REMOVED******REMOVED******REMOVED*** Branches Merged

- \`story/sapfb-5/0-foundation-schemas-pagination\`
- \`story/sapfb-5/1-category-crud-endpoint-layer-w\`
- \`story/sapfb-5/2-product-crud-endpoints-with-fu\`
- \`story/sapfb-5/3-category-endpoint-test-suite\`
- \`story/sapfb-5/4-product-endpoint-test-suite\`

***REMOVED******REMOVED******REMOVED*** Code Quality

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
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 7,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/7",
    "commentCount": 7,
    "personas": [
      "backend_developer"
    ],
    "description": `Create the database seed script (admin user, categories, products, warehouses, stock levels, transfers, audit logs), write comprehensive README.md documentation, and add OpenAPI enhancements across all endpoint groups (auth, health, categories, products, warehouse, stock, audit) with Swagger UI auth verification.`,
    "buildLog": `***REMOVED******REMOVED*** Epic Implementation

This PR consolidates all stories from Epic SAPFB-7.

***REMOVED******REMOVED******REMOVED*** Stories Included

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

***REMOVED******REMOVED******REMOVED*** Branches Merged

- \`story/sapfb-7/0-seed-script-admin-user-categor\`
- \`story/sapfb-7/1-seed-script-warehouses-stock-t\`
- \`story/sapfb-7/2-openapi-enhancements-auth-heal\`
- \`story/sapfb-7/3-openapi-enhancements-category\`
- \`story/sapfb-7/4-openapi-enhancements-warehouse\`
- \`story/sapfb-7/5-readme-md-comprehensive-projec\`
- \`story/sapfb-7/6-swagger-ui-auth-verification-a\`

***REMOVED******REMOVED******REMOVED*** Code Quality

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
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 8,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/8",
    "commentCount": 6,
    "personas": [
      "backend_developer",
      "qa_engineer"
    ],
    "description": `Build the test infrastructure with conftest.py fixtures and health endpoint tests, then add integration test suites for auth endpoints, rate limiting and error format validation, category and product endpoints, warehouse and stock management, and audit log endpoints.`,
    "buildLog": `***REMOVED******REMOVED*** Epic Implementation

This PR consolidates all stories from Epic SAPFB-8.

***REMOVED******REMOVED******REMOVED*** Stories Included

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

***REMOVED******REMOVED******REMOVED*** Branches Merged

- \`story/sapfb-8/0-test-infrastructure-conftest-p\`
- \`story/sapfb-8/1-auth-endpoint-integration-test\`
- \`story/sapfb-8/2-rate-limiting-and-error-format\`
- \`story/sapfb-8/3-category-and-product-endpoint\`
- \`story/sapfb-8/4-warehouse-and-stock-management\`
- \`story/sapfb-8/5-audit-log-endpoint-tests\`

***REMOVED******REMOVED******REMOVED*** Code Quality

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
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 9,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/9",
    "commentCount": 2,
    "personas": [
      "backend_developer",
      "devops_engineer"
    ],
    "description": `Set up GitHub Actions CI pipeline with quality gates (lint, typecheck, test) and a deploy-and-smoke-test workflow for Railway deployment with automated health verification.`,
    "buildLog": `***REMOVED******REMOVED*** Epic Implementation

This PR consolidates all stories from Epic SAPFB-9.

***REMOVED******REMOVED******REMOVED*** Stories Included

- **CI quality gates workflow complete**
  - Files: .github/workflows/ci.yml
- **Deploy and smoke test workflow complete**
  - Files: .github/workflows/ci.yml, .github/workflows/deploy.yml

***REMOVED******REMOVED******REMOVED*** Branches Merged

- \`story/sapfb-9/0-ci-quality-gates-workflow\`
- \`story/sapfb-9/1-deploy-and-smoke-test-workflow\`

***REMOVED******REMOVED******REMOVED*** Code Quality

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
    "description": `Final deployment epic: pre-deploy config and CI workflow validation, push to main with CI green, deploy to Railway and seed production, then run smoke tests across infrastructure, auth/security, business logic, and produce the final go-live validation report.`,
    "buildLog": `***REMOVED******REMOVED*** Epic Implementation

This PR consolidates all stories from Epic SAPFB-10.

***REMOVED******REMOVED******REMOVED*** Stories Included

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

***REMOVED******REMOVED******REMOVED*** Branches Merged

- \`story/sapfb-10/0-pre-deploy-config-and-ci-workf\`
- \`story/sapfb-10/1-push-to-main-ci-green-deploy-a\`
- \`story/sapfb-10/2-infrastructure-and-docs-smoke\`
- \`story/sapfb-10/3-auth-and-security-smoke-tests\`
- \`story/sapfb-10/4-business-logic-smoke-tests\`
- \`story/sapfb-10/5-final-validation-and-go-live-r\`

***REMOVED******REMOVED******REMOVED*** Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | \u2705 Pass | |
| Lint | \u2705 Pass | 0 warnings |
| Tests | \u2705 Pass | 0 passed |
| Security | \u2705 Clean | 0M/0L |`
  }
];
