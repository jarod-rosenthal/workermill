# TaskPulse — Setup & Review Checklist

> Everything that needs to happen before workers can execute TP-1.

---

## Phase 1: Review Specs (Before Provisioning)

Decisions to confirm or change before any infrastructure work.

### Product

- [ ] **Project name:** "TaskPulse" — OK or rename?
- [ ] **Subdomain:** `taskpulse.workermill.com`
- [ ] **GitHub repo:** `workermill-examples/taskpulse` (public)
- [ ] **Tagline:** "Background Tasks, Monitored." — OK or revise?

### Tech Stack

- [ ] **Next.js 16 + React 19.2 + Prisma 7 + Neon + Vercel** — latest stable stack
- [ ] **NextAuth v5 beta.25** — same exact pin as TeamBoard
- [ ] **Tailwind CSS v4** — CSS-first config (`@import "tailwindcss"` + `@theme`), no `tailwind.config.ts`
- [ ] **Prisma 7** — `prisma-client` generator, `@prisma/adapter-neon`, `prisma.config.ts`, no `@prisma/client` dep
- [ ] **ESLint flat config** — `eslint.config.mjs`, no `.eslintrc.json`, `eslint .` instead of `next lint`
- [ ] **Dark theme only** — no light mode toggle (developer tool aesthetic)
- [ ] **@headlessui/react** for dialogs/dropdowns — no shadcn/ui
- [ ] **Recharts 3** for dashboard charts (NOT Recharts 2)
- [ ] **Vitest 4 + Playwright 1.58** for testing
- [ ] **No @heroicons/react** — inline SVGs only (TB-10 lesson)

### Data Model

- [ ] **10 models** — User, Project, ProjectMember, TaskDefinition, Run, RunStep, RunLog, Schedule, ApiKey + 4 enums
- [ ] **No Environment model** — single environment for simplicity. Add later if wanted.
- [ ] **Run simulation** — pre-calculated timestamps, no actual background execution. UI animates the trace.
- [ ] **Demo credentials:** `demo@workermill.com` / `demo1234` (same as TeamBoard)

### Scope

- [ ] **5 epics** — Setup → API → UI → Advanced → Deploy
- [ ] **~80 files total** across all epics
- [ ] **34 API operations** across 21 route files
- [ ] **Hero feature:** RunTimeline trace/waterfall view (the main visual showcase)

### Demo Data

- [ ] **5 task definitions:** send-welcome-email, process-payment, generate-report, sync-inventory, resize-image
- [ ] **50 seeded runs** across 7 days (35 completed, 8 failed, 4 executing, 3 queued)
- [ ] **2 schedules:** nightly report (daily 2AM), inventory sync (every 30 min)
- [ ] **2 API keys:** production + staging (with masked prefixes)

---

## Phase 2: Provision Infrastructure

Same pattern as TeamBoard. All must be ready before TP-1 runs.

### GitHub

- [ ] Create repo `workermill-examples/taskpulse` (public)
- [ ] Initialize with empty commit or README
- [ ] Verify repo accessible at `https://github.com/workermill-examples/taskpulse`

### Neon PostgreSQL

- [ ] Create Neon project (free tier)
- [ ] Note the pooled connection string → `DATABASE_URL`
- [ ] Note the direct connection string → `DIRECT_DATABASE_URL`
- [ ] Verify connection: `psql <DIRECT_DATABASE_URL>` → `SELECT 1`

### Vercel

- [ ] Create Vercel project named `taskpulse`
- [ ] Link to GitHub repo `workermill-examples/taskpulse`
- [ ] Set framework: Next.js
- [ ] Set Node.js version: 22
- [ ] Add custom domain: `taskpulse.workermill.com`
- [ ] Verify DNS resolves (may take a few minutes)
- [ ] Enable auto-deploy on push to main

### Vercel Environment Variables

| Variable | Value | Set? |
|----------|-------|------|
| `DATABASE_URL` | Neon pooled connection string | [ ] |
| `DIRECT_DATABASE_URL` | Neon direct connection string | [ ] |
| `NEXTAUTH_SECRET` | Random 32-char string (`openssl rand -base64 32`) | [ ] |
| `NEXTAUTH_URL` | `https://taskpulse.workermill.com` | [ ] |
| `AUTH_TRUST_HOST` | `true` | [ ] |
| `SEED_TOKEN` | Random token for seed endpoint auth | [ ] |

### GitHub Secrets

| Secret | Value | Set? |
|--------|-------|------|
| `DATABASE_URL` | Same as Vercel | [ ] |
| `DIRECT_DATABASE_URL` | Same as Vercel | [ ] |
| `NEXTAUTH_SECRET` | Same as Vercel | [ ] |
| `SEED_TOKEN` | Same as Vercel | [ ] |

### Verification

- [ ] Vercel project shows "Ready" in dashboard
- [ ] `taskpulse.workermill.com` resolves (even if 404 — Vercel is responding)
- [ ] GitHub secrets all set (Settings → Secrets → Actions)
- [ ] Neon database accessible from both pooled and direct URLs

---

## Phase 3: Create Tickets

Create the epic tickets in your task tracker (Linear, GitHub Issues, or WorkerMill dashboard). Each ticket body = the corresponding spec file.

| Ticket | Spec File | Depends On |
|--------|-----------|------------|
| [ ] TP-1: Project Setup & Dev Environment | `TP-1-project-setup.md` | — |
| [ ] TP-2: Core API & Task Engine | `TP-2-core-api.md` | TP-1 |
| [ ] TP-3: Dashboard UI | `TP-3-dashboard-ui.md` | TP-2 |
| [ ] TP-4: Scheduling, API Keys & Polish | `TP-4-advanced-features.md` | TP-3 |
| [ ] TP-5: Production Deploy & Validation | `TP-5-production-deploy.md` | TP-4 |

### Per-Ticket Checklist

Before running each epic:

- [ ] Previous epic's PR merged and deployed
- [ ] `npm run typecheck` passes on main
- [ ] Seed data loads correctly (`npm run db:seed`)
- [ ] Review the spec for any adjustments based on what the previous epic actually produced
- [ ] Refine ticket if needed (like TeamBoard TB-9 and TB-10 were refined before execution)

---

## Phase 4: Execute

Run each epic through WorkerMill. After each:

- [ ] Review the PR
- [ ] Verify typecheck + lint + tests pass
- [ ] Merge to main
- [ ] Verify Vercel deploys successfully
- [ ] Spot-check the live site
- [ ] Note any issues to refine in the next epic's spec
- [ ] Update `docs/showcase/` with execution results (like TeamBoard docs)

---

## Quick Reference

| Resource | URL |
|----------|-----|
| Repo | `https://github.com/workermill-examples/taskpulse` |
| Live | `https://taskpulse.workermill.com` |
| Health | `https://taskpulse.workermill.com/api/health` |
| Neon Dashboard | `https://console.neon.tech` |
| Vercel Dashboard | `https://vercel.com/dashboard` |
| Spec Files | `docs/taskpulse/` in this repo |
