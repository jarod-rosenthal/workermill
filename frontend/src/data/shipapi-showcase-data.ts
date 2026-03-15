// Auto-generated from WorkerMill showcase data
// Repo: workermill-examples/shipapi
// Generated: 2026-03-15

export { shipApiPrd } from "./shipapi-prd";

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
    "title": "SAFBS-1: Project scaffolding and configuration",
    "priority": "high",
    "storyCount": 13,
    "duration": "~65 min",
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 1,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/1",
    "commentCount": 1,
    "personas": [
      "backend_developer",
      "devops_engineer"
    ],
    "description": `### Epic Overview
Bootstrap the ShipAPI repository with all configuration, Docker setup, FastAPI app skeleton, database models, authentication, CRUD endpoints, stock management, audit logging, search, rate limiting, tests, and CI/CD pipeline.

### Deliverables
1. \`pyproject.toml\` — Project metadata, all dependencies, tool configs for ruff, mypy, pytest
2. \`.python-version\` — Set to \`3.13\`
3. \`Dockerfile\` — Multi-stage build with uv, non-root user
4. \`docker-compose.yml\` — PostgreSQL service
5. Database models — User, Category, Product, Warehouse, StockLevel, StockTransfer, AuditLog
6. Alembic migrations — Full schema with indexes and constraints
7. Auth system — JWT access/refresh tokens + API key authentication
8. CRUD endpoints — Categories, Products, Warehouses with pagination, filtering, sorting
9. Stock management — Atomic transfers with SELECT FOR UPDATE
10. Audit logging — Activity tracking with user, action, resource details
11. Full-text search — PostgreSQL TSVECTOR with GIN indexing
12. Rate limiting — slowapi with per-endpoint limits
13. Tests — Unit + E2E workflow tests against real PostgreSQL
14. GitHub Actions CI — Lint, format, typecheck, test pipeline`,
    "buildLog": `## Epic Implementation

This PR bootstraps the entire backend — 13 stories building the complete API from scaffold to deployment.

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | ✅ Pass | mypy strict |
| Lint | ✅ Pass | ruff 0 warnings |
| Tests | ✅ Pass | 174 tests |
| Security | ✅ Clean | 0 critical |`
  },
  {
    "id": "sa-2",
    "title": "SAFBS-2: Foundation — build config and project scaffolding",
    "priority": "high",
    "storyCount": 10,
    "duration": "~69 min",
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 2,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/2",
    "commentCount": 1,
    "personas": [
      "backend_developer",
      "frontend_developer",
      "qa_engineer"
    ],
    "description": `### Epic Overview
Build the complete React 19 frontend with TypeScript — dashboard with charts, data tables for products/categories/warehouses/stock/audit, dialogs for CRUD operations, and full API integration with JWT auth.

### Deliverables
1. React 19 + Vite + TypeScript project scaffolding
2. Tailwind CSS v4 dark theme with shadcn/ui components
3. Axios client with JWT interceptor and token refresh
4. Dashboard page with Recharts visualizations (bar, pie, area charts)
5. Products page — data table with search, filters, pagination, create/edit/delete dialogs
6. Categories page — data table with parent category hierarchy
7. Warehouses page — card grid with stock summaries
8. Stock page — stock levels, transfers, adjustments with dialogs
9. Audit page — filterable audit log table
10. API Docs page — links to Swagger/ReDoc`,
    "buildLog": `## Epic Implementation

This PR builds the complete frontend — 10 stories covering all dashboard pages and API integration.

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | ✅ Pass | tsc strict |
| Lint | ✅ Pass | 0 warnings |
| Build | ✅ Pass | vite production build |`
  },
  {
    "id": "sa-3",
    "title": "SAFBS-3: StaticFiles mount and SPA catch-all",
    "priority": "high",
    "storyCount": 4,
    "duration": "~43 min",
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 3,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/3",
    "commentCount": 1,
    "personas": [
      "backend_developer",
      "devops_engineer"
    ],
    "description": `### Epic Overview
Configure FastAPI to serve the React frontend as static files, with SPA catch-all routing, deploy workflow with smoke tests, seed data, and Railway deployment.

### Deliverables
1. StaticFiles mount for \`/assets\` serving frontend build output
2. SPA catch-all \`/{path:path}\` route serving \`index.html\` for React Router
3. Seed script — 50 products, 20 categories, 3 warehouses, 135 stock records, 20 transfers, 50 audit entries
4. Deploy workflow — Railway deploy + health check + 9 smoke tests
5. \`railway.toml\` — preDeployCommand for migrations and seeding`,
    "buildLog": `## Epic Implementation

This PR connects frontend to backend — 4 stories covering static file serving, seeding, and deployment.

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| Deploy | ✅ Pass | Railway |
| Smoke Tests | ✅ Pass | 9/9 |`
  },
  {
    "id": "sa-4",
    "title": "SAFBS-4: Create LandingPage component",
    "priority": "medium",
    "storyCount": 1,
    "duration": "~15 min",
    "status": "deployed",
    "techLeadScore": "8/10",
    "prNumber": 4,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/4",
    "commentCount": 1,
    "personas": [
      "frontend_developer"
    ],
    "description": `### Epic Overview
Create a public landing page at \`/\` with live database metrics, feature highlights, and tech stack display. Move the authenticated dashboard to \`/dashboard\`.

### Deliverables
1. \`LandingPage.tsx\` — Hero section, live stats from \`/showcase/stats\`, feature cards, tech stack badges
2. Route restructure — public \`/\` landing, protected \`/dashboard\` with nested routes
3. Sidebar links updated to \`/dashboard/*\` prefix
4. Login redirect updated to \`/dashboard\``,
    "buildLog": `## Epic Implementation

This PR adds the public landing page — the first thing visitors see.

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | ✅ Pass | |
| Build | ✅ Pass | |`
  },
  {
    "id": "sa-5",
    "title": "SAFBS-5: Compute stock_summary in warehouse list endpoint",
    "priority": "high",
    "storyCount": 5,
    "duration": "~30 min",
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 5,
    "prUrl": "https://github.com/workermill-examples/shipapi/pull/5",
    "commentCount": 1,
    "personas": [
      "backend_developer",
      "frontend_developer",
      "qa_engineer"
    ],
    "description": `### Epic Overview
Fix frontend crashes and data gaps — compute aggregate fields in list endpoints, fix Radix UI SelectItem crashes, wire up dashboard navigation, and add proper dark slate theme.

### Deliverables
1. Backend — \`stock_summary\` computed in warehouse list endpoint (not just detail)
2. Backend — \`product_count\` computed in category list endpoint (not just detail)
3. Frontend — Fix all 10 \`<SelectItem value="">\` instances that crashed Products, Stock, and Audit pages
4. Frontend — Wire up dashboard Quick Action buttons with \`useNavigate()\`
5. Frontend — Dark slate theme CSS variables replacing pure black grayscale`,
    "buildLog": `## Epic Implementation

This PR fixes critical frontend crashes and data display issues — 5 stories across backend and frontend.

### Code Quality

| Metric | Score | Details |
|--------|-------|--------|
| **Overall** | **100%** | |
| TypeCheck | ✅ Pass | |
| Lint | ✅ Pass | 0 warnings |
| Tests | ✅ Pass | All passing |
| Deploy | ✅ Pass | 9/9 smoke tests |`
  }
];
