# WorkerMill Showcase Projects

> 6 production-grade applications built and deployed entirely by WorkerMill AI workers.
> Each project demonstrates the full lifecycle: description → planning → build → deploy → iterate → live.
> Every project includes a public GitHub repo, live deployment, CI/CD pipeline, and a WorkerMill task log showing the entire build process.

---

## Purpose

These showcases prove three things:

1. **"From description to deployed software"** — Each project started as a plain-English description and ended as a running application at a public URL.
2. **Professional standards** — Every project passes lint, type checking, tests, and security scanning. The code is production-grade, not demo-quality.
3. **The orchestration is the product** — Each project links to the WorkerMill task log showing story decomposition, expert coordination, quality gate results, cost breakdown, and iteration count. The process visibility IS the product.

### What Makes These Different From AI Demos

Most AI coding demos show generated code in an editor. These showcases show:
- **Deployed, running software** you can interact with right now
- **Infrastructure-as-code** that provisioned real cloud resources
- **CI/CD pipelines** that the workers used to iterate until quality gates passed
- **The full build log** showing how parallel AI experts collaborated
- **Real cost and time data** — not estimates, actual numbers

### Showcase Structure

Each project repository contains:

```
project-name/
├── src/                    # Application source code
├── tests/                  # Unit + integration tests
├── infrastructure/         # Terraform IaC for cloud deployment
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── modules/
├── .github/workflows/      # CI/CD pipeline
│   ├── ci.yml              # Lint, typecheck, test, security scan
│   └── deploy.yml          # Build, push, terraform apply, smoke test
├── Dockerfile              # Container build
├── seed/                   # Demo data and seed scripts
├── docs/                   # Project-specific documentation
├── README.md               # Setup, architecture, API docs
└── WORKERMILL.md           # Build metadata: stories, cost, time, quality scores
```

### CI/CD Iteration Loop

Every showcase uses the same worker iteration pattern via GitHub Actions:

```
Worker pushes code to feature branch
  → GitHub Actions triggers:
      1. Lint (ESLint/Ruff/golangci-lint)
      2. Type check (tsc/mypy/go vet)
      3. Unit tests (Vitest/pytest/go test)
      4. Security scan (npm audit/safety/gosec)
      5. Build container image
      6. Integration tests against container
  → If ANY step fails:
      Worker reads failure output
      Worker fixes the code
      Worker pushes again
      Loop repeats
  → When CI passes:
      7. Push image to registry (ECR/GCR/GHCR)
      8. Terraform plan → apply
      9. Smoke test against live URL
      10. If smoke test fails → worker fixes → loop
      11. If smoke test passes → merge to main → done
```

Workers have access to CI logs via GitHub Actions API. They read failure messages, fix the root cause, and push again. This loop continues until the deployment is live and passing all checks. The iteration count is recorded in each project's `WORKERMILL.md`.

### Deployment & Hosting Strategy

| Project | App Hosting | Database | Other Services | Estimated Monthly Cost |
|---------|------------|----------|----------------|----------------------|
| TeamBoard | Vercel (free tier) | Neon PostgreSQL (free tier) | — | $0 |
| ShipAPI | AWS ECS Fargate | AWS RDS (t4g.micro) | ALB, ECR | ~$35-45 |
| PulseView | GCP Cloud Run | GCP Cloud SQL (db-f1-micro) | — | ~$15-25 |
| DocForge | AWS ECS Fargate | AWS RDS (t4g.micro) | Meilisearch on ECS | ~$45-55 |
| EnvGuard | AWS App Runner | AWS RDS (t4g.micro) | GitHub Releases (CLI) | ~$20-30 |
| OrderFlow | AWS ECS Fargate (×4) | AWS RDS (t4g.micro) | SQS queues | ~$50-65 |
| **Total** | | | | **~$165-220/month** |

All AWS/GCP resources are provisioned via Terraform. All container images are built in CI. No manual cloud console operations.

---

## Project 1: TeamBoard

### Multi-Tenant SaaS Project Management

**Tagline:** A Kanban-style project board with workspaces, roles, and real-time updates.

**What it demonstrates:** Full-stack SaaS with multi-tenancy, RBAC, drag-and-drop UI, real-time updates, and managed database deployment. This is the "hero demo" — the most visually impressive showcase that visitors interact with first.

**Target audience resonance:** This is the #1 type of application indie hackers and solo founders build. Every startup evaluating WorkerMill will think "could this build MY SaaS?"

---

### User Description (what would appear on the /build page)

> Build a project management application with Kanban boards. Users can create workspaces and invite team members with different roles (owner, admin, member, viewer). Each workspace has multiple boards, and each board has customizable columns with draggable task cards.
>
> Task cards should have a title, rich text description, assignee, priority (urgent/high/medium/low), due date, and labels. Users should be able to drag cards between columns and reorder them within columns.
>
> Include a workspace dashboard with summary charts: tasks by status, tasks by assignee, tasks created over time, and overdue task count. Show an activity feed of recent actions (card created, moved, assigned, completed).
>
> Authentication should use email/password with session-based auth. Each workspace is completely isolated — users only see data for workspaces they belong to.
>
> The UI should be clean and responsive with a sidebar navigation showing the workspace name, boards list, dashboard link, members link, and settings. Use a modern design with a neutral color palette.
>
> Include a seed script that creates a demo workspace with 3 boards, multiple columns, and ~30 sample cards across different statuses so the application looks populated on first visit.

---

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Next.js 15 (App Router) | Full-stack React with API routes, SSR, server actions |
| ORM | Prisma | Type-safe database access, migration management |
| Database | PostgreSQL (Neon) | Reliable, free tier with branching |
| Auth | NextAuth.js v5 | Session-based auth, extensible provider support |
| Styling | TailwindCSS + shadcn/ui | Consistent design system, accessible components |
| Drag & Drop | @dnd-kit/core | Modern, accessible, performant DnD library |
| Charts | Recharts | Declarative charts built on D3, React-native |
| Real-time | Server-Sent Events (SSE) | Simple real-time updates without WebSocket complexity |
| Testing | Vitest + Testing Library + Playwright | Unit, component, and E2E coverage |
| Linting | ESLint + Prettier | Code quality and formatting |

### Data Model

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String
  passwordHash  String
  avatarUrl     String?
  createdAt     DateTime  @default(now())
  memberships   WorkspaceMember[]
  assignedCards Card[]    @relation("assignee")
  activities    Activity[]
}

model Workspace {
  id          String    @id @default(cuid())
  name        String
  slug        String    @unique
  description String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  members     WorkspaceMember[]
  boards      Board[]
  activities  Activity[]
  labels      Label[]
}

model WorkspaceMember {
  id          String    @id @default(cuid())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workspaceId String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId      String
  role        MemberRole @default(MEMBER)
  joinedAt    DateTime  @default(now())

  @@unique([workspaceId, userId])
}

enum MemberRole {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}

model Board {
  id          String    @id @default(cuid())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workspaceId String
  name        String
  description String?
  position    Int       @default(0)
  createdAt   DateTime  @default(now())
  columns     Column[]
}

model Column {
  id       String @id @default(cuid())
  board    Board  @relation(fields: [boardId], references: [id], onDelete: Cascade)
  boardId  String
  name     String
  position Int    @default(0)
  color    String @default("#6B7280")
  cards    Card[]
}

model Card {
  id          String    @id @default(cuid())
  column      Column    @relation(fields: [columnId], references: [id], onDelete: Cascade)
  columnId    String
  title       String
  description String?   @db.Text
  priority    Priority  @default(MEDIUM)
  position    Int       @default(0)
  dueDate     DateTime?
  assignee    User?     @relation("assignee", fields: [assigneeId], references: [id])
  assigneeId  String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  labels      CardLabel[]
}

enum Priority {
  URGENT
  HIGH
  MEDIUM
  LOW
}

model Label {
  id          String    @id @default(cuid())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workspaceId String
  name        String
  color       String
  cards       CardLabel[]
}

model CardLabel {
  card    Card  @relation(fields: [cardId], references: [id], onDelete: Cascade)
  cardId  String
  label   Label @relation(fields: [labelId], references: [id], onDelete: Cascade)
  labelId String

  @@id([cardId, labelId])
}

model Activity {
  id          String    @id @default(cuid())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workspaceId String
  user        User      @relation(fields: [userId], references: [id])
  userId      String
  type        String    // card_created, card_moved, card_assigned, card_completed, member_invited
  entityType  String    // card, board, member
  entityId    String
  data        Json      // { from: "To Do", to: "In Progress", cardTitle: "..." }
  createdAt   DateTime  @default(now())
}
```

### API Routes (Next.js App Router)

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/auth/[...nextauth]` | * | NextAuth handlers | Public |
| `/api/workspaces` | GET | List user's workspaces | Required |
| `/api/workspaces` | POST | Create workspace | Required |
| `/api/workspaces/[slug]` | GET | Workspace detail | Member |
| `/api/workspaces/[slug]` | PUT | Update workspace | Admin+ |
| `/api/workspaces/[slug]` | DELETE | Delete workspace | Owner |
| `/api/workspaces/[slug]/members` | GET | List members | Member |
| `/api/workspaces/[slug]/members` | POST | Invite member (by email) | Admin+ |
| `/api/workspaces/[slug]/members/[id]` | PUT | Change role | Admin+ |
| `/api/workspaces/[slug]/members/[id]` | DELETE | Remove member | Admin+ |
| `/api/workspaces/[slug]/boards` | GET | List boards | Member |
| `/api/workspaces/[slug]/boards` | POST | Create board | Member+ |
| `/api/workspaces/[slug]/boards/[id]` | GET | Board with columns + cards | Member |
| `/api/workspaces/[slug]/boards/[id]` | PUT | Update board | Member+ |
| `/api/workspaces/[slug]/boards/[id]` | DELETE | Delete board | Admin+ |
| `/api/boards/[id]/columns` | POST | Create column | Member+ |
| `/api/boards/[id]/columns/reorder` | PUT | Reorder columns | Member+ |
| `/api/columns/[id]` | PUT | Update column | Member+ |
| `/api/columns/[id]` | DELETE | Delete column | Admin+ |
| `/api/columns/[id]/cards` | POST | Create card | Member+ |
| `/api/cards/[id]` | GET | Card detail | Member |
| `/api/cards/[id]` | PUT | Update card | Member+ |
| `/api/cards/[id]` | DELETE | Delete card | Member+ |
| `/api/cards/move` | POST | Move card (cross-column + reorder) | Member+ |
| `/api/workspaces/[slug]/activity` | GET | Activity feed (paginated) | Member |
| `/api/workspaces/[slug]/stats` | GET | Dashboard statistics | Member |
| `/api/workspaces/[slug]/stream` | GET | SSE for real-time updates | Member |

### UI Pages

| Page | Path | Description |
|------|------|-------------|
| Landing | `/` | Marketing page with "Try the Demo" CTA |
| Login | `/login` | Email + password login form |
| Sign Up | `/signup` | Registration form |
| Workspace List | `/workspaces` | Grid of user's workspaces with create button |
| Board View | `/[workspace]/boards/[id]` | **Main view** — Kanban board with drag-and-drop columns and cards |
| Dashboard | `/[workspace]/dashboard` | Charts: tasks by status (pie), by assignee (bar), over time (line), overdue count (card) |
| Activity | `/[workspace]/activity` | Chronological activity feed with user avatars and action descriptions |
| Members | `/[workspace]/members` | Member list with role badges, invite form, role management |
| Settings | `/[workspace]/settings` | Workspace name, description, labels management, danger zone (delete) |

**Layout:** All workspace pages share a sidebar layout with:
- Workspace name + avatar at top
- Navigation: Dashboard, Boards (expandable list), Activity, Members, Settings
- User avatar + settings at bottom
- Collapsible on mobile

### Seed Data

The seed script (`seed/index.ts`) creates:

**Demo user:** `demo@workermill.com` / `demo1234`

**Workspace:** "Acme Product" with the demo user as owner

**3 Boards:**

1. **Product Roadmap** — 5 columns (Backlog, To Do, In Progress, Review, Done) with 12 cards spanning priorities and assignees
2. **Sprint 14** — 4 columns (To Do, In Progress, QA, Done) with 10 cards, some with due dates in the past (overdue)
3. **Bug Tracker** — 3 columns (Reported, Investigating, Fixed) with 8 cards

**Labels:** "Bug", "Feature", "Enhancement", "Documentation", "Urgent" with distinct colors

**Activity:** 25 recent activities showing card movements, assignments, and completions over the past 7 days

**Total:** ~30 cards, 3 boards, 12 columns, 5 labels, 25 activities — enough to look like a real, active workspace

### Infrastructure

**Vercel** for the Next.js application (free tier):
- Automatic preview deploys on PR
- Production deploy on merge to main
- Edge functions for API routes
- No Terraform needed — Vercel CLI + GitHub integration

**Neon PostgreSQL** (free tier):
- 0.5 GB storage, 190 hours compute
- Connection string via environment variable
- Database branching for preview deploys (optional)

### CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run lint          # ESLint
      - run: npm run typecheck     # tsc --noEmit
      - run: npm run test          # Vitest unit tests
      - run: npm audit --audit-level=high  # Security scan

  e2e:
    runs-on: ubuntu-latest
    needs: quality
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: test, POSTGRES_PASSWORD: test, POSTGRES_DB: teamboard_test }
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx prisma migrate deploy
        env: { DATABASE_URL: postgresql://test:test@localhost:5432/teamboard_test }
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        env: { DATABASE_URL: postgresql://test:test@localhost:5432/teamboard_test }

# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
      - name: Smoke test
        run: |
          sleep 30
          curl -f https://teamboard.workermill.com/api/health || exit 1
      - name: Seed demo data
        run: |
          curl -f -X POST https://teamboard.workermill.com/api/seed \
            -H "Authorization: Bearer ${{ secrets.SEED_TOKEN }}" || exit 1
```

### Quality Gates

| Gate | Threshold | Tool |
|------|-----------|------|
| Lint | 0 errors, 0 warnings | ESLint with strict config |
| Types | 0 errors | `tsc --noEmit` |
| Unit tests | 100% pass, >60% coverage on API routes | Vitest |
| E2E tests | 100% pass | Playwright |
| Security | 0 high/critical vulnerabilities | `npm audit` |
| Build | Successful production build | `next build` |
| Accessibility | 0 violations on main pages | axe-core in Playwright tests |

### Acceptance Criteria

A visitor landing on the live URL should be able to:

- [ ] See a landing page explaining what TeamBoard is, with "Try the Demo" button
- [ ] Click "Try the Demo" and be logged in as the demo user (or create an account)
- [ ] See the "Acme Product" workspace with 3 boards listed in the sidebar
- [ ] Open the "Product Roadmap" board and see 5 columns with cards
- [ ] Drag a card from "To Do" to "In Progress" and see it persist after page reload
- [ ] Click a card to see its detail (title, description, priority, assignee, due date, labels)
- [ ] Edit a card's title and description
- [ ] Create a new card in any column
- [ ] Navigate to the Dashboard and see 4 charts with real data from the seed
- [ ] Navigate to Activity and see recent actions
- [ ] Navigate to Members and see the member list with roles
- [ ] The entire experience is responsive (works on mobile viewport)
- [ ] Page load time < 2 seconds on 4G connection

### Smoke Tests (Post-Deploy Verification)

```bash
# Health check
curl -f https://teamboard.workermill.com/api/health

# Auth works
TOKEN=$(curl -s -X POST https://teamboard.workermill.com/api/auth/callback/credentials \
  -d '{"email":"demo@workermill.com","password":"demo1234"}' | jq -r '.token')

# API returns data
curl -f -H "Authorization: Bearer $TOKEN" \
  https://teamboard.workermill.com/api/workspaces

# Board has cards
CARDS=$(curl -s -H "Authorization: Bearer $TOKEN" \
  https://teamboard.workermill.com/api/workspaces/acme-product/boards/1 | jq '.columns[].cards | length' | paste -sd+ | bc)
[ "$CARDS" -gt 20 ] || exit 1

# Stats endpoint returns chart data
curl -f -H "Authorization: Bearer $TOKEN" \
  https://teamboard.workermill.com/api/workspaces/acme-product/stats
```

---

## Project 2: ShipAPI

### Production REST API with Auto-Generated Documentation

**Tagline:** A production-grade inventory management API deployed to AWS via Terraform.

**What it demonstrates:** Backend API expertise, infrastructure-as-code, full AWS deployment (ECS + RDS + ALB), auto-generated interactive API documentation, and the DevOps persona provisioning real cloud resources. This is the showcase that proves WorkerMill can deploy to cloud infrastructure, not just generate code.

**Target audience resonance:** Backend developers are the most likely early adopters. An API with Terraform deployment proves WorkerMill handles infrastructure, not just application code.

---

### User Description

> Build a production REST API for inventory management. The API should handle products organized by categories, warehouses, and stock levels per warehouse. Include a stock transfer operation to move inventory between warehouses and an alert system for products below their minimum stock threshold.
>
> Authentication should use JWT with registration, login, token refresh, and a "me" endpoint. Include API key authentication as an alternative for server-to-server calls. Add rate limiting per API key (100 requests/minute).
>
> Every list endpoint needs pagination (page + per_page parameters), filtering (by relevant fields), and sorting (sort_by + sort_order). Include full-text search on product name and description.
>
> The API must have auto-generated OpenAPI 3.1 documentation accessible at /docs (Swagger UI) and /redoc (ReDoc). Every endpoint, request body, response, and error must be fully documented in the spec.
>
> Include comprehensive error handling with consistent error response format: `{ "error": { "code": "...", "message": "...", "details": [...] } }`. Use proper HTTP status codes throughout.
>
> Add an audit log that records every write operation (who did what, when, to which resource). Include a GET endpoint to query audit logs with date range filtering.
>
> Deploy to AWS using Terraform: ECS Fargate for the API, RDS PostgreSQL for the database, Application Load Balancer with HTTPS, ECR for container images, Secrets Manager for credentials, and CloudWatch for logs. The infrastructure should be production-grade with private subnets for the database.
>
> Include a seed script that populates the database with 5 categories, 50 products, 3 warehouses, and stock levels — enough to make the API documentation examples meaningful.

---

### Tech Stack

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
| Container | Docker (multi-stage) | Slim production image |
| IaC | Terraform | AWS resource provisioning |
| CI/CD | GitHub Actions | Automated test + deploy pipeline |

### Data Model

```python
# models/user.py
class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    api_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default="user")  # user, admin
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

# models/category.py
class Category(Base):
    __tablename__ = "categories"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("categories.id"))
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    products: Mapped[list["Product"]] = relationship(back_populates="category")

# models/product.py
class Product(Base):
    __tablename__ = "products"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), index=True)
    sku: Mapped[str] = mapped_column(String(50), unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id"))
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    weight_kg: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 3))
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())
    # Full-text search vector
    search_vector: Mapped[Any] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('english', name || ' ' || coalesce(description, ''))", persisted=True)
    )
    category: Mapped["Category"] = relationship(back_populates="products")
    stock_levels: Mapped[list["StockLevel"]] = relationship(back_populates="product")

# models/warehouse.py
class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    location: Mapped[str] = mapped_column(String(500))
    capacity: Mapped[int] = mapped_column()
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    stock_levels: Mapped[list["StockLevel"]] = relationship(back_populates="warehouse")

# models/stock_level.py
class StockLevel(Base):
    __tablename__ = "stock_levels"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"))
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id"))
    quantity: Mapped[int] = mapped_column(default=0)
    min_threshold: Mapped[int] = mapped_column(default=10)
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())
    __table_args__ = (UniqueConstraint("product_id", "warehouse_id"),)
    product: Mapped["Product"] = relationship(back_populates="stock_levels")
    warehouse: Mapped["Warehouse"] = relationship(back_populates="stock_levels")

# models/stock_transfer.py
class StockTransfer(Base):
    __tablename__ = "stock_transfers"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"))
    from_warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id"))
    to_warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id"))
    quantity: Mapped[int] = mapped_column()
    initiated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=func.now())

# models/audit_log.py
class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(50))  # create, update, delete, transfer
    resource_type: Mapped[str] = mapped_column(String(50))  # product, warehouse, stock_level
    resource_id: Mapped[uuid.UUID] = mapped_column()
    changes: Mapped[Optional[dict]] = mapped_column(JSON)  # { field: { old: x, new: y } }
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(default=func.now())
```

### API Endpoints

| Endpoint | Method | Purpose | Auth | Rate Limit |
|----------|--------|---------|------|------------|
| `POST /api/v1/auth/register` | POST | Create account | Public | 5/min |
| `POST /api/v1/auth/login` | POST | Get JWT tokens | Public | 10/min |
| `POST /api/v1/auth/refresh` | POST | Refresh access token | Refresh token | 30/min |
| `GET /api/v1/auth/me` | GET | Current user profile | JWT/API Key | 100/min |
| `GET /api/v1/categories` | GET | List categories (tree) | JWT/API Key | 100/min |
| `POST /api/v1/categories` | POST | Create category | JWT/API Key (admin) | 100/min |
| `GET /api/v1/categories/{id}` | GET | Category detail + products | JWT/API Key | 100/min |
| `PUT /api/v1/categories/{id}` | PUT | Update category | JWT/API Key (admin) | 100/min |
| `DELETE /api/v1/categories/{id}` | DELETE | Delete category | JWT/API Key (admin) | 100/min |
| `GET /api/v1/products` | GET | List products (paginated, filterable, searchable) | JWT/API Key | 100/min |
| `POST /api/v1/products` | POST | Create product | JWT/API Key | 100/min |
| `GET /api/v1/products/{id}` | GET | Product detail + stock levels | JWT/API Key | 100/min |
| `PUT /api/v1/products/{id}` | PUT | Update product | JWT/API Key | 100/min |
| `DELETE /api/v1/products/{id}` | DELETE | Soft-delete product | JWT/API Key (admin) | 100/min |
| `GET /api/v1/warehouses` | GET | List warehouses | JWT/API Key | 100/min |
| `POST /api/v1/warehouses` | POST | Create warehouse | JWT/API Key (admin) | 100/min |
| `GET /api/v1/warehouses/{id}` | GET | Warehouse detail + stock | JWT/API Key | 100/min |
| `PUT /api/v1/warehouses/{id}` | PUT | Update warehouse | JWT/API Key | 100/min |
| `GET /api/v1/warehouses/{id}/stock` | GET | Stock levels for warehouse | JWT/API Key | 100/min |
| `PUT /api/v1/stock/{product_id}/{warehouse_id}` | PUT | Update stock level | JWT/API Key | 100/min |
| `POST /api/v1/stock/transfer` | POST | Transfer between warehouses | JWT/API Key | 100/min |
| `GET /api/v1/stock/alerts` | GET | Products below min threshold | JWT/API Key | 100/min |
| `GET /api/v1/audit-log` | GET | Audit log (paginated, filterable by date/action/resource) | JWT/API Key (admin) | 100/min |
| `GET /api/v1/health` | GET | Health check (DB connection) | Public | — |
| `GET /docs` | GET | Swagger UI | Public | — |
| `GET /redoc` | GET | ReDoc documentation | Public | — |

**Query parameters for list endpoints:**
- `page` (default: 1), `per_page` (default: 20, max: 100)
- `sort_by` (field name), `sort_order` (asc/desc)
- `search` (full-text search on products)
- Resource-specific filters: `category_id`, `min_price`, `max_price`, `is_active`, `warehouse_id`

**Standard response format:**
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 142,
    "total_pages": 8
  }
}
```

**Standard error format:**
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

### Infrastructure (Terraform)

```
infrastructure/
├── main.tf              # Provider config, backend (S3)
├── variables.tf         # Environment, region, app config
├── outputs.tf           # API URL, DB endpoint, ALB DNS
├── vpc.tf               # VPC, public/private subnets, NAT gateway
├── ecs.tf               # ECS cluster, task definition, service
├── rds.tf               # RDS PostgreSQL instance (private subnet)
├── alb.tf               # Application Load Balancer + HTTPS listener
├── ecr.tf               # ECR repository for container images
├── secrets.tf           # Secrets Manager for DB credentials, JWT secret
├── iam.tf               # ECS task role, execution role
├── security_groups.tf   # ALB SG, ECS SG, RDS SG
├── cloudwatch.tf        # Log group for ECS
└── route53.tf           # DNS record (shipapi.workermill.com)
```

**Key resources:**
- VPC with 2 public subnets (ALB) + 2 private subnets (ECS, RDS)
- NAT Gateway for ECS outbound internet (pulling images, etc.)
- ECS Fargate service (0.25 vCPU, 0.5 GB) with desired count 1
- RDS PostgreSQL 16 (db.t4g.micro, 20 GB gp3, private subnet, no public access)
- ALB with HTTPS (ACM certificate for *.workermill.com)
- ECR repository with lifecycle policy (keep last 10 images)
- Secrets Manager for DATABASE_URL and JWT_SECRET_KEY
- CloudWatch log group with 14-day retention
- Security groups: ALB allows 443 inbound, ECS allows ALB only, RDS allows ECS only

### CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  quality:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: test, POSTGRES_PASSWORD: test, POSTGRES_DB: shipapi_test }
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.13' }
      - run: pip install uv && uv sync
      - run: uv run ruff check .                    # Lint
      - run: uv run ruff format --check .            # Format check
      - run: uv run mypy src --strict                # Type check
      - run: uv run pytest tests/ -v --cov=src --cov-report=term-missing  # Tests
        env: { DATABASE_URL: postgresql+asyncpg://test:test@localhost:5432/shipapi_test }
      - run: pip audit                               # Security scan

# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
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
      - name: Build and push image
        run: |
          docker build -t $ECR_REGISTRY/shipapi:${{ github.sha }} .
          docker push $ECR_REGISTRY/shipapi:${{ github.sha }}
      - uses: hashicorp/setup-terraform@v3
      - name: Terraform apply
        working-directory: infrastructure
        run: |
          terraform init
          terraform apply -auto-approve -var="image_tag=${{ github.sha }}"
      - name: Run migrations
        run: |
          aws ecs run-task --cluster shipapi --task-definition shipapi-migrate \
            --network-configuration "..." --launch-type FARGATE
      - name: Smoke test
        run: |
          sleep 60
          curl -f https://shipapi.workermill.com/api/v1/health
          curl -f https://shipapi.workermill.com/docs
          # Test auth flow
          TOKEN=$(curl -s -X POST https://shipapi.workermill.com/api/v1/auth/login \
            -H 'Content-Type: application/json' \
            -d '{"email":"demo@workermill.com","password":"demo1234"}' | jq -r '.access_token')
          curl -f -H "Authorization: Bearer $TOKEN" \
            https://shipapi.workermill.com/api/v1/products
      - name: Seed demo data
        if: github.ref == 'refs/heads/main'
        run: |
          aws ecs run-task --cluster shipapi --task-definition shipapi-seed \
            --network-configuration "..." --launch-type FARGATE
```

### Seed Data

- **1 admin user:** `demo@workermill.com` / `demo1234` with API key `sk_demo_...`
- **5 categories:** Electronics, Clothing, Home & Garden, Sports, Books (with subcategories)
- **50 products:** Distributed across categories with realistic names, SKUs, prices, weights, descriptions
- **3 warehouses:** "East Coast Hub" (NYC), "West Coast Hub" (LA), "Central Warehouse" (Chicago)
- **150 stock levels:** Each product has stock in 1-3 warehouses, ~10 products below min threshold
- **20 stock transfers:** Recent transfer history
- **50 audit log entries:** Recent operations

### Quality Gates

| Gate | Threshold | Tool |
|------|-----------|------|
| Lint | 0 errors | Ruff |
| Format | Fully formatted | Ruff format |
| Types | 0 errors (strict mode) | mypy |
| Tests | 100% pass, >80% coverage | pytest |
| Security | 0 known vulnerabilities | pip-audit |
| Build | Successful Docker build | docker build |
| OpenAPI | Valid spec, all endpoints documented | openapi-spec-validator |
| Smoke test | Health + auth + query all pass | curl |

### Acceptance Criteria

- [ ] `GET /docs` shows interactive Swagger UI with all endpoints documented
- [ ] `GET /redoc` shows ReDoc documentation
- [ ] Can register a new user, login, receive JWT, and access protected endpoints
- [ ] Product listing supports pagination, filtering by category/price, sorting, and full-text search
- [ ] Stock transfer between warehouses updates both stock levels atomically
- [ ] `GET /stock/alerts` returns products below their minimum threshold
- [ ] Rate limiting returns 429 after 100 requests/minute
- [ ] All write operations create audit log entries
- [ ] Error responses follow the documented format consistently
- [ ] Infrastructure is fully provisioned via Terraform (no manual AWS console steps)
- [ ] RDS is in a private subnet, not publicly accessible
- [ ] API response time < 200ms p95 for list endpoints with default pagination

---

## Project 3: PulseView

### Real-Time Analytics Dashboard

**Tagline:** An event analytics platform with real-time charts that's always alive when you visit.

**What it demonstrates:** Real-time architecture (WebSockets), data visualization, GCP deployment via Terraform (proving multi-cloud capability), and a demo data generator that keeps the dashboard perpetually active. This is the most visually impressive showcase.

**Target audience resonance:** Analytics dashboards are a common product type and internal tool. The "always alive" demo data generator means visitors never see an empty dashboard — the charts are always moving.

---

### User Description

> Build a real-time event analytics dashboard. The system has two parts: an event ingestion API that accepts events via webhook, and a dashboard that displays analytics in real-time.
>
> The ingestion API should accept events via `POST /api/events` with fields: source (string), category (string), name (string), data (JSON object), and timestamp (optional, defaults to now). Also support batch ingestion via `POST /api/events/batch` for up to 100 events at once. Return a 202 Accepted response.
>
> The dashboard should display:
> 1. **Counter cards** at the top: Total events, events in last hour, unique sources, events per minute (updating in real-time)
> 2. **Line chart**: Events over time with configurable intervals (per minute, per hour, per day)
> 3. **Bar chart**: Events grouped by category
> 4. **Pie chart**: Event distribution by source
> 5. **Heatmap**: Event volume by hour-of-day vs day-of-week
> 6. **Event table**: Recent events with columns for timestamp, source, category, name, and a JSON data preview. Sortable and searchable.
>
> All charts should update in real-time via WebSocket as new events arrive. Include a time range selector (last hour, last 24 hours, last 7 days, last 30 days) that affects all charts simultaneously. Add source and category filter dropdowns.
>
> Include a demo data generator that runs as a background process and continuously generates realistic events from 5 different sources (web-app, mobile-app, api-gateway, payment-service, notification-service) with varying categories (page_view, api_call, error, purchase, notification). The generator should produce events at a variable rate (2-10 per second) with realistic patterns — more activity during business hours, occasional error spikes.
>
> Deploy to Google Cloud Platform: Cloud Run for the API and dashboard, Cloud SQL for PostgreSQL. Use Terraform for all infrastructure.

---

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend | Express + TypeScript | Fast, lightweight API server |
| Real-time | Socket.io | WebSocket with auto-fallback, room support |
| Database | PostgreSQL 16 | Time-series queries, BRIN indexes for timestamp |
| Frontend | React 19 + Vite | Fast build, HMR for development |
| Charts | Recharts | Declarative, React-native charting |
| Heatmap | Custom SVG or cal-heatmap | Lightweight heatmap visualization |
| Styling | TailwindCSS | Utility-first, dark theme for dashboard aesthetic |
| Testing | Vitest + Supertest + Playwright | API, unit, and E2E tests |
| Container | Docker (multi-stage) | Separate images for API and demo-generator |
| IaC | Terraform (Google provider) | GCP resource provisioning |
| CI/CD | GitHub Actions | Automated test + deploy |

### Data Model

```sql
-- Primary events table with BRIN index for time-range queries
CREATE TABLE events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source      VARCHAR(100) NOT NULL,
    category    VARCHAR(100) NOT NULL,
    name        VARCHAR(255) NOT NULL,
    data        JSONB DEFAULT '{}',
    ip_address  INET,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_timestamp_brin ON events USING BRIN (timestamp);
CREATE INDEX idx_events_source ON events (source);
CREATE INDEX idx_events_category ON events (category);
CREATE INDEX idx_events_source_category ON events (source, category);

-- Materialized view for hourly aggregates (refreshed by cron)
CREATE MATERIALIZED VIEW event_hourly_stats AS
SELECT
    date_trunc('hour', timestamp) AS hour,
    source,
    category,
    COUNT(*) AS event_count
FROM events
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX idx_event_hourly_stats ON event_hourly_stats (hour, source, category);

-- Materialized view for daily aggregates
CREATE MATERIALIZED VIEW event_daily_stats AS
SELECT
    date_trunc('day', timestamp) AS day,
    source,
    category,
    COUNT(*) AS event_count
FROM events
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX idx_event_daily_stats ON event_daily_stats (day, source, category);
```

### API Endpoints

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `POST /api/events` | POST | Ingest single event | API Key |
| `POST /api/events/batch` | POST | Ingest up to 100 events | API Key |
| `GET /api/analytics/timeseries` | GET | Event count over time | API Key |
| `GET /api/analytics/by-category` | GET | Event count grouped by category | API Key |
| `GET /api/analytics/by-source` | GET | Event count grouped by source | API Key |
| `GET /api/analytics/heatmap` | GET | Event count by hour × day-of-week | API Key |
| `GET /api/analytics/summary` | GET | Counter card data (totals, rates) | API Key |
| `GET /api/events` | GET | Recent events table (paginated, searchable) | API Key |
| `GET /api/sources` | GET | List distinct sources | API Key |
| `GET /api/categories` | GET | List distinct categories | API Key |
| `GET /api/health` | GET | Health check | Public |
| `WebSocket /ws` | — | Real-time event push + counter updates | API Key |

**Query parameters:**
- `range`: `1h`, `24h`, `7d`, `30d` (applied to all analytics endpoints)
- `interval`: `minute`, `hour`, `day` (for timeseries)
- `source`: Filter by source
- `category`: Filter by category
- `search`: Full-text search on event name/data (for events table)
- `page`, `per_page`: Pagination (for events table)

### Dashboard UI

**Layout:** Full-width dark-themed dashboard (dark gray/navy background, bright accent colors for charts).

**Top bar:** PulseView logo | Time range selector (1h / 24h / 7d / 30d) | Source filter | Category filter | Connection status indicator (green dot when WebSocket connected)

**Row 1 — Counter cards (4 columns):**
| Total Events | Events (last hour) | Unique Sources | Events/min |
| Animated count-up | Animated count-up | Number | Live rate |

**Row 2 — Charts (2 columns):**
| Line chart: Events over time | Bar chart: By category |
| With interval toggle | Horizontal bars, sorted by count |

**Row 3 — Charts (2 columns):**
| Pie/donut chart: By source | Heatmap: Hour × Day |
| Color-coded segments | Green (low) → Red (high) |

**Row 4 — Event table (full width):**
| Timestamp | Source | Category | Name | Data (truncated JSON) |
| Sortable columns | Search input | Auto-prepends new events at top |

### Demo Data Generator

A separate process (`src/demo-generator.ts`) that runs alongside the API:

```typescript
// Realistic event generation with patterns
const SOURCES = [
  { name: "web-app", weight: 40, categories: ["page_view", "click", "form_submit", "error"] },
  { name: "mobile-app", weight: 25, categories: ["screen_view", "tap", "api_call", "crash"] },
  { name: "api-gateway", weight: 20, categories: ["request", "response", "rate_limit", "error"] },
  { name: "payment-service", weight: 10, categories: ["checkout", "payment_success", "payment_failed", "refund"] },
  { name: "notification-service", weight: 5, categories: ["email_sent", "push_sent", "sms_sent", "delivery_failed"] },
];

// Time-of-day pattern: higher volume during business hours (UTC)
function getActivityMultiplier(hour: number): number {
  // Peak: 14:00-18:00 UTC (US business hours)
  // Low: 02:00-08:00 UTC (overnight)
  // Returns 0.2 to 1.0
}

// Generate 2-10 events per second based on time patterns
// Occasional error spikes (5% chance per minute of 3x error rate for 30 seconds)
// Realistic event data (page URLs, user agents, response codes, amounts)
```

The generator runs as a separate Cloud Run service (min-instances: 1) to ensure the dashboard is always alive.

### Infrastructure (Terraform — GCP)

```
infrastructure/
├── main.tf              # Provider config, backend (GCS)
├── variables.tf         # Project, region, app config
├── outputs.tf           # Service URLs
├── network.tf           # VPC, subnets, serverless VPC connector
├── cloud_run_api.tf     # Cloud Run service for API + WebSocket
├── cloud_run_generator.tf  # Cloud Run service for demo generator
├── cloud_sql.tf         # Cloud SQL PostgreSQL instance
├── artifact_registry.tf # Container image registry
├── iam.tf               # Service accounts, Cloud SQL client role
├── secrets.tf           # Secret Manager for DB credentials, API key
└── dns.tf               # Cloud DNS record (pulseview.workermill.com)
```

**Key resources:**
- Cloud Run (API): 0.5 vCPU, 256MB, min-instances 0, max 3, WebSocket support enabled
- Cloud Run (Generator): 0.25 vCPU, 128MB, min-instances 1 (always running)
- Cloud SQL PostgreSQL 16 (db-f1-micro, 10 GB SSD, private IP)
- Serverless VPC Connector (for Cloud Run → Cloud SQL private access)
- Artifact Registry repository
- Secret Manager for DATABASE_URL and API_KEY

### CI/CD Pipeline

```yaml
name: Deploy to GCP
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: test, POSTGRES_PASSWORD: test, POSTGRES_DB: pulseview_test }
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
        env: { DATABASE_URL: postgresql://test:test@localhost:5432/pulseview_test }
      - run: npm audit --audit-level=high

  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Build and push images
        run: |
          gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT/pulseview/api:${{ github.sha }}
          gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT/pulseview/generator:${{ github.sha }} -f Dockerfile.generator
      - uses: hashicorp/setup-terraform@v3
      - name: Terraform apply
        working-directory: infrastructure
        run: |
          terraform init
          terraform apply -auto-approve \
            -var="api_image_tag=${{ github.sha }}" \
            -var="generator_image_tag=${{ github.sha }}"
      - name: Smoke test
        run: |
          sleep 30
          curl -f https://pulseview.workermill.com/api/health
          # Verify demo generator is producing events
          sleep 10
          COUNT=$(curl -s -H "X-API-Key: ${{ secrets.DEMO_API_KEY }}" \
            https://pulseview.workermill.com/api/analytics/summary?range=1h | jq '.total_events')
          [ "$COUNT" -gt 0 ] || exit 1
```

### Quality Gates

| Gate | Threshold | Tool |
|------|-----------|------|
| Lint | 0 errors | ESLint |
| Types | 0 errors | tsc --noEmit |
| Tests | 100% pass, >70% coverage | Vitest |
| Security | 0 high/critical | npm audit |
| Build | Both Docker images build | docker build |
| Smoke test | Health + events flowing | curl |
| Performance | Dashboard loads < 3s, chart render < 500ms | Lighthouse in CI |

### Acceptance Criteria

- [ ] Visiting the live URL shows a dashboard with charts that are actively updating
- [ ] Counter cards animate and increment as new events arrive (visible within 5 seconds)
- [ ] Line chart shows a live trace of events over the selected time range
- [ ] Changing time range (1h/24h/7d/30d) updates all charts simultaneously
- [ ] Filtering by source or category updates all charts
- [ ] Heatmap shows clear patterns (higher volume during business hours)
- [ ] Event table shows recent events with auto-prepend of new ones
- [ ] `POST /api/events` with a valid API key returns 202 and event appears on dashboard within 2 seconds
- [ ] WebSocket connection indicator shows green when connected
- [ ] All infrastructure provisioned via Terraform on GCP (verifiable in repo)
- [ ] Demo data generator runs continuously (dashboard is never empty)

---

## Project 4: DocForge

### Documentation Site with CMS

**Tagline:** A developer documentation platform with full-text search, version history, and a CMS backend.

**What it demonstrates:** Non-JavaScript stack (Django + HTMX), multi-service deployment (app + search engine), server-rendered architecture, and the tech_writer persona generating real documentation content. Proves WorkerMill handles more than just React + Node.

**Target audience resonance:** Every developer tool needs documentation. A documentation platform with CMS and search is a common internal tool need, and building one from scratch is tedious.

---

### User Description

> Build a developer documentation site with a CMS backend for content management. The public-facing docs should have a clean, readable design similar to Stripe's docs or Mintlify — sidebar navigation with a page tree, table of contents generated from headings, breadcrumbs, previous/next navigation, and code blocks with syntax highlighting.
>
> Content should be written in Markdown and rendered server-side. Each page has a title, slug (URL path), content, order position, and optional parent page (for nested hierarchy up to 3 levels deep). Pages can be published or draft.
>
> Include full-text search powered by Meilisearch. Search should return results with highlighted snippets and be fast enough for real-time search-as-you-type in the UI.
>
> The CMS backend should use Django's admin interface, extended with:
> - Rich Markdown editor with live preview
> - Version history for each page (who changed what, when, with diff view)
> - Publish/unpublish toggle
> - Page ordering via drag-and-drop in the page tree
> - Bulk import from a directory of Markdown files
>
> The documentation content should be about a fictional developer API called "LaunchPad API" — a developer platform for deploying serverless functions. Write 15-20 pages of actual documentation covering: Getting Started, Authentication, API Reference (Functions, Deployments, Domains, Logs), SDKs (Node.js, Python), Webhooks, Rate Limits, and Error Handling.
>
> Include dark mode toggle, reading time estimate per page, and "Edit this page" link that points to the GitHub repo.
>
> Deploy to AWS: ECS Fargate for Django, RDS PostgreSQL for the database, a separate ECS service for Meilisearch. Use Terraform for all infrastructure.

---

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Django 5.1 | Mature, batteries-included, excellent admin |
| Templates | Django templates + HTMX | Server-rendered, minimal JS, interactive without SPA |
| Styling | TailwindCSS (via django-tailwind) | Utility-first, custom documentation theme |
| Markdown | markdown-it + Pygments | Extensible Markdown with syntax highlighting |
| Search | Meilisearch | Fast full-text search, easy to deploy, typo-tolerant |
| Database | PostgreSQL 16 | Reliable, Django-native support |
| Admin | Django Admin + django-unfold | Modern admin UI with Markdown editor |
| Testing | pytest-django + Playwright | Django tests + E2E |
| Linting | Ruff | Fast Python linter + formatter |
| Type Checking | mypy + django-stubs | Type safety for Django |
| Container | Docker (multi-stage) | Separate images for app and Meilisearch |
| IaC | Terraform | AWS resource provisioning |

### Data Model

```python
class DocSpace(models.Model):
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)
    is_public = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class DocPage(models.Model):
    doc_space = models.ForeignKey(DocSpace, on_delete=models.CASCADE, related_name="pages")
    title = models.CharField(max_length=255)
    slug = models.SlugField()
    content_markdown = models.TextField()
    content_html = models.TextField(blank=True)  # Pre-rendered on save
    summary = models.TextField(blank=True, max_length=500)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="children")
    order = models.IntegerField(default=0)
    is_published = models.BooleanField(default=False)
    reading_time_minutes = models.IntegerField(default=1)  # Calculated on save
    seo_title = models.CharField(max_length=255, blank=True)
    seo_description = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ["doc_space", "slug"]
        ordering = ["order"]

    def save(self, *args, **kwargs):
        self.content_html = render_markdown(self.content_markdown)
        self.reading_time_minutes = max(1, len(self.content_markdown.split()) // 200)
        super().save(*args, **kwargs)
        sync_to_meilisearch(self)  # Index for search

class DocPageVersion(models.Model):
    page = models.ForeignKey(DocPage, on_delete=models.CASCADE, related_name="versions")
    version_number = models.IntegerField()
    content_markdown = models.TextField()
    change_summary = models.CharField(max_length=500, blank=True)
    author = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["page", "version_number"]
        ordering = ["-version_number"]
```

### URL Routes (Django)

| URL Pattern | View | Purpose |
|-------------|------|---------|
| `/` | `landing` | Landing page with featured docs |
| `/docs/` | `space_list` | List of documentation spaces |
| `/docs/<space>/` | `space_overview` | Space overview with page tree |
| `/docs/<space>/<path:slug>/` | `page_view` | Documentation page view |
| `/search/` | `search` | Search results (HTMX partial for live search) |
| `/api/search/` | `search_api` | JSON search API for HTMX |
| `/admin/` | Django Admin | CMS backend |
| `/admin/pages/<id>/versions/` | `version_list` | Page version history |
| `/admin/pages/<id>/versions/<ver>/diff/` | `version_diff` | Side-by-side diff |
| `/health/` | `health_check` | Health check (DB + Meilisearch) |

### Documentation Content (Seed)

The tech_writer persona generates 15-20 pages of documentation for the fictional "LaunchPad API":

```
LaunchPad API Documentation
├── Getting Started
│   ├── Introduction
│   ├── Quick Start (deploy your first function in 5 minutes)
│   └── Authentication (API keys, OAuth tokens)
├── Core Concepts
│   ├── Functions (what they are, how they work)
│   ├── Deployments (lifecycle, rollbacks)
│   └── Domains (custom domains, SSL)
├── API Reference
│   ├── Functions API (CRUD endpoints with examples)
│   ├── Deployments API (create, list, rollback)
│   ├── Domains API (add, verify, remove)
│   └── Logs API (query, streaming)
├── SDKs
│   ├── Node.js SDK (install, usage, examples)
│   └── Python SDK (install, usage, examples)
├── Guides
│   ├── Webhooks (setup, events, verification)
│   ├── Environment Variables
│   └── CI/CD Integration
└── Reference
    ├── Rate Limits
    ├── Error Codes
    └── Changelog
```

Each page must have substantive content (300-800 words), not placeholder text. Code examples should be syntactically valid. API reference pages should include request/response examples.

### Infrastructure (Terraform — AWS)

```
infrastructure/
├── main.tf
├── variables.tf
├── outputs.tf
├── vpc.tf               # VPC, subnets, NAT gateway
├── ecs_app.tf           # ECS service for Django app
├── ecs_meilisearch.tf   # ECS service for Meilisearch
├── rds.tf               # RDS PostgreSQL
├── alb.tf               # ALB with path-based routing
├── efs.tf               # EFS volume for Meilisearch data persistence
├── ecr.tf               # ECR repositories (app + meilisearch config)
├── secrets.tf           # Secrets Manager
├── iam.tf               # Task roles
├── security_groups.tf   # ALB, App, Meilisearch, RDS
├── cloudwatch.tf        # Log groups
└── route53.tf           # DNS (docforge.workermill.com)
```

**Multi-service deployment:**
- Django app ECS service: 0.5 vCPU, 1 GB, port 8000
- Meilisearch ECS service: 0.25 vCPU, 512 MB, port 7700, EFS volume mounted for data
- ALB routes: `/` → Django, `/meilisearch/` → Meilisearch (internal only, not public)
- Django connects to Meilisearch via service discovery (Cloud Map) or ALB internal target group

### Quality Gates

| Gate | Threshold | Tool |
|------|-----------|------|
| Lint | 0 errors | Ruff |
| Types | 0 errors | mypy --strict |
| Tests | 100% pass, >70% coverage | pytest-django |
| E2E | Navigation, search, dark mode | Playwright |
| Security | 0 vulnerabilities | pip-audit + Django security check |
| Build | Docker images build | docker build |
| Search | Meilisearch healthy + indexed | Health check |
| Content | All 15+ pages render correctly | Automated page crawl |
| Accessibility | 0 violations on doc pages | axe-core |

### Acceptance Criteria

- [ ] Landing page shows featured documentation with clean design
- [ ] Sidebar navigation shows full page tree with expandable sections
- [ ] Documentation pages render Markdown with syntax-highlighted code blocks
- [ ] Table of contents auto-generates from h2/h3 headings with scroll-spy
- [ ] Previous/Next navigation works at bottom of each page
- [ ] Breadcrumbs show full path (Space > Section > Page)
- [ ] Search returns results with highlighted snippets in < 100ms
- [ ] Search-as-you-type works (HTMX partial updates)
- [ ] Dark mode toggle works and persists preference
- [ ] Reading time shows on each page
- [ ] Django admin allows creating/editing pages with Markdown preview
- [ ] Version history shows diffs between versions
- [ ] All 15+ documentation pages have substantive content (not placeholder)
- [ ] Code examples in documentation are syntactically valid
- [ ] Meilisearch is deployed as a separate service via Terraform
- [ ] Page load time < 1.5s (server-rendered, no heavy JS bundle)

---

## Project 5: EnvGuard

### Security CLI + Web Dashboard

**Tagline:** A secret scanning tool with a Go CLI and a Next.js tracking dashboard.

**What it demonstrates:** Multi-language capability (Go + TypeScript), non-web software (CLI), binary distribution via GitHub Releases, and security-focused tooling. The CLI is tangibly useful — visitors can download and run it on their own repos.

**Target audience resonance:** Security tooling is a growing market. DevSecOps teams need this. And the fact that the CLI is written in Go (not JavaScript) proves WorkerMill handles multiple languages.

---

### User Description

> Build a secret scanning tool with two components: a Go command-line tool and a Next.js web dashboard.
>
> **CLI Tool (Go):**
> The CLI scans codebases for accidentally committed secrets like API keys, passwords, tokens, and private keys. It should detect secrets using both regex pattern matching (for known formats like AWS keys, GitHub tokens, Stripe keys, etc.) and Shannon entropy analysis (for high-entropy strings that might be secrets).
>
> The CLI should scan:
> - All files in a directory (respecting .gitignore)
> - Specific file types (.env, .yml, .json, .toml, .ini, .cfg, config files)
> - Git history (scan diffs from git log to find secrets in past commits)
>
> Output formats: table (human-readable, default), JSON, SARIF (for CI integration). Exit code 0 if no findings, 1 if secrets found (for CI pipeline gating).
>
> Include a configuration file (.envguard.yml) for custom rules, path exclusions, and severity overrides. Ship with 30+ built-in detection rules covering AWS, GCP, Azure, GitHub, GitLab, Stripe, Twilio, SendGrid, Slack, database connection strings, private keys, and generic high-entropy strings.
>
> The CLI can optionally push scan results to the EnvGuard dashboard via `envguard push --project-key=KEY`.
>
> **Web Dashboard (Next.js):**
> A web interface for tracking scan results across projects over time. Features:
> - Project list with latest scan status (clean/findings) and trend sparkline
> - Scan detail view: findings grouped by severity (critical/high/medium/low), with file path, line number, code snippet (with the secret partially masked), and detection rule name
> - Finding management: mark as false positive, accepted risk, or resolved
> - Trend charts: findings over time (line), by severity (stacked bar), by rule (horizontal bar)
> - API key management for CLI authentication
>
> Build the CLI with goreleaser for cross-platform binaries (Linux, macOS, Windows, both amd64 and arm64). Publish to GitHub Releases.
>
> Deploy the dashboard to AWS App Runner with RDS PostgreSQL via Terraform.

---

### Tech Stack

**CLI:**

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | Go 1.22+ | Fast execution, single binary distribution, strong stdlib |
| CLI Framework | Cobra + Viper | Standard Go CLI framework with config file support |
| Regex | regexp2 | .NET-compatible regex for complex patterns |
| Git | go-git | Pure Go git implementation (no git binary dependency) |
| Output | tablewriter (table), encoding/json (JSON), custom (SARIF) | Multiple output formats |
| Testing | Go testing + testify | Standard Go testing |
| Distribution | GoReleaser | Cross-platform binary builds + GitHub Releases |
| Linting | golangci-lint | Comprehensive Go linter |

**Dashboard:**

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Next.js 15 (App Router) | Full-stack React |
| ORM | Prisma | Type-safe database access |
| Database | PostgreSQL 16 | Reliable, JSON support |
| Auth | API key-based (for CLI), session-based (for dashboard) | Simple, appropriate for the use case |
| Charts | Recharts | Consistent with other showcases |
| Styling | TailwindCSS + shadcn/ui | Clean dashboard design |
| Testing | Vitest + Playwright | Unit + E2E |

### CLI Commands

```
envguard - Scan codebases for accidentally committed secrets

Usage:
  envguard [command]

Commands:
  scan        Scan a directory for secrets
  scan-history Scan git history for secrets in past commits
  init        Create a .envguard.yml configuration file
  push        Push scan results to EnvGuard dashboard
  rules       List all built-in detection rules
  version     Print version information

Flags:
  -c, --config string    Config file (default ".envguard.yml")
  -f, --format string    Output format: table, json, sarif (default "table")
  -s, --severity string  Minimum severity to report: low, medium, high, critical (default "low")
  -q, --quiet            Only output findings (no banner, no summary)
      --no-color         Disable colored output
  -h, --help             Help for envguard

Examples:
  envguard scan .                          # Scan current directory
  envguard scan ./src --format json        # Scan src/ with JSON output
  envguard scan . --severity high          # Only high and critical findings
  envguard scan-history . --depth 100      # Scan last 100 commits
  envguard scan . --format sarif > results.sarif  # SARIF for CI
  envguard push --project-key pk_abc123    # Push results to dashboard
  envguard rules                           # List all detection rules
```

### Detection Rules (30+ Built-in)

```yaml
# Built-in rules (compiled into binary, overridable via .envguard.yml)
rules:
  # AWS
  - id: aws-access-key
    name: AWS Access Key ID
    severity: critical
    pattern: '(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}'
  - id: aws-secret-key
    name: AWS Secret Access Key
    severity: critical
    pattern: '(?i)aws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}'

  # GCP
  - id: gcp-service-account
    name: GCP Service Account Key
    severity: critical
    pattern: '"type"\s*:\s*"service_account"'
    file_types: [".json"]

  # Azure
  - id: azure-connection-string
    name: Azure Storage Connection String
    severity: high
    pattern: 'DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{88}'

  # GitHub
  - id: github-pat
    name: GitHub Personal Access Token
    severity: critical
    pattern: 'ghp_[A-Za-z0-9]{36}'
  - id: github-oauth
    name: GitHub OAuth Token
    severity: critical
    pattern: 'gho_[A-Za-z0-9]{36}'
  - id: github-fine-grained
    name: GitHub Fine-Grained Token
    severity: critical
    pattern: 'github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}'

  # GitLab
  - id: gitlab-pat
    name: GitLab Personal Access Token
    severity: critical
    pattern: 'glpat-[A-Za-z0-9\-]{20}'

  # Stripe
  - id: stripe-secret
    name: Stripe Secret Key
    severity: critical
    pattern: 'sk_live_[A-Za-z0-9]{24,}'
  - id: stripe-restricted
    name: Stripe Restricted Key
    severity: high
    pattern: 'rk_live_[A-Za-z0-9]{24,}'

  # Database
  - id: postgres-url
    name: PostgreSQL Connection URL
    severity: high
    pattern: 'postgres(?:ql)?://[^:]+:[^@]+@[^/]+/\w+'
  - id: mysql-url
    name: MySQL Connection URL
    severity: high
    pattern: 'mysql://[^:]+:[^@]+@[^/]+/\w+'
  - id: mongodb-url
    name: MongoDB Connection URL
    severity: high
    pattern: 'mongodb(?:\+srv)?://[^:]+:[^@]+@'

  # Communication
  - id: slack-webhook
    name: Slack Webhook URL
    severity: high
    pattern: 'https://hooks\.slack\.com/services/T[A-Z0-9]{8,}/B[A-Z0-9]{8,}/[A-Za-z0-9]{24}'
  - id: slack-bot-token
    name: Slack Bot Token
    severity: critical
    pattern: 'xoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24}'
  - id: twilio-api-key
    name: Twilio API Key
    severity: high
    pattern: 'SK[a-f0-9]{32}'
  - id: sendgrid-api-key
    name: SendGrid API Key
    severity: high
    pattern: 'SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43}'

  # Private Keys
  - id: private-key-rsa
    name: RSA Private Key
    severity: critical
    pattern: '-----BEGIN RSA PRIVATE KEY-----'
  - id: private-key-ec
    name: EC Private Key
    severity: critical
    pattern: '-----BEGIN EC PRIVATE KEY-----'
  - id: private-key-openssh
    name: OpenSSH Private Key
    severity: critical
    pattern: '-----BEGIN OPENSSH PRIVATE KEY-----'

  # Generic
  - id: generic-api-key
    name: Generic API Key Assignment
    severity: medium
    pattern: '(?i)(?:api[_-]?key|apikey)\s*[=:]\s*["\x27][A-Za-z0-9\-_]{20,}["\x27]'
  - id: generic-secret
    name: Generic Secret Assignment
    severity: medium
    pattern: '(?i)(?:secret|password|passwd|pwd)\s*[=:]\s*["\x27][^\s"\x27]{8,}["\x27]'
  - id: generic-token
    name: Generic Token Assignment
    severity: medium
    pattern: '(?i)(?:token|bearer)\s*[=:]\s*["\x27][A-Za-z0-9\-_.]{20,}["\x27]'

  # Entropy-based (no regex, uses Shannon entropy)
  - id: high-entropy-hex
    name: High-Entropy Hex String
    severity: low
    entropy: { charset: hex, min_length: 32, threshold: 3.5 }
  - id: high-entropy-base64
    name: High-Entropy Base64 String
    severity: low
    entropy: { charset: base64, min_length: 32, threshold: 4.0 }
```

### Dashboard Data Model

```prisma
model Project {
  id          String   @id @default(cuid())
  name        String
  repoUrl     String?
  apiKey      String   @unique  // pk_... for CLI push authentication
  createdAt   DateTime @default(now())
  scans       Scan[]
}

model Scan {
  id            String   @id @default(cuid())
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId     String
  commitSha     String?
  branch        String?
  findingsCount Int
  status        String   // clean, findings
  cliVersion    String
  duration_ms   Int
  startedAt     DateTime
  completedAt   DateTime
  createdAt     DateTime @default(now())
  findings      Finding[]
}

model Finding {
  id          String   @id @default(cuid())
  scan        Scan     @relation(fields: [scanId], references: [id], onDelete: Cascade)
  scanId      String
  ruleId      String
  ruleName    String
  severity    String   // critical, high, medium, low
  filePath    String
  lineNumber  Int
  snippet     String   // Code snippet with secret partially masked
  status      String   @default("open")  // open, false_positive, accepted, resolved
  resolvedAt  DateTime?
  resolvedBy  String?
  createdAt   DateTime @default(now())
}
```

### Dashboard API

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `POST /api/projects` | POST | Create project (returns API key) | Session |
| `GET /api/projects` | GET | List projects with latest scan | Session |
| `GET /api/projects/[id]` | GET | Project detail with scan history | Session |
| `DELETE /api/projects/[id]` | DELETE | Delete project | Session |
| `POST /api/scans` | POST | CLI pushes scan results | API Key |
| `GET /api/scans/[id]` | GET | Scan detail with findings | Session |
| `PUT /api/findings/[id]` | PUT | Update finding status | Session |
| `GET /api/projects/[id]/trends` | GET | Trend data for charts | Session |
| `POST /api/auth/login` | POST | Dashboard login | Public |
| `GET /api/health` | GET | Health check | Public |

### Infrastructure (Terraform — AWS)

```
infrastructure/
├── main.tf
├── variables.tf
├── outputs.tf
├── app_runner.tf        # AWS App Runner service for dashboard
├── rds.tf               # RDS PostgreSQL
├── ecr.tf               # ECR repository for dashboard image
├── secrets.tf           # Secrets Manager
├── iam.tf               # App Runner instance role, ECR access
├── security_groups.tf   # RDS SG
├── vpc.tf               # VPC connector for App Runner → RDS
└── route53.tf           # DNS (envguard.workermill.com)
```

### CI/CD Pipeline

```yaml
# Two parallel CI jobs: Go CLI + Next.js Dashboard
name: CI
on: [push, pull_request]
jobs:
  cli:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - run: cd cli && golangci-lint run ./...
      - run: cd cli && go vet ./...
      - run: cd cli && go test -v -race -coverprofile=coverage.out ./...
      - run: cd cli && gosec ./...  # Security scan

  dashboard:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: test, POSTGRES_PASSWORD: test, POSTGRES_DB: envguard_test }
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: cd dashboard && npm ci
      - run: cd dashboard && npm run lint
      - run: cd dashboard && npm run typecheck
      - run: cd dashboard && npm run test
        env: { DATABASE_URL: postgresql://test:test@localhost:5432/envguard_test }
      - run: cd dashboard && npm audit --audit-level=high

# Release CLI binaries on tag
name: Release CLI
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - uses: goreleaser/goreleaser-action@v5
        with:
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# Deploy dashboard
name: Deploy Dashboard
on:
  push:
    branches: [main]
    paths: ['dashboard/**', 'infrastructure/**']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      # Build + push to ECR + terraform apply + smoke test
      # (similar pattern to ShipAPI)
```

### GoReleaser Config

```yaml
# cli/.goreleaser.yml
builds:
  - main: ./cmd/envguard
    binary: envguard
    env: [CGO_ENABLED=0]
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
    ldflags:
      - -s -w -X main.version={{.Version}} -X main.commit={{.ShortCommit}}

archives:
  - format: tar.gz
    format_overrides:
      - goos: windows
        format: zip
    name_template: "envguard_{{ .Version }}_{{ .Os }}_{{ .Arch }}"

checksum:
  name_template: 'checksums.txt'

changelog:
  sort: asc
  filters:
    exclude: ['^docs:', '^test:', '^ci:']
```

### Test Repository (for demo scans)

Create a companion repo `workermill-examples/envguard-test-repo` with intentionally planted secrets in various formats:
- `.env.example` with realistic-looking (but fake) API keys
- A Python file with a hardcoded database URL
- A JSON config with a service account key
- Git history with a secret that was added then removed
- A YAML file with high-entropy strings

This allows visitors to run `envguard scan envguard-test-repo/` and see the tool work.

### Quality Gates

| Gate | Threshold | Tool |
|------|-----------|------|
| Go lint | 0 errors | golangci-lint |
| Go vet | 0 errors | go vet |
| Go tests | 100% pass, >80% coverage | go test |
| Go security | 0 findings | gosec |
| Dashboard lint | 0 errors | ESLint |
| Dashboard types | 0 errors | tsc --noEmit |
| Dashboard tests | 100% pass | Vitest |
| Dashboard security | 0 high/critical | npm audit |
| Binary builds | All 6 targets build | goreleaser |
| Integration test | CLI → Dashboard push works | E2E test |

### Acceptance Criteria

- [ ] `envguard scan` on the test repo finds all planted secrets and reports them
- [ ] Output formats (table, JSON, SARIF) are all correct and parseable
- [ ] `envguard scan-history` finds secrets in git history
- [ ] Exit code is 0 for clean repos, 1 for repos with findings
- [ ] `.envguard.yml` config file is respected (custom rules, exclusions)
- [ ] `envguard rules` lists all 30+ built-in rules
- [ ] `envguard push` successfully sends results to the dashboard
- [ ] Dashboard shows project list with scan status
- [ ] Dashboard scan detail shows findings grouped by severity with masked snippets
- [ ] Findings can be marked as false positive, accepted risk, or resolved
- [ ] Trend charts show findings over time
- [ ] GitHub Releases has binaries for Linux/macOS/Windows (amd64/arm64)
- [ ] CLI binary runs without dependencies (static compilation)
- [ ] Dashboard is deployed to AWS App Runner via Terraform

---

## Project 6: OrderFlow

### Event-Driven Microservices

**Tagline:** A 3-service order processing system with message queues and a monitoring dashboard.

**What it demonstrates:** The most architecturally ambitious showcase — multiple independently deployed services communicating via AWS SQS, with a monitoring dashboard showing message flow in real-time. Proves WorkerMill can handle multi-service deployments, infrastructure orchestration, and complex system design.

**Target audience resonance:** This is how real production systems are built. Enterprise evaluators and startup CTOs will recognize the pattern. The monitoring dashboard showing services communicating is visually compelling proof that the whole system works.

---

### User Description

> Build an event-driven order processing system with 3 microservices and a monitoring dashboard.
>
> **Order Service:**
> Accepts new orders via REST API. Each order has a customer name, email, line items (product name, quantity, unit price), and a total amount. When an order is created, it publishes an "OrderCreated" event to a message queue. Orders have statuses: pending, payment_processing, paid, payment_failed, fulfilled, cancelled.
>
> **Payment Service:**
> Consumes "OrderCreated" events from the queue. Simulates payment processing with a configurable success rate (default 85%). Publishes either "PaymentCompleted" or "PaymentFailed" events. Records payment attempts with a mock provider reference ID.
>
> **Notification Service:**
> Consumes "PaymentCompleted" and "PaymentFailed" events. For successful payments, posts an order confirmation to a configurable webhook URL. For failed payments, posts a payment failure notification. Tracks all sent notifications with delivery status.
>
> **Monitoring Dashboard:**
> A React dashboard showing the entire system in real-time:
> - Service health cards for each service (up/down based on health checks)
> - Animated message flow diagram: Order Service → [SQS] → Payment Service → [SQS] → Notification Service, with messages visually flowing between services
> - Live event log showing every event as it moves through the system
> - Order lifecycle tracker: select an order and see it move through each stage
> - Metrics: orders/minute, payment success rate, average processing time, notification delivery rate
> - Demo mode toggle that auto-generates orders at a configurable rate
>
> Each service should have its own `/health` endpoint, basic structured JSON logging, and error handling. Services should be resilient to transient failures (retry with exponential backoff on queue operations).
>
> Use AWS SQS for message queuing. Deploy all 4 components (3 services + dashboard) to AWS ECS Fargate with Terraform. Each service gets its own ECS task definition. Use an ALB with path-based routing.

---

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Services | Express + TypeScript | Consistent stack, lightweight |
| Queue | AWS SQS | Managed, no operational overhead, reliable |
| Database | PostgreSQL 16 (shared, schema-per-service) | Simple for showcase, schema isolation |
| Dashboard | React 19 + Vite + Recharts | Real-time UI with charts |
| Real-time | WebSocket (Socket.io) from monitoring service | Dashboard live updates |
| Testing | Vitest + Supertest | Service-level tests |
| Container | Docker (per-service images) | Independent deployment |
| IaC | Terraform | AWS resource provisioning |
| CI/CD | GitHub Actions | Per-service build + deploy |

### Service Architecture

```
                        ┌─────────────┐
                        │   Client    │
                        └─────┬───────┘
                              │ POST /api/orders
                              ▼
                     ┌─────────────────┐
                     │  Order Service  │──────▶ PostgreSQL (orders schema)
                     │   :3001        │
                     └────────┬────────┘
                              │ Publish: OrderCreated
                              ▼
                     ┌─────────────────┐
                     │  order-events   │  (SQS Queue)
                     │     queue       │
                     └────────┬────────┘
                              │ Consume
                              ▼
                     ┌─────────────────┐
                     │ Payment Service │──────▶ PostgreSQL (payments schema)
                     │   :3002        │
                     └────────┬────────┘
                              │ Publish: PaymentCompleted / PaymentFailed
                              ▼
                     ┌─────────────────┐
                     │ payment-events  │  (SQS Queue)
                     │     queue       │
                     └────────┬────────┘
                              │ Consume
                              ▼
                     ┌──────────────────────┐
                     │ Notification Service │──────▶ PostgreSQL (notifications schema)
                     │   :3003             │──────▶ Webhook URL
                     └──────────────────────┘

                     ┌──────────────────────┐
                     │ Monitoring Dashboard │──────▶ Polls all 3 service /health endpoints
                     │   :3000             │──────▶ Subscribes to all 3 event streams
                     │                      │──────▶ WebSocket to browser
                     └──────────────────────┘
```

### Data Models (Per-Service)

**Order Service (schema: orders)**
```sql
CREATE TABLE orders.orders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name   VARCHAR(255) NOT NULL,
    customer_email  VARCHAR(255) NOT NULL,
    status          VARCHAR(50) NOT NULL DEFAULT 'pending',
    total_amount    NUMERIC(10,2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders.order_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders.orders(id),
    product_name VARCHAR(255) NOT NULL,
    quantity    INT NOT NULL,
    unit_price  NUMERIC(10,2) NOT NULL
);

CREATE TABLE orders.order_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders.orders(id),
    event_type  VARCHAR(50) NOT NULL,  -- created, payment_processing, paid, payment_failed, fulfilled, cancelled
    data        JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Payment Service (schema: payments)**
```sql
CREATE TABLE payments.payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL,
    amount          NUMERIC(10,2) NOT NULL,
    status          VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending, completed, failed
    provider_ref    VARCHAR(100),  -- mock: "pay_" + random string
    failure_reason  VARCHAR(500),
    attempts        INT NOT NULL DEFAULT 0,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Notification Service (schema: notifications)**
```sql
CREATE TABLE notifications.notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL,
    type        VARCHAR(50) NOT NULL,    -- order_confirmation, payment_failed
    channel     VARCHAR(50) NOT NULL DEFAULT 'webhook',
    payload     JSONB NOT NULL,
    status      VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending, sent, failed
    webhook_url VARCHAR(500),
    response_code INT,
    sent_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### API Endpoints (Per-Service)

**Order Service (:3001)**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /api/orders` | POST | Create order → publishes OrderCreated |
| `GET /api/orders` | GET | List orders (paginated, filterable by status) |
| `GET /api/orders/:id` | GET | Order detail with items and event timeline |
| `POST /api/orders/:id/cancel` | POST | Cancel order → publishes OrderCancelled |
| `GET /api/orders/stats` | GET | Order metrics (count by status, total revenue, avg order value) |
| `GET /api/orders/events/stream` | GET | SSE stream of order events (for monitoring) |
| `GET /health` | GET | Health check (DB + SQS) |

**Payment Service (:3002)**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/payments` | GET | List payments (paginated) |
| `GET /api/payments/:id` | GET | Payment detail |
| `GET /api/payments/stats` | GET | Payment metrics (success rate, avg time, total processed) |
| `GET /api/payments/events/stream` | GET | SSE stream of payment events |
| `PUT /api/payments/config` | PUT | Update success rate (for demo) |
| `GET /health` | GET | Health check (DB + SQS) |

**Notification Service (:3003)**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/notifications` | GET | List notifications (paginated) |
| `GET /api/notifications/:id` | GET | Notification detail |
| `GET /api/notifications/stats` | GET | Notification metrics (delivery rate, by type) |
| `GET /api/notifications/events/stream` | GET | SSE stream of notification events |
| `PUT /api/notifications/config` | PUT | Update webhook URL |
| `GET /health` | GET | Health check (DB + SQS) |

### SQS Message Formats

**OrderCreated:**
```json
{
  "eventType": "OrderCreated",
  "orderId": "uuid",
  "customerName": "Jane Doe",
  "customerEmail": "jane@example.com",
  "totalAmount": 149.99,
  "items": [
    { "productName": "Widget Pro", "quantity": 2, "unitPrice": 49.99 },
    { "productName": "Gadget X", "quantity": 1, "unitPrice": 50.01 }
  ],
  "timestamp": "2026-02-05T12:00:00Z"
}
```

**PaymentCompleted:**
```json
{
  "eventType": "PaymentCompleted",
  "orderId": "uuid",
  "paymentId": "uuid",
  "amount": 149.99,
  "providerRef": "pay_abc123def456",
  "timestamp": "2026-02-05T12:00:03Z"
}
```

**PaymentFailed:**
```json
{
  "eventType": "PaymentFailed",
  "orderId": "uuid",
  "paymentId": "uuid",
  "amount": 149.99,
  "reason": "Insufficient funds",
  "timestamp": "2026-02-05T12:00:03Z"
}
```

### Monitoring Dashboard UI

**Layout:** Dark theme with service-oriented layout.

**Row 1 — Service Status (3 cards):**
| Order Service | Payment Service | Notification Service |
| Status: UP/DOWN | Status: UP/DOWN | Status: UP/DOWN |
| Orders/min: 5.2 | Success rate: 85% | Delivery rate: 99% |
| Avg value: $74.50 | Avg process time: 2.1s | Pending: 0 |

**Row 2 — Message Flow Visualization (full width):**
```
┌──────────┐        ┌─────────┐        ┌──────────┐        ┌─────────┐        ┌────────────┐
│  Order   │──●──▶│  order- │──●──▶│ Payment │──●──▶│ payment│──●──▶│ Notification│
│ Service  │ ●    │  events │  ●   │ Service │  ●   │ events │  ●   │  Service    │
└──────────┘      └─────────┘      └──────────┘      └─────────┘      └────────────┘
                  Queue: 2                            Queue: 0
```
Animated dots flow between services. Queue depths shown. Clicking a service shows its recent events.

**Row 3 — Charts (2 columns):**
| Line chart: Orders over time (5min intervals) | Stacked bar: Order status distribution |
| With payment success/fail overlay | pending, paid, failed, cancelled |

**Row 4 — Live Event Log (full width):**
| Timestamp | Service | Event | Order ID | Details |
| Auto-scrolling, color-coded by service (blue=order, green=payment, orange=notification) |

**Row 5 — Order Lifecycle Tracker:**
Search by order ID → shows timeline:
`Created → Payment Processing → [Paid/Failed] → [Notification Sent] → Fulfilled`
with timestamps and details at each stage.

**Demo Mode:**
Toggle in the top-right corner. When enabled, auto-generates 2-5 orders per minute with random products, quantities, and customer names. Visitors see the entire system processing orders in real-time.

### Infrastructure (Terraform — AWS)

```
infrastructure/
├── main.tf
├── variables.tf
├── outputs.tf
├── vpc.tf               # VPC, subnets (public + private), NAT gateway
├── ecs_cluster.tf       # Shared ECS cluster
├── ecs_order.tf         # Order Service task def + service
├── ecs_payment.tf       # Payment Service task def + service
├── ecs_notification.tf  # Notification Service task def + service
├── ecs_monitor.tf       # Monitoring Dashboard task def + service
├── rds.tf               # Shared RDS instance (schema-per-service isolation)
├── sqs.tf               # order-events queue + payment-events queue + DLQs
├── alb.tf               # ALB with path-based routing to each service
├── ecr.tf               # 4 ECR repositories
├── secrets.tf           # DB credentials, webhook URLs
├── iam.tf               # Per-service task roles (SQS permissions scoped per service)
├── security_groups.tf   # ALB, ECS (per-service), RDS
├── cloudwatch.tf        # Per-service log groups
├── service_discovery.tf # Cloud Map for inter-service communication (optional)
└── route53.tf           # DNS (orderflow.workermill.com)
```

**Key resources:**
- ECS Cluster with 4 Fargate services
- Order Service: 0.25 vCPU, 512 MB, SQS SendMessage permission on order-events
- Payment Service: 0.25 vCPU, 512 MB, SQS ReceiveMessage on order-events, SendMessage on payment-events
- Notification Service: 0.25 vCPU, 512 MB, SQS ReceiveMessage on payment-events
- Monitoring Dashboard: 0.25 vCPU, 512 MB, no SQS permissions (reads via service APIs)
- 2 SQS queues (order-events, payment-events) + 2 dead-letter queues
- ALB with path-based routing:
  - `/api/orders*` → Order Service
  - `/api/payments*` → Payment Service
  - `/api/notifications*` → Notification Service
  - `/*` → Monitoring Dashboard
- RDS PostgreSQL with 3 schemas (orders, payments, notifications)
- IAM roles scoped per service (principle of least privilege)

### CI/CD Pipeline

```yaml
# Monorepo structure: services/order, services/payment, services/notification, dashboard/
name: CI
on: [push, pull_request]
jobs:
  order-service:
    runs-on: ubuntu-latest
    defaults:
      run: { working-directory: services/order }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test

  payment-service:
    runs-on: ubuntu-latest
    defaults:
      run: { working-directory: services/payment }
    steps:
      # Same as order-service

  notification-service:
    runs-on: ubuntu-latest
    defaults:
      run: { working-directory: services/notification }
    steps:
      # Same as order-service

  dashboard:
    runs-on: ubuntu-latest
    defaults:
      run: { working-directory: dashboard }
    steps:
      # Lint, typecheck, test, build

  integration:
    needs: [order-service, payment-service, notification-service]
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: test, POSTGRES_PASSWORD: test, POSTGRES_DB: orderflow_test }
        ports: ['5432:5432']
      localstack:
        image: localstack/localstack:latest
        ports: ['4566:4566']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Setup SQS queues in LocalStack
        run: |
          aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name order-events
          aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name payment-events
      - name: Start all services
        run: |
          # Start each service in background, run integration tests
          npm run test:integration
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/orderflow_test
          SQS_ENDPOINT: http://localhost:4566

# Deploy (triggered on main push)
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1
      - name: Build and push all images
        run: |
          for svc in order payment notification; do
            docker build -t $ECR_REGISTRY/orderflow-$svc:${{ github.sha }} services/$svc
            docker push $ECR_REGISTRY/orderflow-$svc:${{ github.sha }}
          done
          docker build -t $ECR_REGISTRY/orderflow-dashboard:${{ github.sha }} dashboard
          docker push $ECR_REGISTRY/orderflow-dashboard:${{ github.sha }}
      - uses: hashicorp/setup-terraform@v3
      - name: Terraform apply
        working-directory: infrastructure
        run: |
          terraform init
          terraform apply -auto-approve \
            -var="order_image_tag=${{ github.sha }}" \
            -var="payment_image_tag=${{ github.sha }}" \
            -var="notification_image_tag=${{ github.sha }}" \
            -var="dashboard_image_tag=${{ github.sha }}"
      - name: Smoke tests
        run: |
          sleep 90  # Wait for all 4 ECS services to stabilize
          # Health checks
          curl -f https://orderflow.workermill.com/api/orders/health
          curl -f https://orderflow.workermill.com/api/payments/health
          curl -f https://orderflow.workermill.com/api/notifications/health
          curl -f https://orderflow.workermill.com/
          # Integration: create order and verify it flows through
          ORDER_ID=$(curl -s -X POST https://orderflow.workermill.com/api/orders \
            -H 'Content-Type: application/json' \
            -d '{"customerName":"Smoke Test","customerEmail":"test@test.com","items":[{"productName":"Test Item","quantity":1,"unitPrice":9.99}]}' \
            | jq -r '.id')
          sleep 15  # Wait for async processing
          STATUS=$(curl -s https://orderflow.workermill.com/api/orders/$ORDER_ID | jq -r '.status')
          [ "$STATUS" = "paid" ] || [ "$STATUS" = "payment_failed" ] || exit 1
```

### Quality Gates

| Gate | Threshold | Tool |
|------|-----------|------|
| Lint (all services) | 0 errors | ESLint |
| Types (all services) | 0 errors | tsc --noEmit |
| Unit tests (per service) | 100% pass, >70% coverage | Vitest |
| Integration tests | Order flows through all 3 services | Custom test harness |
| Security | 0 high/critical per service | npm audit |
| Build | All 4 Docker images build | docker build |
| Smoke test | All health checks pass + order flows end-to-end | curl |
| IAM | Principle of least privilege verified | terraform plan review |

### Acceptance Criteria

- [ ] Creating an order via API triggers the full pipeline: Order → Payment → Notification
- [ ] Successful orders reach "paid" status within 10 seconds
- [ ] Failed payments result in "payment_failed" status with reason
- [ ] Payment success rate matches the configured rate (~85%)
- [ ] Notification service posts to the configured webhook URL
- [ ] Monitoring dashboard shows all 3 services with health status
- [ ] Message flow visualization shows animated dots moving between services
- [ ] Live event log updates in real-time as orders flow through
- [ ] Order lifecycle tracker shows the full journey of a single order
- [ ] Metrics are accurate (orders/min, success rate, processing time)
- [ ] Demo mode generates orders automatically at a visible rate
- [ ] SQS dead-letter queues exist and capture failed messages
- [ ] Each service has its own IAM role with minimal permissions
- [ ] All 4 ECS services are independently deployable
- [ ] ALB path-based routing correctly routes to each service

---

## Showcase Presentation

### Per-Project Public Artifacts

Each showcase publishes:

1. **Live URL** — `{project}.workermill.com` — visitors can interact immediately
2. **GitHub Repo** — `github.com/workermill-examples/{project}` — full source, IaC, CI/CD, tests
3. **WorkerMill Task Log** — `workermill.com/showcase/{project}` — the full build story:
   - Story decomposition with dependency graph
   - Expert coordination feed (who said what to whom)
   - Quality gate results per story
   - Cost breakdown (LLM tokens + compute)
   - Time to completion
   - Iteration count (how many CI/CD cycles before green)
4. **WORKERMILL.md** — In the repo root, containing:
   - Build date
   - Total cost (LLM + compute)
   - Total time (first commit to deployed)
   - Story count and personas used
   - Iteration count (CI failures before success)
   - Quality scores (lint, types, tests, security)
   - Link to full task log on workermill.com

### Showcase Gallery Page

The gallery at `workermill.com/showcase` displays all projects in a grid:

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   TeamBoard      │  │    ShipAPI       │  │   PulseView      │
│   [screenshot]   │  │   [screenshot]   │  │   [screenshot]   │
│                  │  │                  │  │                  │
│ Next.js + Prisma │  │ FastAPI + SQLAlc │  │ Express + React  │
│ 10 stories       │  │ 8 stories        │  │ 12 stories       │
│ $14.20 | 48 min  │  │ $9.80 | 35 min   │  │ $18.40 | 62 min  │
│ AWS (Neon)       │  │ AWS (Terraform)  │  │ GCP (Terraform)  │
│                  │  │                  │  │                  │
│ [Live] [Code]    │  │ [Docs] [Code]    │  │ [Live] [Code]    │
│ [Build Log]      │  │ [Build Log]      │  │ [Build Log]      │
└──────────────────┘  └──────────────────┘  └──────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   DocForge       │  │   EnvGuard       │  │   OrderFlow      │
│   [screenshot]   │  │   [screenshot]   │  │   [screenshot]   │
│                  │  │                  │  │                  │
│ Django + HTMX    │  │ Go + Next.js     │  │ Express × 3 svc  │
│ 10 stories       │  │ 12 stories       │  │ 14 stories       │
│ $12.60 | 42 min  │  │ $22.30 | 75 min  │  │ $28.50 | 95 min  │
│ AWS (Terraform)  │  │ AWS + GH Releases│  │ AWS (Terraform)  │
│                  │  │                  │  │                  │
│ [Live] [Code]    │  │ [Download] [Code]│  │ [Live] [Code]    │
│ [Build Log]      │  │ [Build Log]      │  │ [Build Log]      │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

### Build Order

| Priority | Project | Rationale |
|----------|---------|-----------|
| 1st | **ShipAPI** | Simplest to get right. Full Terraform → AWS is the most impressive deployment story. Backend audience is most likely early adopter. If this one fails, we learn fast. |
| 2nd | **TeamBoard** | The "hero demo" visitors click around in. Most visually impressive. Vercel deployment is lower risk. |
| 3rd | **PulseView** | Proves multi-cloud (GCP). The always-alive demo generator means it's never an empty dashboard. Visual wow factor. |
| 4th | **EnvGuard** | Proves multi-language (Go). The CLI is tangibly useful. GitHub Releases is a different distribution model. |
| 5th | **DocForge** | Proves non-JS stack (Django). Multi-service AWS deployment. Content generation tests the tech_writer persona. |
| 6th | **OrderFlow** | Most ambitious. Only attempt after the first 5 succeed. Most impressive if it works. |
