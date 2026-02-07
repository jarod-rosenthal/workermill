/**
 * Cached Plans for Starter Projects
 *
 * Pre-generated Opus 4.6 execution plans for each starter project.
 * These are served to homepage visitors for instant preview —
 * no live planning needed. Run once, cache forever.
 *
 * Each entry includes:
 *   - plan: The full execution plan (stories, tech stack, quality gates)
 *   - logs: Simulated terminal log lines replayed client-side
 *   - summary/complexity/cost: Pre-computed display data
 */

export interface CachedPlanStory {
  index: number;
  title: string;
  description: string;
  persona: string;
  scope: string;
  acceptanceCriteria: string[];
  dependencies: number[];
  storyPoints: number;
  targetFiles: string[];
  estimatedComplexity: "small" | "medium" | "large";
}

export interface CachedTechStack {
  language: string;
  framework: string;
  styling?: string;
  database?: string;
  testing?: string;
  buildTool?: string;
  rationale: string;
}

export interface CachedPlanData {
  plan: {
    strategy: string;
    reasoning: string;
    stories: CachedPlanStory[];
    techStack: CachedTechStack;
    qualityGates: string[];
  };
  logs: string[];
  summary: {
    storyCount: number;
    personas: string[];
    techStackList: string[];
    reasoning: string;
  };
  complexity: {
    score: number;
    dimensions: { features: number; layers: number; files: number; clarity: number };
  };
  estimatedCost: { local: number; byok: number; cloud: number };
  estimatedDuration: number;
}

// ─── SaaS Analytics Dashboard ──────────────────────────────────────────────

const saasDashboard: CachedPlanData = {
  plan: {
    strategy: "multi",
    reasoning:
      "This is a full-stack SaaS application requiring authentication, multi-tenancy, team management, and interactive visualizations. I'll structure the build foundation-first: database schema and auth, then API layer, then frontend components. The multi-tenant architecture uses org-scoped data access throughout. Charts use Recharts for React-native interactive visualizations.",
    stories: [
      {
        index: 0,
        title: "Project scaffolding and database schema",
        description: "Initialize Next.js project with Prisma, define core data models",
        persona: "backend_developer",
        scope:
          "Create Next.js 14 app with App Router, configure Prisma with PostgreSQL, define User, Organization, Membership, and Metric models with proper relations and indexes",
        acceptanceCriteria: [
          "Next.js 14 app created with App Router and TypeScript strict mode",
          "Prisma schema defines User (id, email, name, passwordHash, createdAt), Organization (id, name, slug, createdAt), Membership (userId, orgId, role enum ADMIN|MEMBER|VIEWER), and Metric (id, orgId, name, value, timestamp) models",
          "prisma migrate dev creates all tables without errors",
          "TailwindCSS configured with custom color palette",
        ],
        dependencies: [],
        storyPoints: 3,
        targetFiles: ["prisma/schema.prisma", "tailwind.config.ts", "src/app/layout.tsx"],
        estimatedComplexity: "medium",
      },
      {
        index: 1,
        title: "Authentication system with JWT",
        description: "Implement signup, login, and session management",
        persona: "backend_developer",
        scope:
          "Create auth API routes for signup (POST /api/auth/signup), login (POST /api/auth/login), and session validation. Use bcrypt for password hashing and JWT for stateless sessions stored in httpOnly cookies",
        acceptanceCriteria: [
          "POST /api/auth/signup creates user with hashed password, returns 201 with user object (no password)",
          "POST /api/auth/login validates credentials, returns 200 with JWT cookie (httpOnly, secure, sameSite=lax)",
          "POST /api/auth/logout clears the JWT cookie, returns 200",
          "Auth middleware extracts JWT from cookie, attaches user to request context",
          "Invalid/expired tokens return 401 Unauthorized",
        ],
        dependencies: [0],
        storyPoints: 3,
        targetFiles: ["src/app/api/auth/signup/route.ts", "src/app/api/auth/login/route.ts", "src/lib/auth.ts"],
        estimatedComplexity: "medium",
      },
      {
        index: 2,
        title: "Organization CRUD and team invites",
        description: "Create and manage organizations, invite members",
        persona: "backend_developer",
        scope:
          "API routes for org creation, member listing, role updates, and invitations. Org creation auto-adds creator as ADMIN. Invite endpoint sends email (stubbed) and creates pending membership",
        acceptanceCriteria: [
          "POST /api/orgs creates organization with auto-generated slug, adds creator as ADMIN, returns 201",
          "GET /api/orgs/:orgId/members returns array of members with roles, requires ADMIN or MEMBER role",
          "PUT /api/orgs/:orgId/members/:userId updates member role, requires ADMIN role",
          "POST /api/orgs/:orgId/invite creates pending membership, requires ADMIN role, returns 201",
          "VIEWER role cannot access member management endpoints (returns 403)",
        ],
        dependencies: [1],
        storyPoints: 3,
        targetFiles: ["src/app/api/orgs/route.ts", "src/app/api/orgs/[orgId]/members/route.ts", "src/lib/permissions.ts"],
        estimatedComplexity: "medium",
      },
      {
        index: 3,
        title: "Metrics ingestion and aggregation API",
        description: "CRUD for metrics with time-range aggregation queries",
        persona: "backend_developer",
        scope:
          "API routes for creating metrics, querying by time range with aggregation (sum, avg, count), and listing available metric names per org. All queries scoped to authenticated user's org",
        acceptanceCriteria: [
          "POST /api/metrics accepts {name, value, timestamp?}, creates metric scoped to user's org, returns 201",
          "GET /api/metrics?from=ISO&to=ISO&name=X&agg=sum returns aggregated metric data grouped by hour/day",
          "GET /api/metrics/names returns unique metric names for the org",
          "All endpoints require authentication and scope data to user's organization",
          "Pagination with cursor-based approach for large datasets (default limit 100)",
        ],
        dependencies: [1],
        storyPoints: 3,
        targetFiles: ["src/app/api/metrics/route.ts", "src/app/api/metrics/names/route.ts", "src/lib/metrics.ts"],
        estimatedComplexity: "medium",
      },
      {
        index: 4,
        title: "Auth pages and layout shell",
        description: "Login, signup pages and authenticated app layout",
        persona: "frontend_developer",
        scope:
          "Create login and signup form pages with validation, authenticated layout with sidebar navigation (Dashboard, Team, Settings), org switcher in header, and route protection",
        acceptanceCriteria: [
          "Login page at /login with email/password fields, validation errors, and submit to POST /api/auth/login",
          "Signup page at /signup with name, email, password fields and client-side validation (min 8 chars password)",
          "Authenticated layout with collapsible sidebar: Dashboard, Team, Settings nav items",
          "Org switcher dropdown in header showing current org name, lists user's orgs",
          "Unauthenticated users redirected to /login, authenticated users redirected from /login to /dashboard",
        ],
        dependencies: [1],
        storyPoints: 3,
        targetFiles: ["src/app/(auth)/login/page.tsx", "src/app/(auth)/signup/page.tsx", "src/app/(dashboard)/layout.tsx"],
        estimatedComplexity: "medium",
      },
      {
        index: 5,
        title: "Dashboard with interactive charts",
        description: "Main dashboard page with metric visualizations",
        persona: "frontend_developer",
        scope:
          "Dashboard page with date range picker, metric selector, and Recharts-powered line/bar/area charts. Fetches data from metrics API and renders responsive visualizations with tooltips",
        acceptanceCriteria: [
          "Dashboard page at /dashboard renders without errors",
          "Date range picker allows selecting from/to dates, defaults to last 7 days",
          "Metric name dropdown populated from GET /api/metrics/names",
          "Line chart shows metric values over time using Recharts with interactive tooltips",
          "Summary cards at top show total, average, min, max for selected metric and range",
          "Charts are responsive and render correctly on tablet (768px) and desktop (1280px)",
        ],
        dependencies: [3, 4],
        storyPoints: 3,
        targetFiles: ["src/app/(dashboard)/dashboard/page.tsx", "src/components/MetricChart.tsx", "src/components/DateRangePicker.tsx"],
        estimatedComplexity: "medium",
      },
      {
        index: 6,
        title: "Team management page",
        description: "View members, change roles, send invites",
        persona: "frontend_developer",
        scope:
          "Team page showing member list with roles, role change dropdown for admins, and invite form with email input. Shows pending invites separately",
        acceptanceCriteria: [
          "Team page at /team renders member list with name, email, role, and joined date",
          "Admin users see role dropdown (ADMIN, MEMBER, VIEWER) next to each member",
          "Invite section with email input and role selector, posts to invite endpoint",
          "Success/error toast notifications for role changes and invitations",
          "VIEWER and MEMBER roles see team list but cannot modify roles or invite",
        ],
        dependencies: [2, 4],
        storyPoints: 2,
        targetFiles: ["src/app/(dashboard)/team/page.tsx", "src/components/MemberRow.tsx"],
        estimatedComplexity: "small",
      },
      {
        index: 7,
        title: "Settings page and org configuration",
        description: "Organization settings with name, slug, and danger zone",
        persona: "frontend_developer",
        scope:
          "Settings page with org name/slug editing, notification preferences, and danger zone (leave org, delete org for admins). Form validation and confirmation dialogs",
        acceptanceCriteria: [
          "Settings page at /settings renders org name and slug in editable form",
          "Save button updates org via PUT /api/orgs/:orgId, shows success toast",
          "Danger zone section with 'Leave Organization' button (confirmation dialog)",
          "Admin-only 'Delete Organization' button with typed-confirmation dialog (type org name)",
          "Form validation prevents empty name or slug with less than 3 characters",
        ],
        dependencies: [4],
        storyPoints: 2,
        targetFiles: ["src/app/(dashboard)/settings/page.tsx", "src/components/ConfirmDialog.tsx"],
        estimatedComplexity: "small",
      },
    ],
    techStack: {
      language: "typescript",
      framework: "next.js",
      styling: "tailwindcss",
      database: "postgresql",
      testing: "vitest",
      buildTool: "next.js",
      rationale:
        "Next.js App Router provides server components for fast initial loads, API routes for backend logic, and excellent TypeScript support. Prisma gives type-safe database access. TailwindCSS enables rapid UI development with consistent design.",
    },
    qualityGates: [
      "TypeScript strict mode — zero type errors",
      "All API routes return proper HTTP status codes",
      "Auth middleware protects all /api and /dashboard routes",
      "RBAC enforced: VIEWER < MEMBER < ADMIN",
      "Responsive layout passes on 768px and 1280px viewports",
    ],
  },
  logs: [
    "Planning agent starting...",
    "Model: claude-opus-4-6 (Anthropic)",
    "Project: SaaS Analytics Dashboard",
    "Analyzing project requirements...",
    "Identified key domains: authentication, multi-tenancy, metrics, visualization",
    "Selecting tech stack: Next.js 14 + Prisma + TailwindCSS + PostgreSQL",
    "Designing database schema: User, Organization, Membership, Metric models",
    "Mapping personas: backend_developer, frontend_developer",
    "Decomposing into stories...",
    "Story 0: Project scaffolding and database schema (3pt, backend_developer)",
    "Story 1: Authentication system with JWT (3pt, backend_developer)",
    "Story 2: Organization CRUD and team invites (3pt, backend_developer)",
    "Story 3: Metrics ingestion and aggregation API (3pt, backend_developer)",
    "Story 4: Auth pages and layout shell (3pt, frontend_developer)",
    "Story 5: Dashboard with interactive charts (3pt, frontend_developer)",
    "Story 6: Team management page (2pt, frontend_developer)",
    "Story 7: Settings page and org configuration (2pt, frontend_developer)",
    "Writing acceptance criteria...",
    "Building dependency graph: 0 → [1,2,3,4] → [5,6,7]",
    "Validating plan: 8 stories, 22 story points, 2 personas",
    "Quality gates: type safety, RBAC, responsive layout",
    "Plan generation complete.",
  ],
  summary: {
    storyCount: 8,
    personas: ["backend_developer", "frontend_developer"],
    techStackList: ["typescript", "next.js", "tailwindcss", "postgresql", "vitest"],
    reasoning:
      "This is a full-stack SaaS application requiring authentication, multi-tenancy, team management, and interactive visualizations. I'll structure the build foundation-first: database schema and auth, then API layer, then frontend components.",
  },
  complexity: { score: 7, dimensions: { features: 2, layers: 2, files: 2, clarity: 1 } },
  estimatedCost: { local: 0, byok: 8.8, cloud: 13.2 },
  estimatedDuration: 40,
};

// ─── REST API with Auth & Docs ─────────────────────────────────────────────

const restApi: CachedPlanData = {
  plan: {
    strategy: "multi",
    reasoning:
      "A production REST API needs a solid foundation layer (project setup, models, auth) before building feature endpoints. FastAPI is ideal here — it auto-generates OpenAPI docs from type annotations, making the 'docs' requirement nearly free. I'll use Pydantic for validation, SQLAlchemy for ORM, and pytest for testing.",
    stories: [
      {
        index: 0,
        title: "Project setup and database models",
        description: "Initialize FastAPI project with SQLAlchemy models",
        persona: "backend_developer",
        scope:
          "Create FastAPI project structure, configure SQLAlchemy with async driver, define User and Post models, create Alembic migration",
        acceptanceCriteria: [
          "FastAPI app starts on port 8000 without errors",
          "SQLAlchemy models: User (id, email, name, password_hash, created_at, is_active), Post (id, user_id FK, title, body, status enum draft|published, created_at, updated_at)",
          "Alembic migration creates both tables successfully",
          "Database URL configurable via DATABASE_URL environment variable",
        ],
        dependencies: [],
        storyPoints: 2,
        targetFiles: ["app/models.py", "app/database.py", "alembic/versions/001_initial.py"],
        estimatedComplexity: "small",
      },
      {
        index: 1,
        title: "JWT authentication endpoints",
        description: "User registration, login, and token management",
        persona: "backend_developer",
        scope:
          "Implement POST /auth/register, POST /auth/login, POST /auth/refresh endpoints with JWT access/refresh token pair. Use bcrypt for password hashing, configurable token expiry",
        acceptanceCriteria: [
          "POST /auth/register creates user, returns 201 with user object (no password), rejects duplicate emails with 409",
          "POST /auth/login accepts email/password, returns {access_token, refresh_token, token_type} with 200",
          "POST /auth/refresh accepts refresh_token in body, returns new access_token with 200",
          "Access token expires in 30 minutes, refresh token in 7 days (configurable via env)",
          "Invalid credentials return 401, validation errors return 422 with field-level details",
        ],
        dependencies: [0],
        storyPoints: 3,
        targetFiles: ["app/routers/auth.py", "app/auth/jwt.py", "app/schemas/auth.py"],
        estimatedComplexity: "medium",
      },
      {
        index: 2,
        title: "Posts CRUD with pagination",
        description: "Full CRUD for posts with cursor pagination and filtering",
        persona: "api_developer",
        scope:
          "Implement GET /posts (list with pagination/filter), POST /posts, GET /posts/{id}, PUT /posts/{id}, DELETE /posts/{id}. All scoped to authenticated user",
        acceptanceCriteria: [
          "GET /posts returns paginated list with ?limit=20&cursor=X&status=published query params",
          "POST /posts creates post for authenticated user, returns 201 with post object",
          "GET /posts/{id} returns single post, 404 if not found",
          "PUT /posts/{id} updates post (only owner), returns 200, 403 if not owner",
          "DELETE /posts/{id} soft-deletes post (only owner), returns 204",
          "All endpoints require valid Bearer token, return 401 without",
        ],
        dependencies: [1],
        storyPoints: 3,
        targetFiles: ["app/routers/posts.py", "app/schemas/posts.py", "app/crud/posts.py"],
        estimatedComplexity: "medium",
      },
      {
        index: 3,
        title: "Rate limiting and error handling",
        description: "Global rate limiter and structured error responses",
        persona: "backend_developer",
        scope:
          "Add slowapi rate limiter (100 req/min per IP, 20/min for auth endpoints), global exception handler returning consistent JSON error format, request ID tracking",
        acceptanceCriteria: [
          "Rate limiter returns 429 with Retry-After header when limit exceeded",
          "Auth endpoints limited to 20 requests/minute per IP",
          "General endpoints limited to 100 requests/minute per IP",
          "All error responses follow format: {detail: string, status_code: number, request_id: string}",
          "X-Request-ID header added to all responses for traceability",
        ],
        dependencies: [0],
        storyPoints: 2,
        targetFiles: ["app/middleware/rate_limit.py", "app/middleware/error_handler.py", "app/middleware/request_id.py"],
        estimatedComplexity: "small",
      },
      {
        index: 4,
        title: "OpenAPI documentation and health check",
        description: "Enhanced API docs with examples and health endpoint",
        persona: "api_developer",
        scope:
          "Configure FastAPI OpenAPI metadata (title, description, version, contact), add request/response examples to all schemas, create GET /health endpoint, add API versioning prefix /v1",
        acceptanceCriteria: [
          "GET /docs renders Swagger UI with all endpoints documented",
          "GET /redoc renders ReDoc alternative documentation",
          "All request/response schemas include example values in OpenAPI spec",
          "GET /health returns {status: 'healthy', version: '1.0.0', uptime_seconds: number}",
          "All routes prefixed with /v1 (e.g., /v1/auth/login, /v1/posts)",
        ],
        dependencies: [2, 3],
        storyPoints: 2,
        targetFiles: ["app/main.py", "app/routers/health.py", "app/schemas/common.py"],
        estimatedComplexity: "small",
      },
      {
        index: 5,
        title: "Test suite with fixtures",
        description: "Comprehensive test coverage for all endpoints",
        persona: "qa_engineer",
        scope:
          "Pytest test suite with async fixtures, test database, and full coverage of auth flow, CRUD operations, rate limiting, and error handling",
        acceptanceCriteria: [
          "pytest runs all tests with 0 failures",
          "Test fixtures: async client, authenticated client, sample user, sample posts",
          "Auth tests: register, login, refresh, duplicate email, invalid credentials",
          "Posts tests: create, read, update, delete, pagination, unauthorized access",
          "Rate limit test: verify 429 response after exceeding limit",
        ],
        dependencies: [4],
        storyPoints: 3,
        targetFiles: ["tests/conftest.py", "tests/test_auth.py", "tests/test_posts.py"],
        estimatedComplexity: "medium",
      },
    ],
    techStack: {
      language: "python",
      framework: "fastapi",
      styling: "n/a",
      database: "postgresql",
      testing: "pytest",
      buildTool: "uv",
      rationale:
        "FastAPI auto-generates OpenAPI documentation from type annotations, satisfying the docs requirement with minimal effort. Async SQLAlchemy provides high-performance database access. Pydantic V2 handles validation.",
    },
    qualityGates: [
      "All pytest tests pass",
      "OpenAPI spec validates without warnings",
      "Rate limiter functional on auth and general routes",
      "No unhandled exceptions — all errors return JSON",
      "Authentication required on all protected endpoints",
    ],
  },
  logs: [
    "Planning agent starting...",
    "Model: claude-opus-4-6 (Anthropic)",
    "Project: REST API with Auth & Docs",
    "Analyzing project requirements...",
    "Core domains: authentication, CRUD operations, documentation, rate limiting",
    "Selecting tech stack: FastAPI + SQLAlchemy + PostgreSQL + pytest",
    "Rationale: FastAPI auto-generates OpenAPI docs from type annotations",
    "Designing models: User, Post with status enum",
    "Mapping personas: backend_developer, api_developer, qa_engineer",
    "Decomposing into stories...",
    "Story 0: Project setup and database models (2pt)",
    "Story 1: JWT authentication endpoints (3pt)",
    "Story 2: Posts CRUD with pagination (3pt)",
    "Story 3: Rate limiting and error handling (2pt)",
    "Story 4: OpenAPI documentation and health check (2pt)",
    "Story 5: Test suite with fixtures (3pt)",
    "Building dependency graph: 0 → [1,3] → [2] → [4,5]",
    "Validating plan: 6 stories, 15 story points, 3 personas",
    "Plan generation complete.",
  ],
  summary: {
    storyCount: 6,
    personas: ["backend_developer", "api_developer", "qa_engineer"],
    techStackList: ["python", "fastapi", "postgresql", "pytest"],
    reasoning:
      "A production REST API needs a solid foundation layer (project setup, models, auth) before building feature endpoints. FastAPI is ideal here — it auto-generates OpenAPI docs from type annotations.",
  },
  complexity: { score: 6, dimensions: { features: 1, layers: 2, files: 2, clarity: 1 } },
  estimatedCost: { local: 0, byok: 6.0, cloud: 9.0 },
  estimatedDuration: 30,
};

// ─── E-Commerce Storefront ─────────────────────────────────────────────────

const ecommerceStore: CachedPlanData = {
  plan: {
    strategy: "multi",
    reasoning:
      "An e-commerce store is a complex multi-layer application. The foundation needs product data models and a seeding mechanism, then the API layer for catalog/cart/checkout, then the storefront UI, and finally the admin panel. Stripe integration is isolated to its own story to contain third-party complexity. I'll use Next.js server components for SEO-friendly product pages.",
    stories: [
      {
        index: 0,
        title: "Database schema and seed data",
        description: "Product, Category, Cart, Order models with sample data",
        persona: "backend_developer",
        scope:
          "Define Prisma schema for Product, Category, CartItem, Order, OrderItem models. Create seed script with 20 sample products across 4 categories",
        acceptanceCriteria: [
          "Prisma schema: Product (id, name, slug, description, price Decimal, imageUrl, categoryId FK, stock Int, createdAt), Category (id, name, slug), CartItem (id, sessionId, productId FK, quantity), Order (id, email, status enum pending|paid|shipped|delivered, total Decimal, stripePaymentId, createdAt), OrderItem (orderId FK, productId FK, quantity, price)",
          "prisma db seed populates 4 categories and 20 products with realistic data",
          "Products have unique slugs generated from names",
        ],
        dependencies: [],
        storyPoints: 3,
        targetFiles: ["prisma/schema.prisma", "prisma/seed.ts", "src/lib/db.ts"],
        estimatedComplexity: "medium",
      },
      {
        index: 1,
        title: "Product catalog API with search",
        description: "List, search, and filter products by category",
        persona: "backend_developer",
        scope:
          "API routes for product listing with category filter, text search, pagination, and single product by slug. Optimized queries with select fields",
        acceptanceCriteria: [
          "GET /api/products returns paginated products (20/page) with ?page=1&category=slug&search=term",
          "GET /api/products/[slug] returns single product with category info, 404 if not found",
          "GET /api/categories returns all categories with product count",
          "Search is case-insensitive and matches product name and description",
          "Response includes totalCount and totalPages for pagination UI",
        ],
        dependencies: [0],
        storyPoints: 3,
        targetFiles: ["src/app/api/products/route.ts", "src/app/api/products/[slug]/route.ts", "src/app/api/categories/route.ts"],
        estimatedComplexity: "medium",
      },
      {
        index: 2,
        title: "Shopping cart with session persistence",
        description: "Add/remove/update cart items, persist across page loads",
        persona: "backend_developer",
        scope:
          "Cart API using anonymous session ID (cookie-based). Add item, update quantity, remove item, get cart with product details and totals",
        acceptanceCriteria: [
          "POST /api/cart/items adds product to cart (creates session cookie if none), returns updated cart",
          "PUT /api/cart/items/[id] updates quantity, returns updated cart",
          "DELETE /api/cart/items/[id] removes item, returns updated cart",
          "GET /api/cart returns cart items with product name, price, quantity, line total, and cart total",
          "Cart persists across page reloads via httpOnly session cookie",
          "Adding item that's already in cart increments quantity",
        ],
        dependencies: [0],
        storyPoints: 3,
        targetFiles: ["src/app/api/cart/items/route.ts", "src/app/api/cart/route.ts", "src/lib/session.ts"],
        estimatedComplexity: "medium",
      },
      {
        index: 3,
        title: "Storefront product listing and detail pages",
        description: "Product grid with filters and individual product pages",
        persona: "frontend_developer",
        scope:
          "Product listing page with category sidebar, search bar, and responsive product grid. Product detail page with image, description, price, stock status, and add-to-cart button",
        acceptanceCriteria: [
          "Homepage at / shows featured products grid (4 cols desktop, 2 cols mobile)",
          "Category sidebar filters products; active category highlighted",
          "Search bar filters products with debounced input (300ms)",
          "Product card shows image, name, price, and 'Add to Cart' button",
          "Product detail at /products/[slug] shows full description, stock status, quantity selector",
          "SEO: product detail pages use server components with proper meta tags",
        ],
        dependencies: [1],
        storyPoints: 3,
        targetFiles: ["src/app/page.tsx", "src/app/products/[slug]/page.tsx", "src/components/ProductCard.tsx"],
        estimatedComplexity: "medium",
      },
      {
        index: 4,
        title: "Cart drawer and checkout page",
        description: "Slide-out cart and multi-step checkout",
        persona: "frontend_developer",
        scope:
          "Cart drawer component showing items, quantities, and total. Checkout page with email input and order summary. Cart icon in header with item count badge",
        acceptanceCriteria: [
          "Cart icon in header shows item count badge, clicking opens slide-out drawer",
          "Cart drawer lists items with quantity +/- controls and remove button",
          "Cart total updates immediately on quantity change",
          "'Proceed to Checkout' button navigates to /checkout",
          "Checkout page shows order summary, email input field, and 'Pay with Stripe' button",
          "Empty cart shows 'Your cart is empty' with link to browse products",
        ],
        dependencies: [2, 3],
        storyPoints: 3,
        targetFiles: ["src/components/CartDrawer.tsx", "src/app/checkout/page.tsx", "src/components/CartIcon.tsx"],
        estimatedComplexity: "medium",
      },
      {
        index: 5,
        title: "Stripe checkout integration",
        description: "Create Stripe session and handle payment webhooks",
        persona: "backend_developer",
        scope:
          "Stripe Checkout Session creation from cart, success/cancel redirect handling, webhook endpoint for payment confirmation that creates Order record",
        acceptanceCriteria: [
          "POST /api/checkout creates Stripe Checkout Session with cart line items, returns session URL",
          "Stripe session includes product images, names, and correct prices in cents",
          "GET /api/checkout/success?session_id=X verifies payment, creates Order with items, clears cart",
          "POST /api/webhooks/stripe handles checkout.session.completed event, updates order status to 'paid'",
          "Webhook validates Stripe signature, returns 400 on invalid signature",
          "Order confirmation page at /orders/[id] shows order details and status",
        ],
        dependencies: [2],
        storyPoints: 3,
        targetFiles: ["src/app/api/checkout/route.ts", "src/app/api/webhooks/stripe/route.ts", "src/app/orders/[id]/page.tsx"],
        estimatedComplexity: "large",
      },
      {
        index: 6,
        title: "Admin product management panel",
        description: "Admin pages for managing products and viewing orders",
        persona: "frontend_developer",
        scope:
          "Admin layout at /admin with product CRUD table (add, edit, delete) and orders list with status. Protected by admin auth check",
        acceptanceCriteria: [
          "Admin layout at /admin with sidebar: Products, Orders nav items",
          "Products page shows table with name, price, stock, category, actions (edit, delete)",
          "Add/Edit product form with name, description, price, stock, category, image URL fields",
          "Orders page shows list with order ID, email, total, status, date, item count",
          "Order detail view shows line items and shipping status",
          "Admin routes return 403 for non-admin users",
        ],
        dependencies: [5],
        storyPoints: 3,
        targetFiles: ["src/app/admin/products/page.tsx", "src/app/admin/orders/page.tsx", "src/app/admin/layout.tsx"],
        estimatedComplexity: "medium",
      },
      {
        index: 7,
        title: "Product image gallery component",
        description: "Multi-image gallery with thumbnail navigation",
        persona: "frontend_developer",
        scope:
          "Image gallery component for product detail page with main image, thumbnail strip, zoom on hover, and keyboard navigation",
        acceptanceCriteria: [
          "Gallery shows main image with thumbnail strip below",
          "Clicking thumbnail updates main image with smooth transition",
          "Left/Right arrow keys navigate between images",
          "Main image supports hover-to-zoom (2x magnification)",
          "Graceful fallback for products with single image",
        ],
        dependencies: [3],
        storyPoints: 2,
        targetFiles: ["src/components/ImageGallery.tsx", "src/components/ZoomableImage.tsx"],
        estimatedComplexity: "small",
      },
      {
        index: 8,
        title: "Store header and navigation",
        description: "Responsive store header with category nav and cart",
        persona: "frontend_developer",
        scope:
          "Store header with logo, category navigation links, search input, and cart icon. Mobile hamburger menu. Sticky on scroll",
        acceptanceCriteria: [
          "Header is sticky with backdrop blur on scroll",
          "Desktop: logo left, category nav center, search + cart right",
          "Mobile: hamburger menu toggles category nav drawer",
          "Search input expands on focus, collapses on blur (desktop)",
          "Active category link highlighted in navigation",
        ],
        dependencies: [1],
        storyPoints: 2,
        targetFiles: ["src/components/StoreHeader.tsx", "src/components/MobileMenu.tsx"],
        estimatedComplexity: "small",
      },
      {
        index: 9,
        title: "Order confirmation email template",
        description: "HTML email sent on successful order",
        persona: "backend_developer",
        scope:
          "Order confirmation email template with order details, line items, and total. Sent via Resend (or stubbed) on payment success",
        acceptanceCriteria: [
          "Email sent to customer on payment confirmation",
          "Email includes order number, items with prices, total, and estimated delivery",
          "HTML email renders correctly in Gmail and Outlook (inline styles)",
          "Email sending function is async and doesn't block the webhook response",
        ],
        dependencies: [5],
        storyPoints: 2,
        targetFiles: ["src/lib/email.ts", "src/templates/order-confirmation.tsx"],
        estimatedComplexity: "small",
      },
      {
        index: 10,
        title: "Product search with filters UI",
        description: "Advanced search with price range and sort options",
        persona: "frontend_developer",
        scope:
          "Search results page with price range slider, sort dropdown (price low-high, price high-low, newest, popular), and active filter chips",
        acceptanceCriteria: [
          "Search results page at /search?q=X shows matching products",
          "Price range filter with min/max slider",
          "Sort dropdown: Price Low→High, Price High→Low, Newest, Most Popular",
          "Active filters shown as chips with X to remove",
          "URL updates with filter params for shareable search links",
        ],
        dependencies: [3],
        storyPoints: 2,
        targetFiles: ["src/app/search/page.tsx", "src/components/FilterSidebar.tsx"],
        estimatedComplexity: "small",
      },
      {
        index: 11,
        title: "SEO and performance optimization",
        description: "Meta tags, structured data, and image optimization",
        persona: "frontend_developer",
        scope:
          "Add JSON-LD structured data for products, OpenGraph meta tags, sitemap.xml generation, and Next.js Image component optimization",
        acceptanceCriteria: [
          "Product pages include JSON-LD Product schema markup",
          "OpenGraph meta tags (og:title, og:description, og:image) on product pages",
          "GET /sitemap.xml dynamically generated from products and categories",
          "All product images use next/image with proper width, height, and alt text",
          "Lighthouse Performance score > 90 on product listing page",
        ],
        dependencies: [3],
        storyPoints: 2,
        targetFiles: ["src/app/products/[slug]/layout.tsx", "src/app/sitemap.ts", "src/components/ProductJsonLd.tsx"],
        estimatedComplexity: "small",
      },
    ],
    techStack: {
      language: "typescript",
      framework: "next.js",
      styling: "tailwindcss",
      database: "postgresql",
      testing: "vitest",
      buildTool: "next.js",
      rationale:
        "Next.js server components give SEO-friendly product pages with fast initial loads. Prisma provides type-safe product queries. Stripe integration is well-supported in the Next.js ecosystem. TailwindCSS enables rapid responsive UI development.",
    },
    qualityGates: [
      "TypeScript strict mode — zero type errors",
      "All API routes return proper HTTP status codes",
      "Cart persists across page reloads",
      "Stripe webhook validates signatures",
      "Product pages render with proper SEO meta tags",
      "Responsive layout: mobile (375px), tablet (768px), desktop (1280px)",
    ],
  },
  logs: [
    "Planning agent starting...",
    "Model: claude-opus-4-6 (Anthropic)",
    "Project: E-Commerce Storefront",
    "Analyzing project requirements...",
    "Complex multi-layer application: catalog, cart, checkout, admin, search",
    "Selecting tech stack: Next.js + Prisma + TailwindCSS + Stripe",
    "Designing schema: Product, Category, CartItem, Order, OrderItem",
    "Decomposing into stories...",
    "Story 0: Database schema and seed data (3pt, backend_developer)",
    "Story 1: Product catalog API with search (3pt, backend_developer)",
    "Story 2: Shopping cart with session persistence (3pt, backend_developer)",
    "Story 3: Storefront product listing and detail pages (3pt, frontend_developer)",
    "Story 4: Cart drawer and checkout page (3pt, frontend_developer)",
    "Story 5: Stripe checkout integration (3pt, backend_developer)",
    "Story 6: Admin product management panel (3pt, frontend_developer)",
    "Story 7: Product image gallery component (2pt, frontend_developer)",
    "Story 8: Store header and navigation (2pt, frontend_developer)",
    "Story 9: Order confirmation email template (2pt, backend_developer)",
    "Story 10: Product search with filters UI (2pt, frontend_developer)",
    "Story 11: SEO and performance optimization (2pt, frontend_developer)",
    "Writing acceptance criteria...",
    "Building dependency graph: 0 → [1,2] → [3,4,5] → [6,7,8,9,10,11]",
    "Validating plan: 12 stories, 30 story points, 2 personas",
    "Quality gates: type safety, cart persistence, Stripe webhook, SEO, responsive",
    "Plan generation complete.",
  ],
  summary: {
    storyCount: 12,
    personas: ["backend_developer", "frontend_developer"],
    techStackList: ["typescript", "next.js", "tailwindcss", "postgresql", "vitest"],
    reasoning:
      "An e-commerce store is a complex multi-layer application. The foundation needs product data models, then the API layer for catalog/cart/checkout, then the storefront UI, and finally the admin panel.",
  },
  complexity: { score: 9, dimensions: { features: 2, layers: 2, files: 3, clarity: 2 } },
  estimatedCost: { local: 0, byok: 12.0, cloud: 18.0 },
  estimatedDuration: 60,
};

// ─── Blog Platform with CMS ───────────────────────────────────────────────

const blogPlatform: CachedPlanData = {
  plan: {
    strategy: "multi",
    reasoning:
      "A blog platform has two distinct surfaces: the CMS for authors (write, preview, publish) and the public blog (read, browse, subscribe). Django's admin and ORM give us a strong CMS foundation. The markdown pipeline is central — it powers both the live preview in the editor and the rendered HTML on the public site. I'll add SEO features (meta tags, RSS, sitemap) as a dedicated story.",
    stories: [
      {
        index: 0,
        title: "Django project setup and models",
        description: "Initialize Django project, define Post and Tag models",
        persona: "backend_developer",
        scope:
          "Create Django project with PostgreSQL, define Post model (title, slug, body markdown, excerpt, status, author FK, published_at, created_at, updated_at, meta_description), Tag model (name, slug), M2M relation",
        acceptanceCriteria: [
          "Django project created with PostgreSQL database configured",
          "Post model: title (CharField 200), slug (SlugField unique), body (TextField, markdown), excerpt (TextField 500), status (CharField choices: draft/published), author (ForeignKey User), published_at (DateTimeField nullable), meta_description (CharField 160)",
          "Tag model: name (CharField 50 unique), slug (SlugField unique)",
          "Post-Tag M2M through table created",
          "python manage.py migrate runs without errors",
        ],
        dependencies: [],
        storyPoints: 2,
        targetFiles: ["blog/models.py", "config/settings.py", "blog/admin.py"],
        estimatedComplexity: "small",
      },
      {
        index: 1,
        title: "REST API for posts and tags",
        description: "DRF serializers and viewsets for CRUD operations",
        persona: "backend_developer",
        scope:
          "Django REST Framework viewsets for Post CRUD (author-scoped), Tag CRUD, publish/unpublish actions. Serializers with nested tag data",
        acceptanceCriteria: [
          "GET /api/posts/ returns author's posts with status filter, pagination (20/page)",
          "POST /api/posts/ creates draft post for authenticated author",
          "PUT /api/posts/{id}/ updates post (only author), PATCH for partial update",
          "POST /api/posts/{id}/publish/ sets status=published and published_at=now",
          "POST /api/posts/{id}/unpublish/ sets status=draft, clears published_at",
          "GET/POST /api/tags/ for tag CRUD, DELETE /api/tags/{id}/ removes tag",
          "All endpoints require authentication, return 401 without token",
        ],
        dependencies: [0],
        storyPoints: 3,
        targetFiles: ["blog/serializers.py", "blog/views.py", "blog/urls.py"],
        estimatedComplexity: "medium",
      },
      {
        index: 2,
        title: "Markdown editor with live preview",
        description: "React editor component with split-pane preview",
        persona: "frontend_developer",
        scope:
          "Markdown editor with CodeMirror, live preview pane using remark/rehype pipeline, toolbar for common formatting (bold, italic, heading, link, image, code block)",
        acceptanceCriteria: [
          "Editor page at /editor/:id renders CodeMirror markdown editor on left, rendered HTML preview on right",
          "Preview updates in real-time as user types (debounced 200ms)",
          "Toolbar buttons: Bold, Italic, H1-H3, Link, Image, Code Block, Quote",
          "Editor supports keyboard shortcuts: Cmd+B bold, Cmd+I italic, Cmd+K link",
          "Auto-saves draft every 30 seconds via PUT /api/posts/{id}/",
          "Responsive: on mobile, tabs switch between Edit and Preview modes",
        ],
        dependencies: [1],
        storyPoints: 3,
        targetFiles: ["frontend/src/pages/Editor.tsx", "frontend/src/components/MarkdownPreview.tsx", "frontend/src/components/EditorToolbar.tsx"],
        estimatedComplexity: "medium",
      },
      {
        index: 3,
        title: "Author dashboard",
        description: "Post management interface with draft/published views",
        persona: "frontend_developer",
        scope:
          "Dashboard at /dashboard with post list (sortable by date, filterable by status), draft/published tabs, post actions (edit, publish, unpublish, delete), and new post button",
        acceptanceCriteria: [
          "Dashboard at /dashboard shows list of author's posts",
          "Tabs: All, Drafts, Published with correct counts",
          "Post row shows title, status badge, published date, word count, actions dropdown",
          "New Post button creates draft via API and navigates to /editor/:id",
          "Publish/Unpublish toggle in actions dropdown with confirmation",
          "Delete with confirmation dialog",
        ],
        dependencies: [1],
        storyPoints: 3,
        targetFiles: ["frontend/src/pages/Dashboard.tsx", "frontend/src/components/PostRow.tsx", "frontend/src/components/PostActions.tsx"],
        estimatedComplexity: "medium",
      },
      {
        index: 4,
        title: "Public blog index and post pages",
        description: "Server-rendered blog pages with SEO",
        persona: "frontend_developer",
        scope:
          "Public blog index at / with post cards (title, excerpt, date, tags), individual post pages at /posts/:slug with rendered markdown, tag filtering at /tags/:slug",
        acceptanceCriteria: [
          "Blog index at / shows published posts as cards with title, excerpt, date, author, tags",
          "Posts sorted by published_at descending, paginated (10/page)",
          "Post page at /posts/:slug renders markdown as HTML with syntax-highlighted code blocks",
          "Tag page at /tags/:slug shows posts filtered by tag",
          "Author byline with avatar and name on post pages",
          "Reading time estimate displayed (based on word count / 200 wpm)",
        ],
        dependencies: [1],
        storyPoints: 3,
        targetFiles: ["frontend/src/pages/BlogIndex.tsx", "frontend/src/pages/BlogPost.tsx", "frontend/src/pages/TagPage.tsx"],
        estimatedComplexity: "medium",
      },
      {
        index: 5,
        title: "SEO meta tags and RSS feed",
        description: "OpenGraph tags, JSON-LD, sitemap, and RSS",
        persona: "backend_developer",
        scope:
          "Add meta tags to post pages (og:title, og:description, og:image, twitter:card), generate RSS feed at /feed.xml, sitemap at /sitemap.xml, canonical URLs",
        acceptanceCriteria: [
          "Post pages include og:title, og:description, og:type=article meta tags",
          "GET /feed.xml returns valid RSS 2.0 feed with 20 most recent published posts",
          "GET /sitemap.xml lists all published post URLs with lastmod dates",
          "Canonical URL set on each post page",
          "meta_description field used for og:description (falls back to excerpt)",
          "RSS feed auto-discovery link in HTML head",
        ],
        dependencies: [4],
        storyPoints: 2,
        targetFiles: ["blog/feeds.py", "blog/sitemaps.py", "frontend/src/components/PostMeta.tsx"],
        estimatedComplexity: "small",
      },
      {
        index: 6,
        title: "Tag management and filtering",
        description: "Tag CRUD in dashboard and public tag cloud",
        persona: "frontend_developer",
        scope:
          "Tag management in editor (add/remove tags, autocomplete), tag cloud on blog sidebar showing popular tags, tag filtering on index",
        acceptanceCriteria: [
          "Editor has tag input with autocomplete from existing tags",
          "New tags created inline if they don't exist",
          "Blog sidebar shows tag cloud with top 15 tags sized by post count",
          "Clicking tag navigates to /tags/:slug filtered view",
          "Tags displayed as chips on post cards and post pages",
        ],
        dependencies: [2, 4],
        storyPoints: 2,
        targetFiles: ["frontend/src/components/TagInput.tsx", "frontend/src/components/TagCloud.tsx"],
        estimatedComplexity: "small",
      },
      {
        index: 7,
        title: "Authentication and author profiles",
        description: "Login/register and public author pages",
        persona: "backend_developer",
        scope:
          "JWT auth for CMS access, public author profile page with bio and post list, profile editing in dashboard settings",
        acceptanceCriteria: [
          "POST /api/auth/login returns JWT access and refresh tokens",
          "POST /api/auth/register creates author account",
          "Public author page at /authors/:username shows bio, avatar, and published posts",
          "Profile settings page for editing display name, bio, avatar URL",
          "Protected routes redirect to login page for unauthenticated users",
        ],
        dependencies: [0],
        storyPoints: 3,
        targetFiles: ["accounts/views.py", "accounts/serializers.py", "frontend/src/pages/AuthorProfile.tsx"],
        estimatedComplexity: "medium",
      },
    ],
    techStack: {
      language: "python",
      framework: "django",
      styling: "tailwindcss",
      database: "postgresql",
      testing: "pytest",
      buildTool: "vite",
      rationale:
        "Django's ORM and admin give a strong CMS foundation. DRF provides the API layer with minimal boilerplate. React frontend with Vite for the editor and public blog. TailwindCSS for rapid, consistent styling.",
    },
    qualityGates: [
      "All API endpoints return proper status codes",
      "Markdown renders identically in editor preview and public pages",
      "SEO: RSS feed validates, sitemap lists all published posts",
      "Auth: protected routes enforce authentication",
      "Blog index loads in under 2 seconds",
    ],
  },
  logs: [
    "Planning agent starting...",
    "Model: claude-opus-4-6 (Anthropic)",
    "Project: Blog Platform with CMS",
    "Analyzing project requirements...",
    "Two surfaces: CMS (authors) and public blog (readers)",
    "Selecting tech stack: Django + DRF + React + PostgreSQL",
    "Core pipeline: Markdown → remark/rehype → HTML (shared editor + public)",
    "Designing models: Post, Tag, Author with M2M relations",
    "Decomposing into stories...",
    "Story 0: Django project setup and models (2pt)",
    "Story 1: REST API for posts and tags (3pt)",
    "Story 2: Markdown editor with live preview (3pt)",
    "Story 3: Author dashboard (3pt)",
    "Story 4: Public blog index and post pages (3pt)",
    "Story 5: SEO meta tags and RSS feed (2pt)",
    "Story 6: Tag management and filtering (2pt)",
    "Story 7: Authentication and author profiles (3pt)",
    "Building dependency graph: 0 → [1,7] → [2,3,4] → [5,6]",
    "Validating plan: 8 stories, 21 story points, 2 personas",
    "Plan generation complete.",
  ],
  summary: {
    storyCount: 8,
    personas: ["backend_developer", "frontend_developer"],
    techStackList: ["python", "django", "tailwindcss", "postgresql", "pytest", "vite"],
    reasoning:
      "A blog platform has two distinct surfaces: the CMS for authors and the public blog. Django's ORM and admin give a strong CMS foundation. The markdown pipeline is central — it powers both the live preview and the rendered public pages.",
  },
  complexity: { score: 7, dimensions: { features: 2, layers: 2, files: 2, clarity: 1 } },
  estimatedCost: { local: 0, byok: 8.4, cloud: 12.6 },
  estimatedDuration: 40,
};

// ─── Project Management Board ──────────────────────────────────────────────

const projectTracker: CachedPlanData = {
  plan: {
    strategy: "multi",
    reasoning:
      "A Kanban board requires real-time collaboration, drag-and-drop interactions, and optimistic UI updates. I'll use WebSockets (Socket.io) for real-time card movements and Express with TypeORM for the backend. The drag-and-drop library @dnd-kit provides accessible, performant Kanban interactions. Foundation first (models, auth), then API, then the interactive board UI.",
    stories: [
      {
        index: 0,
        title: "Project setup and data models",
        description: "Express + TypeORM project with Board, Column, Task models",
        persona: "backend_developer",
        scope:
          "Initialize Express + TypeORM project, define Board, Column, Task, User models with proper relations and ordering",
        acceptanceCriteria: [
          "Express server starts on port 3000",
          "TypeORM entities: Board (id, name, ownerId FK, createdAt), Column (id, boardId FK, name, position Int), Task (id, columnId FK, title, description, assigneeId FK nullable, dueDate nullable, position Int, createdAt), User (id, email, name, passwordHash)",
          "Migration creates all tables with proper foreign keys and indexes",
          "Position fields enable drag-and-drop ordering",
        ],
        dependencies: [],
        storyPoints: 2,
        targetFiles: ["src/entities/Board.ts", "src/entities/Task.ts", "src/migrations/001-initial.ts"],
        estimatedComplexity: "small",
      },
      {
        index: 1,
        title: "Authentication and user management",
        description: "JWT auth with signup, login, and user lookup",
        persona: "backend_developer",
        scope:
          "Auth endpoints for signup, login, token refresh. Middleware for protected routes. User search endpoint for assignee picker",
        acceptanceCriteria: [
          "POST /api/auth/signup creates user, returns JWT",
          "POST /api/auth/login validates credentials, returns JWT",
          "GET /api/users/search?q=name returns matching users for assignee picker",
          "Auth middleware protects all /api/boards/* routes",
          "Tokens expire in 24 hours, refresh endpoint extends session",
        ],
        dependencies: [0],
        storyPoints: 2,
        targetFiles: ["src/routes/auth.ts", "src/middleware/auth.ts", "src/routes/users.ts"],
        estimatedComplexity: "small",
      },
      {
        index: 2,
        title: "Board and column CRUD API",
        description: "Create boards, manage columns, reorder",
        persona: "backend_developer",
        scope:
          "CRUD for boards and columns. Board creation initializes default columns (To Do, In Progress, Done). Column reordering via position updates",
        acceptanceCriteria: [
          "POST /api/boards creates board with 3 default columns, returns board with columns",
          "GET /api/boards returns user's boards (owned + member)",
          "GET /api/boards/:id returns board with columns and tasks (ordered by position)",
          "POST /api/boards/:id/columns adds column at end",
          "PUT /api/boards/:id/columns/:colId updates column name or position",
          "DELETE /api/boards/:id/columns/:colId moves tasks to first column, then deletes",
        ],
        dependencies: [1],
        storyPoints: 3,
        targetFiles: ["src/routes/boards.ts", "src/routes/columns.ts", "src/services/board.ts"],
        estimatedComplexity: "medium",
      },
      {
        index: 3,
        title: "Task CRUD and move operations",
        description: "Create, update, delete tasks and move between columns",
        persona: "backend_developer",
        scope:
          "Task CRUD endpoints plus move endpoint that handles cross-column moves with position recalculation. Optimistic locking to prevent race conditions",
        acceptanceCriteria: [
          "POST /api/tasks creates task in specified column at bottom position",
          "PUT /api/tasks/:id updates title, description, assignee, dueDate",
          "DELETE /api/tasks/:id removes task and recalculates positions in column",
          "POST /api/tasks/:id/move accepts {columnId, position}, moves task and recalculates positions in source and target columns",
          "Move endpoint returns updated positions for both columns (for optimistic UI reconciliation)",
        ],
        dependencies: [2],
        storyPoints: 3,
        targetFiles: ["src/routes/tasks.ts", "src/services/task.ts", "src/services/position.ts"],
        estimatedComplexity: "medium",
      },
      {
        index: 4,
        title: "WebSocket real-time updates",
        description: "Socket.io for live board updates across clients",
        persona: "backend_developer",
        scope:
          "Socket.io server integrated with Express. Board rooms for scoped broadcasts. Events for task-created, task-moved, task-updated, task-deleted, column-updated",
        acceptanceCriteria: [
          "Socket.io server runs alongside Express on same port",
          "Clients join board room on connect, leave on disconnect",
          "task:moved event broadcasts new positions to all room members except sender",
          "task:created, task:updated, task:deleted events broadcast to room",
          "column:updated event broadcasts column name/position changes",
          "Auth token validated on WebSocket connection handshake",
        ],
        dependencies: [3],
        storyPoints: 3,
        targetFiles: ["src/websocket/index.ts", "src/websocket/board-room.ts", "src/websocket/events.ts"],
        estimatedComplexity: "medium",
      },
      {
        index: 5,
        title: "Kanban board UI with drag-and-drop",
        description: "Interactive board with @dnd-kit columns and cards",
        persona: "frontend_developer",
        scope:
          "Board page with draggable columns and task cards using @dnd-kit. Columns render vertically, cards stack within columns. Drag cards between columns and reorder within columns",
        acceptanceCriteria: [
          "Board page at /boards/:id renders columns side-by-side with task cards",
          "Tasks are draggable within and between columns using @dnd-kit",
          "Drop indicator shows insertion point during drag",
          "Optimistic UI: card moves instantly, syncs with server, reverts on failure",
          "Empty column shows 'Drop tasks here' placeholder",
          "Column header shows task count and column name",
        ],
        dependencies: [3],
        storyPoints: 3,
        targetFiles: ["src/pages/Board.tsx", "src/components/KanbanColumn.tsx", "src/components/TaskCard.tsx"],
        estimatedComplexity: "large",
      },
      {
        index: 6,
        title: "Task detail modal and editing",
        description: "Click-to-open task detail with editing",
        persona: "frontend_developer",
        scope:
          "Modal overlay for task details — editable title, description (markdown), assignee picker, due date picker, delete button. Opens on card click",
        acceptanceCriteria: [
          "Clicking task card opens detail modal with current task data",
          "Title inline-editable (click to edit, blur to save)",
          "Description supports markdown with preview toggle",
          "Assignee picker searches users via /api/users/search with debounced input",
          "Due date picker with calendar widget, overdue dates highlighted red",
          "Delete button with 'Are you sure?' confirmation",
          "Modal closes on Escape key or backdrop click",
        ],
        dependencies: [5],
        storyPoints: 3,
        targetFiles: ["src/components/TaskDetailModal.tsx", "src/components/AssigneePicker.tsx", "src/components/DatePicker.tsx"],
        estimatedComplexity: "medium",
      },
      {
        index: 7,
        title: "Real-time integration and board list",
        description: "Connect WebSocket to UI and board management page",
        persona: "frontend_developer",
        scope:
          "Socket.io client integration — listen for events, update board state. Board list page showing user's boards with create new board button",
        acceptanceCriteria: [
          "Board list at /boards shows user's boards as cards with name, column count, task count",
          "Create New Board button opens name input, creates via API, navigates to board",
          "WebSocket connects on board page mount, disconnects on unmount",
          "Remote task:moved events animate card to new position smoothly",
          "Remote task:created events add card with brief highlight animation",
          "Connection status indicator (green dot = connected, red = disconnected)",
        ],
        dependencies: [4, 6],
        storyPoints: 3,
        targetFiles: ["src/pages/BoardList.tsx", "src/hooks/useWebSocket.ts", "src/stores/boardStore.ts"],
        estimatedComplexity: "medium",
      },
      {
        index: 8,
        title: "Auth pages and app layout",
        description: "Login, signup pages and authenticated navigation",
        persona: "frontend_developer",
        scope:
          "Login and signup form pages, app layout with header (board name, members avatars, invite button), and route protection",
        acceptanceCriteria: [
          "Login page at /login with email/password, error display",
          "Signup page at /signup with name, email, password, confirm password",
          "App header shows current board name (on board page) or 'My Boards' (on list)",
          "Member avatars shown in header with +N overflow indicator",
          "Unauthenticated routes redirect to /login",
        ],
        dependencies: [1],
        storyPoints: 2,
        targetFiles: ["src/pages/Login.tsx", "src/pages/Signup.tsx", "src/components/AppHeader.tsx"],
        estimatedComplexity: "small",
      },
    ],
    techStack: {
      language: "typescript",
      framework: "express",
      styling: "tailwindcss",
      database: "postgresql",
      testing: "vitest",
      buildTool: "vite",
      rationale:
        "Express + Socket.io provides the real-time WebSocket layer needed for live collaboration. @dnd-kit gives accessible, performant drag-and-drop. TypeORM handles the relational data model. React + Vite for the SPA frontend.",
    },
    qualityGates: [
      "TypeScript strict mode — zero type errors",
      "Drag-and-drop works across columns without errors",
      "Real-time updates propagate to all connected clients within 500ms",
      "Optimistic UI reverts gracefully on server failure",
      "Board loads with 100 tasks in under 1 second",
    ],
  },
  logs: [
    "Planning agent starting...",
    "Model: claude-opus-4-6 (Anthropic)",
    "Project: Project Management Board",
    "Analyzing project requirements...",
    "Real-time collaboration + drag-and-drop = Socket.io + @dnd-kit",
    "Selecting tech stack: Express + TypeORM + React + Socket.io",
    "Designing models: Board, Column, Task with position ordering",
    "Mapping personas: backend_developer, frontend_developer",
    "Decomposing into stories...",
    "Story 0: Project setup and data models (2pt)",
    "Story 1: Authentication and user management (2pt)",
    "Story 2: Board and column CRUD API (3pt)",
    "Story 3: Task CRUD and move operations (3pt)",
    "Story 4: WebSocket real-time updates (3pt)",
    "Story 5: Kanban board UI with drag-and-drop (3pt)",
    "Story 6: Task detail modal and editing (3pt)",
    "Story 7: Real-time integration and board list (3pt)",
    "Story 8: Auth pages and app layout (2pt)",
    "Writing acceptance criteria...",
    "Building dependency graph: 0 → 1 → [2,8] → [3] → [4,5] → [6] → [7]",
    "Validating plan: 9 stories, 24 story points, 2 personas",
    "Quality gates: type safety, real-time sync, drag-and-drop, performance",
    "Plan generation complete.",
  ],
  summary: {
    storyCount: 9,
    personas: ["backend_developer", "frontend_developer"],
    techStackList: ["typescript", "express", "tailwindcss", "postgresql", "vitest", "vite"],
    reasoning:
      "A Kanban board requires real-time collaboration, drag-and-drop interactions, and optimistic UI updates. Socket.io for real-time, @dnd-kit for drag-and-drop, Express + TypeORM for the backend.",
  },
  complexity: { score: 8, dimensions: { features: 2, layers: 2, files: 3, clarity: 1 } },
  estimatedCost: { local: 0, byok: 9.6, cloud: 14.4 },
  estimatedDuration: 45,
};

// ─── Developer CLI Tool ────────────────────────────────────────────────────

const cliTool: CachedPlanData = {
  plan: {
    strategy: "multi",
    reasoning:
      "A CLI tool in Go is straightforward: cobra for commands, viper for config, and bubbletea/lipgloss for interactive TUI elements. The architecture follows cobra conventions — root command, subcommands, persistent flags. I'll build foundation (project + root command), then individual commands, then polish (colors, spinners, help docs).",
    stories: [
      {
        index: 0,
        title: "Project setup and root command",
        description: "Initialize Go module with cobra root command",
        persona: "backend_developer",
        scope:
          "Create Go module, set up cobra root command with version flag, configure viper for dotfile config (~/.myapp.yaml), add Makefile with build/test/lint targets",
        acceptanceCriteria: [
          "go build produces myapp binary without errors",
          "myapp --version prints version string (e.g., myapp v0.1.0)",
          "myapp --help shows usage with available commands listed",
          "Viper reads config from ~/.myapp.yaml and merges with env vars (MYAPP_ prefix)",
          "Makefile targets: build, test, lint, install",
        ],
        dependencies: [],
        storyPoints: 2,
        targetFiles: ["cmd/root.go", "main.go", "Makefile"],
        estimatedComplexity: "small",
      },
      {
        index: 1,
        title: "Init command with project scaffolding",
        description: "Interactive init command that creates project structure",
        persona: "backend_developer",
        scope:
          "myapp init command with interactive prompts (project name, template selection, directory). Creates project directory with template files from embedded FS",
        acceptanceCriteria: [
          "myapp init prompts for project name (default: current directory name)",
          "Template selection prompt offers 3 templates: basic, api, fullstack",
          "Creates project directory with template files (README.md, .gitignore, config file)",
          "Non-interactive mode: myapp init --name myproject --template basic skips prompts",
          "Exits with error if target directory already exists (unless --force)",
          "Success message shows created files and next steps",
        ],
        dependencies: [0],
        storyPoints: 3,
        targetFiles: ["cmd/init.go", "internal/scaffold/templates.go", "internal/scaffold/scaffold.go"],
        estimatedComplexity: "medium",
      },
      {
        index: 2,
        title: "Config command for settings management",
        description: "Get, set, list, and reset configuration values",
        persona: "backend_developer",
        scope:
          "myapp config subcommands: get KEY, set KEY VALUE, list, reset. Reads/writes ~/.myapp.yaml with proper file permissions",
        acceptanceCriteria: [
          "myapp config set KEY VALUE writes to ~/.myapp.yaml, creates file if not exists",
          "myapp config get KEY prints value, exits 1 with message if key not found",
          "myapp config list prints all config values in KEY=VALUE format",
          "myapp config reset removes ~/.myapp.yaml with confirmation prompt",
          "Config file created with 0600 permissions (user read/write only)",
          "Nested keys supported with dot notation: myapp config set server.port 8080",
        ],
        dependencies: [0],
        storyPoints: 2,
        targetFiles: ["cmd/config.go", "internal/config/config.go"],
        estimatedComplexity: "small",
      },
      {
        index: 3,
        title: "Run command with workflow execution",
        description: "Execute configured workflow with progress display",
        persona: "backend_developer",
        scope:
          "myapp run command reads workflow steps from config file, executes each step (shell commands) sequentially with progress spinner, collects output, reports results",
        acceptanceCriteria: [
          "myapp run reads steps array from .myapp.yaml workflow section",
          "Each step executed as shell command with timeout (default 60s, configurable)",
          "Progress spinner shown for each step with step name",
          "Step output captured and displayed on failure",
          "Summary at end: N/M steps passed, total duration",
          "myapp run --dry-run prints steps without executing",
          "Exit code 1 if any step fails (unless --continue-on-error)",
        ],
        dependencies: [2],
        storyPoints: 3,
        targetFiles: ["cmd/run.go", "internal/runner/runner.go", "internal/runner/step.go"],
        estimatedComplexity: "medium",
      },
      {
        index: 4,
        title: "Colorized output and help documentation",
        description: "Rich terminal output and comprehensive help text",
        persona: "backend_developer",
        scope:
          "Add lipgloss styling for success/error/warning messages, colorized table output for config list, custom help template with examples for each command",
        acceptanceCriteria: [
          "Success messages in green, errors in red, warnings in yellow",
          "Config list output as formatted table with aligned columns",
          "Each command has detailed --help with description, usage, examples, and flags",
          "Colors auto-disabled when stdout is not a terminal (piping)",
          "myapp --no-color flag disables colors globally",
          "Progress spinners use lipgloss styling with braille animation",
        ],
        dependencies: [3],
        storyPoints: 2,
        targetFiles: ["internal/ui/styles.go", "internal/ui/spinner.go", "cmd/root.go"],
        estimatedComplexity: "small",
      },
    ],
    techStack: {
      language: "go",
      framework: "cobra",
      testing: "go-test",
      buildTool: "go",
      rationale:
        "Go compiles to a single binary with zero dependencies — ideal for CLI distribution. Cobra is the standard Go CLI framework (used by kubectl, docker, gh). Viper handles config files. Lipgloss provides beautiful terminal output.",
    },
    qualityGates: [
      "go test ./... passes with 0 failures",
      "go vet reports no issues",
      "Binary compiles for linux/darwin/windows amd64 and arm64",
      "All commands have --help with examples",
      "Exit codes: 0 success, 1 failure, 2 usage error",
    ],
  },
  logs: [
    "Planning agent starting...",
    "Model: claude-opus-4-6 (Anthropic)",
    "Project: Developer CLI Tool",
    "Analyzing project requirements...",
    "CLI tool in Go: cobra + viper + lipgloss",
    "Selecting tech stack: Go + cobra + viper + lipgloss + go-test",
    "Designing command tree: root → init, config, run",
    "Decomposing into stories...",
    "Story 0: Project setup and root command (2pt)",
    "Story 1: Init command with project scaffolding (3pt)",
    "Story 2: Config command for settings management (2pt)",
    "Story 3: Run command with workflow execution (3pt)",
    "Story 4: Colorized output and help documentation (2pt)",
    "Building dependency graph: 0 → [1,2] → [3] → [4]",
    "Validating plan: 5 stories, 12 story points, 1 persona",
    "Plan generation complete.",
  ],
  summary: {
    storyCount: 5,
    personas: ["backend_developer"],
    techStackList: ["go", "cobra"],
    reasoning:
      "A CLI tool in Go is straightforward: cobra for commands, viper for config, and lipgloss for terminal output. Go compiles to a single binary with zero dependencies — ideal for CLI distribution.",
  },
  complexity: { score: 5, dimensions: { features: 1, layers: 1, files: 2, clarity: 1 } },
  estimatedCost: { local: 0, byok: 4.8, cloud: 7.2 },
  estimatedDuration: 25,
};

// ─── Export lookup map ─────────────────────────────────────────────────────

export const CACHED_PLANS: Record<string, CachedPlanData> = {
  "saas-dashboard": saasDashboard,
  "rest-api": restApi,
  "ecommerce-store": ecommerceStore,
  "blog-platform": blogPlatform,
  "project-tracker": projectTracker,
  "cli-tool": cliTool,
};
