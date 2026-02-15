# TB-11: Production Deploy & Validation

> **TeamBoard Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/teamboard`](https://github.com/workermill-examples/teamboard)
> Live: [teamboard.workermill.com](https://teamboard.workermill.com)

---

## Epic Overview

Production configuration and deployment validation for TeamBoard. This is the final ticket in the series — minimal code changes (2 files) focused on production hardening, plus local verification that the entire codebase is deployment-ready.

**Status: Not yet executed.** This document captures the ticket specification. Worker execution results will be added when the epic runs.

---

## Ticket Specification

### What This Ticket Delivers

Production configuration files and local verification that the codebase is deployment-ready. Live URL validation is done by a human after Vercel auto-deploy — the AI worker focuses on code changes and local verification only.

### Scope Boundary

- **Creates:** `vercel.json` (new), modifies `next.config.js` (production optimizations)
- **Verifies locally:** typecheck, lint, tests, E2E tests, seed data correctness
- **Human validates after deploy:** live URL smoke tests, Vercel deployment status, CI/CD pipeline

### Pre-Configured Infrastructure

| Resource | Status |
|----------|--------|
| Vercel project (Next.js, Node 22) | Ready |
| Custom domain `teamboard.workermill.com` | DNS verified |
| Neon PostgreSQL | Provisioned |
| Vercel env vars | Set |
| GitHub secrets | Set |
| Auto-deploy on push to main | Enabled |
| SSL certificate | Automatic via Vercel |

---

## Work Groups

### Work Group 1: Production Config (2 files)

**`vercel.json`** (new):
- Security headers: `X-Content-Type-Options` (nosniff), `X-Frame-Options` (DENY), `X-XSS-Protection` (1; mode=block), `Referrer-Policy` (strict-origin-when-cross-origin)
- Function maxDuration: 10s for API routes
- Region: iad1

**`next.config.js`** (modify):
- Add `poweredByHeader: false`
- Add `compress: true`
- Preserve existing ESM syntax (`export default`)

### Work Group 2: Seed Data Verification

Verify `prisma/seed.ts` creates:
- Demo user (`demo@workermill.com` / `demo1234`)
- "Acme Product" workspace
- 3 boards with 30 total cards
- 5 labels
- 25+ activity entries

### Work Group 3: Database Migration Check

- Verify `prisma/migrations/` directory exists
- If not, create initial migration: `npx prisma migrate dev --name init`
- Verify `npx prisma migrate deploy` succeeds

### Work Group 4: Local Verification

1. `npm run typecheck` — 0 errors
2. `npm run lint` — 0 errors
3. `npm run test` — all pass
4. `npm run test:e2e` — all pass
5. `npx prisma db seed` — completes without errors
6. Verify "Built by WorkerMill" in landing page footer
7. Git commit and push to main

---

## Acceptance Criteria

- [ ] `vercel.json` created with security headers and function config
- [ ] `next.config.js` updated with `poweredByHeader: false`
- [ ] Prisma migrations exist and `migrate deploy` succeeds
- [ ] Seed script creates full demo data (3 boards, 30 cards)
- [ ] `npm run typecheck` and `npm run lint` pass
- [ ] All unit tests pass
- [ ] All E2E tests pass
- [ ] "Built by WorkerMill" present in landing page source
- [ ] Changes committed and pushed to main

---

## Post-Deploy Smoke Tests (Human Only)

After Vercel auto-deploys the push to main:

1. `GET /api/health` returns 200 with `{ status: "ok" }`
2. Landing page loads — "Try the Demo" button visible
3. Demo login works — redirected to "Acme Product" workspace
4. Dashboard shows 4 charts with real data
5. Product Roadmap board: 5 columns visible, cards present
6. Drag a card between columns, reload, card persists
7. Card detail modal: edit title and description, saves
8. Create a new card in a column
9. Activity feed shows entries
10. Members page shows demo user
11. Responsive at 320px mobile viewport
12. SSE stream connects
13. "Built by WorkerMill" visible in footer
14. Security headers present in response

---

## Ticket Refinement Notes

The ticket was refined before execution with these changes:
1. **Clarified seed mechanism** — Full seed is `prisma/seed.ts` via `npx prisma db seed`, NOT the `/api/seed` endpoint (which only creates the demo user)
2. **Added migration directory check** — Fallback to create initial migration if `db push` was used instead of `migrate dev`
3. **Separated human vs. worker tasks** — Live URL smoke tests moved to "HUMAN ONLY" section
4. **Added ESM syntax warning** — `next.config.js` uses `export default`, not `module.exports`
5. **Simplified work groups** — Reduced from 5 to 4 groups
