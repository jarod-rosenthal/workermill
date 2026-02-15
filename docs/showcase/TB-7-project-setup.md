# TB-7: Project Setup & Dev Environment

> **TeamBoard Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/teamboard`](https://github.com/workermill-examples/teamboard)
> Live: [teamboard.workermill.com](https://teamboard.workermill.com)

---

## Epic Overview

Scaffold a complete Next.js 15 project from scratch — Prisma ORM, PostgreSQL (Neon), CI/CD pipelines, and a working Vercel deploy. This was the **first ticket** in the TeamBoard series, creating the project skeleton that all subsequent epics build on.

**Deliverables:**

1. Project config and dependencies (Next.js 15, React 19, TypeScript)
2. Prisma schema applied to Neon PostgreSQL (9 models, 2 enums)
3. App shell with stub pages (auth, workspace layout, placeholder content)
4. Health check, seed, and auth API routes
5. GitHub Actions CI + deploy pipelines
6. Live Vercel deploy at teamboard.workermill.com
7. All quality checks passing (typecheck, lint, test)

---

## Execution Summary

| Metric | Value |
|--------|-------|
| **Executed** | February 14, 2026 |
| **Duration** | ~49 minutes (07:09 - 07:58 UTC) |
| **Stories** | 10 parallel workers |
| **Personas** | `backend_developer`, `frontend_developer`, `qa_engineer`, `devops_engineer` |
| **Tech Lead Score** | 9/10 |
| **Revision Cycles** | 1 (TypeScript + ESLint fixes) |
| **Pull Request** | [#58](https://github.com/workermill-examples/teamboard/pull/58) |
| **Blocks** | TB-8 (Core Backend API) |

---

## Worker Stories

### Story 1: Core Project Config
**Persona:** `backend_developer` | **Completed:** 07:09 UTC

Created the foundational Node.js/Next.js configuration:
- `package.json` with Next.js 15.1.0, React 19, NextAuth v5 beta.30, bcrypt 6.0.0
- All required scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `postinstall`
- `prisma.seed` configuration for tsx execution
- `tsconfig.json` with ES2022/ESNext targets for Next.js 15 compatibility
- Minimal `next.config.js` (empty config object per spec)

> All version constraints from the ticket followed exactly.

---

### Story 2: Tooling and Environment Config
**Persona:** `frontend_developer` | **Completed:** 07:11 UTC

Configured linting, formatting, and developer environment:
- `.eslintrc.json` — ESLint extending Next.js core-web-vitals + TypeScript
- `tailwind.config.ts` — Custom colors, border radius, font family variables
- `postcss.config.js` — Tailwind CSS + Autoprefixer plugins
- `.prettierrc` — Single quotes, trailing commas, 100 char width
- `.gitignore` — All required patterns (node_modules, .next, .env, coverage, etc.)
- `.env.example` — Full template for database, auth, and API configuration

---

### Story 3: Prisma Schema and Seed
**Persona:** `backend_developer` | **Completed:** 07:11 UTC

Database foundation:
- **Prisma Schema** with 9 models: User, Workspace, WorkspaceMember, Board, Column, Card, Label, CardLabel, Activity
- **2 enums:** MemberRole (OWNER, ADMIN, MEMBER, VIEWER) and Priority (URGENT, HIGH, MEDIUM, LOW)
- Proper CASCADE deletes and foreign key constraints
- PostgreSQL with both `DATABASE_URL` and `DIRECT_DATABASE_URL`
- **Seed script** creating demo user: `demo@workermill.com` / `demo1234`
- `globals.css` with Tailwind directives

---

### Story 4: Lib Utilities and Types
**Persona:** `backend_developer` | **Completed:** 07:16 UTC (initial), 07:28 UTC (post-review), 07:51 UTC (final)

Core application libraries:
- `src/lib/auth.ts` — NextAuth v5 beta config with credentials provider, JWT strategy
- `src/lib/prisma.ts` — PrismaClient singleton with error handling
- `src/lib/utils.ts` — `cn()` helper, date formatting, slug generation, debounce
- `src/lib/validations.ts` — Zod schemas for all entities
- `src/types/index.ts` — TypeScript types with Prisma relations, API response types
- `src/types/next-auth.d.ts` — NextAuth type augmentation for `session.user.id`

**Notable:** This worker discovered a cross-story dependency issue — the Prisma schema had enum syntax errors from a sibling story. Raised a blocking question (`Q-BLOCKING-SCOPE`) about whether to fix a sibling's file, demonstrating the coordination protocol.

---

### Story 5: Test Configuration
**Persona:** `qa_engineer` | **Completed:** 07:13 UTC

Testing infrastructure:
- **vitest.config.ts** — Node environment, path alias support (`@/*` → `./src/*`), global test APIs
- **playwright.config.ts** — Multi-browser (Chromium, Firefox, WebKit), CI-optimized retries, local dev server integration, HTML reporter

---

### Story 6: App Shell and Auth Pages
**Persona:** `frontend_developer` | **Completed:** 07:16 UTC

User-facing page structure:
- `src/app/layout.tsx` — Root layout with Tailwind, Inter font, semantic HTML
- `src/app/page.tsx` — Landing page with hero section and "Try the Demo" CTA
- `src/app/login/page.tsx` — Email/password login with demo credentials displayed
- `src/app/signup/page.tsx` — Registration form with validation
- `src/app/workspaces/page.tsx` — Placeholder page (full implementation in TB-9)

Used `'use client'` only where needed. Responsive design with Tailwind. Accessibility via semantic HTML and proper form labels.

---

### Story 7: Workspace Layout and Core Pages
**Persona:** `frontend_developer` | **Completed:** 07:27 UTC (initial), 07:31 UTC (refined)

Workspace navigation shell:
- Responsive sidebar layout with workspace name and navigation links
- Redirect page (`/[workspace]` → `/[workspace]/dashboard`)
- Stub pages for Dashboard, Activity, and Members sections
- Fixed SVG icon paths, global hyphen replacement in workspace names
- Proper ARIA patterns and semantic HTML throughout

---

### Story 8: Workspace Settings and Board Pages
**Persona:** `frontend_developer` | **Completed:** 07:34 UTC

Two additional stub pages:
- **Settings page** with workspace management context and feature previews (general settings, member management, integrations, billing)
- **Board detail page** with visual Kanban column mockups (TODO, IN PROGRESS, DONE)
- Both pages use consistent design patterns from the workspace layout

---

### Story 9: API Routes — Health, Seed, Auth
**Persona:** `backend_developer` | **Completed:** 07:32 UTC (initial), 07:54 UTC (post-review)

Three API endpoints:
- **`GET /api/health`** — Returns `{ status: "ok", timestamp }` with 200/500 status codes
- **`POST /api/seed`** — Protected by `SEED_TOKEN` via Bearer header. Creates demo user with bcrypt hashing
- **`GET/POST /api/auth/[...nextauth]`** — NextAuth v5 beta route handlers for credentials auth

Security: Token-based protection, proper error handling, input validation.

---

### Story 10: CI/CD Pipelines and Documentation
**Persona:** `devops_engineer` | **Completed:** 07:17 UTC

Infrastructure and docs:
- **CI Workflow** (`.github/workflows/ci.yml`) — lint, typecheck, unit tests, security audit, E2E testing. Node.js 22 runtime. Parallel execution.
- **Deploy Workflow** (`.github/workflows/deploy.yml`) — Migration deployment, demo data seeding, health check verification. Triggered on main branch pushes.
- **CLAUDE.md** — Development guide for AI workers (tech stack, conventions, commands)
- **README.md** — Project overview, setup instructions, API docs, deployment guides

---

## Tech Lead Review

### Revision 1 (07:42 UTC)

The Tech Lead identified compilation and linting errors:
- NextAuth import needed default export pattern
- Callback parameters needed type annotations
- Unused variables needed underscore prefix
- Apostrophes in JSX needed escaping

**Stories 4 and 9 were re-executed to fix these issues.**

### Final Approval (07:58 UTC)

> **Score: 9/10**
>
> All previously identified issues addressed. NextAuth import uses default export pattern, callback parameters have proper type annotations, unused variables prefixed with underscore, apostrophes in JSX properly escaped. All quality checks pass: TypeScript (0 errors), ESLint (0 errors, 0 warnings), build completes successfully.

---

## Result

All 10 stories completed. PR [#58](https://github.com/workermill-examples/teamboard/pull/58) created and approved. Project skeleton deployed to [teamboard.workermill.com](https://teamboard.workermill.com) with health check responding.

**Files created:** ~35 files across config, schema, pages, lib, types, CI/CD, and documentation.

**Quality gates passed:**
- TypeScript: 0 errors
- ESLint: 0 errors, 0 warnings
- Build: successful
- Health check: 200 OK
