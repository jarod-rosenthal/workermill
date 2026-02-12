# TeamBoard — Production Deploy

> Built by WorkerMill | Ticket 5 of 5

## Tech Stack

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
| CI/CD | GitHub Actions (`ubuntu-latest`) | Automated test + deploy pipeline, free for public repos |
| Hosting | Vercel | Automatic deploys, edge functions |
| Database Hosting | Neon PostgreSQL | Free tier, connection pooling, branching |

## Prerequisites

TB-3 is complete minimum. TB-4 is nice-to-have.

What must be in place:
- Full UI working (landing page, auth, workspaces, boards, dashboard, activity, members, settings)
- All 28 API routes functional
- Kanban board with drag-and-drop
- Real-time updates via SSE
- CI/CD pipelines configured and passing
- Seed data script creates demo workspace with 3 boards, 30 cards, 25 activities
- Demo user: `demo@workermill.com` / `demo1234`

## What This Ticket Delivers

Production deployment verified end-to-end. The live URL is functional, seeded with demo data, and passing all smoke tests. CI/CD pipeline is fully operational.

---

## Phases

### Phase 5.1 — Production Environment Configuration

**All infrastructure is pre-configured.** Vercel project, Neon database, DNS, env vars, and GitHub secrets were set up during bootstrapping.

| Resource | Status |
|----------|--------|
| Vercel project (Next.js, Node 22) | Pre-configured |
| Custom domain (`teamboard.workermill.com`) | DNS CNAME + Vercel verified |
| Neon PostgreSQL | Provisioned |
| Vercel env vars (5) | Set |
| GitHub secrets (8) | Set |
| GitHub -> Vercel auto-deploy | Enabled |
| SSL certificate | Automatic via Vercel |

**What workers verify:** Push to main triggers a Vercel deploy and the site loads at `https://teamboard.workermill.com`.

**Acceptance criteria:**
- Custom domain resolves to Vercel with HTTPS
- Build succeeds on Vercel
- Auto-deploy triggers on push to main

### Phase 5.2 — Database Migration & Seed

1. Run Prisma migrations against production Neon database
2. Run seed script to populate demo data
3. Verify data via API endpoints

```bash
# From CI/CD pipeline or manual:
DATABASE_URL=$PRODUCTION_DATABASE_URL npx prisma migrate deploy
DATABASE_URL=$PRODUCTION_DATABASE_URL npx tsx prisma/seed.ts
```

**Acceptance criteria:**
- All tables created in production database
- Seed data loaded (demo user, workspace, boards, cards, activities)
- `demo@workermill.com` / `demo1234` can authenticate
- API returns seeded data correctly

### Phase 5.3 — CI/CD Pipeline Verification

Verify the full CI/CD pipeline works end-to-end:

1. **CI gate works:** Push a branch -> CI runs (lint, typecheck, test, e2e) on `ubuntu-latest` -> All pass
2. **Deploy gate works:** Merge to main -> Vercel auto-deploys -> Post-deploy workflow runs migrations + smoke test
3. **Failure handling:** Intentionally break a test -> CI blocks merge

**Pipeline flow:**
```
Push to branch
  -> CI: lint -> typecheck -> unit tests -> e2e tests
  -> All pass -> PR mergeable

Merge to main
  -> Vercel auto-deploys via GitHub integration
  -> Post-deploy workflow: prisma migrate -> seed -> smoke test
  -> Deployment live at teamboard.workermill.com
```

**Acceptance criteria:**
- CI runs on every push and PR (`ubuntu-latest`)
- Vercel auto-deploys on merge to main
- Failed CI blocks PR merge (branch protection rule set)
- Smoke test (`/api/health`) passes post-deploy

### Phase 5.4 — Smoke Tests & Validation

Run the full smoke test suite against production:

```bash
# 1. Health check
curl -f https://teamboard.workermill.com/api/health

# 2. Auth works — login as demo user
# (Use browser or API test to verify session-based auth)

# 3. API returns data
# GET /api/workspaces -> returns "Acme Product" workspace

# 4. Board has cards
# GET /api/workspaces/acme-product/boards -> returns 3 boards
# GET /api/workspaces/acme-product/boards/<id> -> returns columns with cards

# 5. Stats endpoint returns chart data
# GET /api/workspaces/acme-product/stats -> returns aggregated stats

# 6. SSE stream connects
# GET /api/workspaces/acme-product/stream -> returns text/event-stream
```

**Full acceptance criteria (user can do all of these):**
- [ ] See a landing page explaining what TeamBoard is, with "Try the Demo" button
- [ ] Click "Try the Demo" and be logged in as the demo user
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

### Phase 5.5 — E2E Tests Against Production (Optional)

Run Playwright tests against the live production URL:

```yaml
# In CI pipeline, after deploy:
- name: E2E against production
  run: |
    PLAYWRIGHT_BASE_URL=https://teamboard.workermill.com \
    npm run test:e2e
```

Test scenarios:
1. Landing page loads, "Try the Demo" button visible
2. Demo login works
3. Workspace list shows "Acme Product"
4. Board view renders columns and cards
5. Drag and drop moves a card
6. Card detail opens and is editable
7. Dashboard charts render
8. Activity feed shows entries

---

## Definition of Done

- [ ] `https://teamboard.workermill.com` loads the landing page
- [ ] `/api/health` returns 200
- [ ] Demo user can log in via "Try the Demo"
- [ ] All 3 boards visible with correct card counts
- [ ] Drag and drop works and persists
- [ ] Dashboard charts render with real data
- [ ] Activity feed shows entries
- [ ] Responsive on mobile
- [ ] CI pipeline runs on push (lint, typecheck, test, e2e) on `ubuntu-latest`
- [ ] Vercel auto-deploys on merge to main
- [ ] Post-deploy workflow runs migrations + smoke test
- [ ] Smoke tests pass post-deploy
- [ ] Page load time < 2 seconds
- [ ] "Built by WorkerMill" visible in footer

---

## Mandatory Rules

> These rules exist because real bugs were found during the v1 build. Every rule traces to a production incident or CI failure. Workers MUST follow these exactly.

### Rule 10: Deploy Label Gates on CI

**The `deploy` label means "auto-merge and deploy" — but ONLY after CI passes.** The worker MUST:
1. Create the PR
2. Wait for CI to complete (poll check status)
3. Fix any CI failures (typecheck, lint, unit tests, E2E)
4. Only merge after ALL checks are green
5. Then deploy

**Never merge a PR with failing CI, even with the deploy label.**

---

## Operational Reference

> This section covers production operations: environment setup, deployment, monitoring, troubleshooting, and recovery.

### Production Environment

| Component | Platform | Configuration |
|-----------|----------|---------------|
| **Application** | Vercel | Next.js 15, Node.js 22, IAD1 region |
| **Database** | Neon PostgreSQL | Pooled + direct connections, automatic backups |
| **DNS** | Custom domain | `teamboard.workermill.com` |
| **CI/CD** | GitHub Actions | `ubuntu-latest` runners |
| **SSL/TLS** | Vercel | Automatic certificate management |

**Live URLs:**
- **Production:** https://teamboard.workermill.com
- **Health Check:** https://teamboard.workermill.com/api/health

### Environment Variables

**Required for production (Vercel + GitHub Secrets):**

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon pooled connection string |
| `DIRECT_DATABASE_URL` | Neon direct connection (for migrations) |
| `NEXTAUTH_SECRET` | JWT session encryption key |
| `NEXTAUTH_URL` | Application URL (`https://teamboard.workermill.com`) |
| `AUTH_TRUST_HOST` | `true` — Auth.js v5 rejects localhost as untrusted without this |
| `SEED_TOKEN` | Protected seed endpoint token |

### CI/CD Pipeline Architecture

```
Push to Branch -> Create PR
        |
        v
  CI Workflow (.github/workflows/ci.yml)
  +-------------------------------------+
  |  Quality Gate Job                    |
  |    * npm ci -> lint -> typecheck     |
  |    * test -> npm audit               |
  |                                      |
  |  E2E Test Job (after quality)       |
  |    * prisma migrate deploy          |
  |    * npm run build                  |
  |    * playwright install (all)       |
  |    * seed E2E data -> run tests      |
  |                                      |
  +----------------+--------------------+
                   | All checks pass
                   v
             Merge to main
                   |
          +--------+--------+
          v                 v
    Deploy Workflow    Vercel Auto-Deploy
    (deploy.yml)       (GitHub App)
    +--------------+
    | 1. Migrate   |
    | 2. Sleep 30s |
    | 3. Seed data |
    | 4. Smoke test|
    +--------------+
```

### Vercel Configuration

**`vercel.json`:**
```json
{
  "framework": "nextjs",
  "regions": ["iad1"],
  "functions": {
    "src/app/api/**/*.ts": { "maxDuration": 10 }
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-XSS-Protection", "value": "1; mode=block" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

**`next.config.js` production optimizations:**
- `output: 'standalone'` — minimal Docker image
- `poweredByHeader: false` — remove X-Powered-By
- `compress: true` — Brotli compression
- `optimizePackageImports: ['lucide-react', '@radix-ui/*']` — reduce bundle size
- `images.formats: ['image/avif', 'image/webp']` — modern image formats

### Database Migrations

**Two-phase migration approach:**
1. **0001_init** — 9 core models (User, Workspace, Board, Column, Card, etc.)
2. **0002_extended_features** — Comment, ChecklistItem, StarredBoard, optional fields

**Commands:**
```bash
# Development
npx prisma db push              # Quick schema sync
npx prisma migrate dev --name X # Create migration file

# Production (automated by deploy.yml)
npx prisma migrate deploy

# Manual production (if needed)
export DATABASE_URL="<pooled-url>"
export DIRECT_DATABASE_URL="<direct-url>"
npx prisma migrate deploy
npx prisma migrate status       # Verify
```

**Rules:** Never edit existing migrations. Always test locally first. Use transactions for data migrations.

### Seeding Demo Data

**Endpoint:** `POST /api/seed` (requires `Authorization: Bearer $SEED_TOKEN`)

**Idempotent** — safe to run multiple times (checks for existing workspace slug).

**Creates:**
- Demo user: `demo@workermill.com` / `demo1234` (OWNER)
- Workspace: "Acme Product" (slug: `acme-product`) + 3 team members
- 3 boards: Product Roadmap (5 cols, 12 cards), Sprint 14 (4 cols, 10 cards), Bug Tracker (3 cols, 8 cards)
- 5 labels: Bug (red), Feature (blue), Enhancement (green), Documentation (purple), Urgent (orange)
- 25 activity entries (spanning 7 days)

### Smoke Tests

**Automated (in deploy.yml):**
1. `GET /api/health` -> `{ "status": "ok" }`
2. `GET /` -> 200
3. `GET /login` -> 200
4. DNS resolution -> Vercel IP
5. HTTPS certificate -> valid

**Manual checklist (post-deploy):**
- [ ] Landing page loads, "Try the Demo" button visible
- [ ] Demo login -> "Acme Product" workspace
- [ ] Dashboard shows 4 charts with data
- [ ] Product Roadmap board: 5 columns, cards draggable
- [ ] Card detail modal opens, edits save
- [ ] Activity feed, members page, settings page load
- [ ] Responsive at 320px mobile viewport
- [ ] No console errors
- [ ] Page load < 2 seconds on 4G

### Performance Targets

| Metric | Target |
|--------|--------|
| Lighthouse Performance | >90 |
| First Contentful Paint | <1.5s |
| Time to Interactive | <2.5s |
| Total Bundle Size | <200KB |
| API Response Time (p95) | <500ms |

### Monitoring

**Vercel dashboard:** Deployment logs, function logs, analytics, Core Web Vitals.

**Neon console:** Connection pooling, query performance, storage usage, automatic daily backups.

### Rollback Procedures

**Application:** Vercel dashboard -> Deployments -> find last-good deployment -> "Promote to Production". Or `vercel rollback` via CLI.

**Database:** Restore from Neon backup (console -> Backups -> select point -> restore). Or create a reverse migration and deploy.

| Scenario | RTO | RPO |
|----------|-----|-----|
| Application rollback | 5 minutes | 0 (no data loss) |
| Database restore | 30 minutes | 24 hours (backup frequency) |
| Full rebuild | 2 hours | 24 hours |

### Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Build fails with TS errors | Code doesn't typecheck | `npm run typecheck` locally, fix errors |
| `prisma migrate deploy` fails | Missing `DIRECT_DATABASE_URL` or schema drift | Check env vars, run `npx prisma migrate status` |
| Seed endpoint 401 | Wrong `SEED_TOKEN` | Verify token matches in GitHub Secrets and Vercel |
| E2E tests timeout | Slow startup or DB issues | Check `/tmp/nextjs.log`, increase timeout to 30s |
| Auth "UntrustedHost" error | Missing `AUTH_TRUST_HOST=true` | Add to Vercel env vars and CI workflow |
| 404 on `/[workspace]` | Missing `page.tsx` for dynamic route | Add redirect page (see Rule 11 in TB-3) |

### Security Measures

1. **HTTP headers** — CSP, XSS protection, frame deny, referrer policy (via `vercel.json`)
2. **Authentication** — NextAuth.js v5, JWT strategy, bcrypt 12 rounds
3. **Environment** — All secrets in Vercel env vars + GitHub Secrets, none in repo
4. **Database** — SSL/TLS required, connection pooling, Prisma prepared statements
5. **Dependencies** — `npm audit --audit-level=high` in CI

### Disaster Recovery

**Database corruption:** Neon console -> Backups -> restore -> update `DATABASE_URL` -> redeploy.

**Complete rebuild:**
1. Clone repo -> provision new Neon database
2. `npx prisma migrate deploy` -> `npm run db:seed`
3. Configure Vercel with new database -> deploy

---

## Worker Execution Rules

1. **Read CLAUDE.md first:** Before starting any work, read `CLAUDE.md` in the repo root for project conventions and patterns from previous phases.
2. **Run ALL quality checks before PR:** Before creating a pull request:
   - `npm run typecheck` — 0 errors
   - `npm run lint` — 0 errors
   - `npm run test` — all tests pass
   - `npm run test:e2e` — ALL E2E tests must pass (including pre-existing tests)
3. **Wait for CI before merge:** After creating a PR, run `gh pr checks <PR_NUMBER> --watch` and verify all checks pass. **NEVER merge with failing checks.**
4. **Update CLAUDE.md:** Before creating your PR, update CLAUDE.md if you established new patterns or conventions.
5. **Existing tests must keep passing:** When modifying existing components, run the full test suite to verify no regressions.
6. **Verify against actual DOM:** When writing tests, inspect the actual rendered output. Never assume routes or elements exist.

## Quality Gates

| Gate | Threshold | Tool |
|------|-----------|------|
| Lint | 0 errors, 0 warnings | ESLint with strict config |
| Types | 0 errors | `tsc --noEmit` |
| Unit tests | 100% pass | Vitest |
| E2E tests | 100% pass (including pre-existing tests) | Playwright |
| Security | 0 high/critical vulnerabilities | `npm audit` |
| Build | Successful production build | `next build` |
| **CI gate** | **ALL GitHub Actions checks pass before merge** | `gh pr checks --watch` |

## Estimated Plan Size

4-6 stories — deploy, migrate, smoke test, verify.
