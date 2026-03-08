// Auto-generated from WorkerMill showcase build data
// Board: TeamBoard (Full Rebuild)
// Generated: 2026-03-08

export { teamBoardPrd } from "./teamboard-prd";

export interface TeamBoardEpic {
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

export const teamBoardEpics: TeamBoardEpic[] = [
  {
    "id": "tbfbs-1",
    "title": "TBFBS-1: Foundation — Project Scaffolding, Database, Auth, API Routes & CI",
    "priority": "urgent",
    "storyCount": 12,
    "duration": "~43 min",
    "status": "completed",
    "techLeadScore": "9/10",
    "prNumber": 1,
    "prUrl": "https://github.com/workermill-examples/teamboard/pull/1",
    "commentCount": 14,
    "personas": [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer"
    ],
    "description": "# Foundation — Project Scaffolding, Database, Auth, API Routes & CI\n\nFirst epic of the full rebuild. Sets up the entire project skeleton: Next.js 15 with App Router, Prisma 6 + Neon PostgreSQL, NextAuth v5 beta credentials auth, all API routes (workspaces, boards, columns, cards, members, activity, stats), GitHub Actions CI, and Vercel deployment config.\n\n## Scope\n- Project config: package.json, tsconfig, ESLint flat config, Tailwind v4, PostCSS\n- Prisma schema with all models (User, Workspace, Board, Column, Card, Label, Activity, etc.)\n- Auth system: NextAuth v5 beta with credentials provider, JWT strategy, Edge-compatible middleware\n- All API routes: CRUD for workspaces, boards, columns, cards, members, labels, activity, stats\n- Seed endpoint + seed script for demo data\n- CI pipeline: lint, typecheck, build, test, audit\n- Quality gate commands configured\n\n## Key Decisions\n- Used `prisma db push` instead of migrations (no migrations directory)\n- ESLint flat config (`eslint.config.mjs`) instead of legacy `.eslintrc`\n- Tailwind v4 with CSS-based config (no `tailwind.config.ts`)\n- bcrypt v6 with `import * as bcrypt` syntax (no default export)",
    "buildLog": "**WorkerMill** — 2026-03-08 02:34 UTC\n\n**Epic TBFBS-1 started** — Foundation scaffolding with 12 stories across 4 worker personas.\n\nStories executed in parallel where dependencies allowed. Backend developer handled Prisma schema, auth config, and API routes. Frontend developer scaffolded app shell and layout. DevOps engineer set up CI/CD and Vercel config. QA engineer wrote initial test infrastructure.\n\n**WorkerMill** — 2026-03-08 02:50 UTC\n\n**Stories 1-4 completed** — Project scaffolding, Prisma schema, auth system, and app shell all passing typecheck.\n\nOne issue encountered: Prisma enum formatting (single-line vs multi-line) caused a brief Q-BLOCKING question from a worker. Coordinator resolved it — Prisma accepts both formats.\n\n**WorkerMill** — 2026-03-08 03:05 UTC\n\n**All 12 stories completed.** Integration agent ran quality gates: lint, typecheck, build, test, audit — all passing.\n\nMinor fixes during integration:\n- Added `@eslint/eslintrc` package (needed by ESLint flat config but not in initial deps)\n- Fixed `tsconfig.json` lib field to include ES2022 (Array.includes() unrecognized without it)\n- Escaped JSX entities (apostrophes in text content)\n\n**WorkerMill** — 2026-03-08 03:10 UTC\n\n[👑 tech_lead 🤖] PR #1 created and reviewed.\n\nTech Lead approved on first review — score 9/10. Clean implementation, all quality gates passing.\n\n**WorkerMill** — 2026-03-08 03:16 UTC\n\n✅ PR #1 merged to main.\n\n📊 **Stats:**\n| Metric | Value |\n|--------|-------|\n| Files changed | 53 |\n| Lines added | 16,480 |\n| Time to merge | ~43 minutes |\n| Tech Lead score | 9/10 |\n| Revision rounds | 0 |\n\n*Foundation complete. Frontend epic starting immediately.*"
  },
  {
    "id": "tbfbs-2",
    "title": "TBFBS-2: Frontend — All UI Pages, Components, Drag-and-Drop, Charts & PWA",
    "priority": "high",
    "storyCount": 12,
    "duration": "~9.7 hrs",
    "status": "completed",
    "techLeadScore": "9/10",
    "prNumber": 2,
    "prUrl": "https://github.com/workermill-examples/teamboard/pull/2",
    "commentCount": 38,
    "personas": [
      "frontend_developer",
      "qa_engineer",
      "devops_engineer"
    ],
    "description": "# Frontend — All UI Pages, Components, Drag-and-Drop, Charts & PWA\n\nThe largest and most challenging epic. Builds every UI page and component: responsive sidebar with desktop/mobile rendering, workspace dashboard with Recharts analytics, Kanban board with @dnd-kit drag-and-drop, card detail modal, activity feed, member management, workspace settings, PWA with offline support, and comprehensive unit tests.\n\n## What Made This Hard\nThis epic went through **3 revision rounds** over ~7 hours before Tech Lead approval. The integration challenges were real:\n\n1. **Cross-story component API mismatches** — ErrorState component props were different across 3 stories (workers independently invented different APIs)\n2. **Dual-render sidebar pattern** — Desktop and mobile sidebars render simultaneously in the DOM, causing test failures when queries find duplicate elements\n3. **Framer Motion test mocking** — AnimatedCounter stays at 0 with naive mocks; needed proxy-based mock that passes through to plain HTML\n4. **Icon namespace vs individual exports** — Story 0 exported icons individually, stories 3-8 consumed them as `Icons.Calendar` namespace\n5. **null vs undefined inconsistency** — Different stories used different conventions for nullable card fields\n6. **Jest vs Vitest syntax** — QA engineer wrote all tests with `jest.mock()` instead of `vi.mock()`, requiring mass find-replace\n\nThe integration agent made 18+ fix attempts across the 3 revision rounds to resolve these conflicts.",
    "buildLog": "**WorkerMill** — 2026-03-08 03:17 UTC\n\n**Epic TBFBS-2 started** — 12 stories for the complete frontend build.\n\nThis is the big one. Dashboard, boards, cards, drag-and-drop, activity, members, settings, PWA, tests — everything the user sees.\n\n**WorkerMill** — 2026-03-08 03:42 UTC\n\n**Stories executing in parallel.** First issues appearing:\n- Duplicate export in toast component (caught and fixed immediately)\n- TypeScript errors from Background Sync API types in PWA provider (custom type declarations needed)\n- PWA test written with incomplete IndexedDB mock\n\n**WorkerMill** — 2026-03-08 04:08 UTC\n\n⚠️ **ErrorState prop mismatch — hit 3 times.** The ErrorState component (created in story 0) expects `description` and `action: { label, onClick }` props, but 3 different frontend workers on stories 3, 4, and 5 all used `message` and `onRetry` instead. Each had to read the source and fix their code independently. This was the most repeated conflict in the build.\n\n**WorkerMill** — 2026-03-08 04:30 UTC\n\nMore cross-story friction:\n- `canManage`/`canEdit` accessed on workspace object instead of context hook (story 3)\n- Button `asChild` prop used but not supported by the actual Button component (story 3)\n- `<img>` tags instead of Next.js `<Image>` component (stories 4, 7)\n- Direct `window` reference in workspace-settings breaking SSR (story 8)\n\n**WorkerMill** — 2026-03-08 05:01 UTC\n\n⚠️ **QA engineer wrote all tests with Jest syntax.** Every test file used `jest.mock()`, `jest.fn()`, `jest.spyOn()` — but the project uses Vitest. Mass `sed` replacement of `jest` → `vi` didn't catch all cases (`jest.MockedFunction`, mock factory patterns). Integration agent had to clean up the remaining issues.\n\n**WorkerMill** — 2026-03-08 05:09 UTC\n\n**PR #2 created.** All stories complete, but integration issues remain. Quality gates running.\n\n**WorkerMill** — 2026-03-08 05:37 UTC\n\n**First integration round complete.** Integration agent fixed 15 issues:\n- ESLint parsing errors from bad mock factory conversions\n- Unescaped JSX entities across landing page components\n- `<a>` tags replaced with `<Link>` for internal nav\n- `withWorkspaceAccess` middleware made generic for nested routes\n- ActivityType enum values reconciled between code and schema\n- Icons module converted from individual exports to namespace pattern\n- null vs undefined reconciled in card-detail pickers\n- framer-motion `animate` prop name collision with import\n\n**WorkerMill** — 2026-03-08 07:51 UTC\n\n🔄 **Revision 1/4** — Tech Lead requests changes (score: 7/10)\n\nPostCSS config missing, test failures in card component and login tests. Workers dispatched to fix.\n\n**WorkerMill** — 2026-03-08 10:16 UTC\n\n🔄 **Revision 2/4** — Tech Lead requests changes (score: 7/10)\n\nPostCSS fixed but additional test issues remain. Story 2 and 11 affected — frontend developer and QA engineer re-dispatched.\n\n**WorkerMill** — 2026-03-08 13:01 UTC\n\n🔄 **Revision 3/4** — Tech Lead requests changes (score: 7/10)\n\nMore test fixes applied. Revision targeted stories 2 and 11. Integration agent ran another fix pass.\n\n**WorkerMill** — 2026-03-08 14:44 UTC\n\n**Revision 3/4 review** — Tech Lead finally sees all issues addressed.\n\n**WorkerMill** — 2026-03-08 14:52 UTC\n\n✅ **PR #2 approved and merged** (score: 9/10)\n\nTech Lead: \"Excellent work on addressing all previous review issues! The unit test failures have been properly fixed.\"\n\n📊 **Stats:**\n| Metric | Value |\n|--------|-------|\n| Files changed | 100 |\n| Lines added | 17,670 |\n| Lines removed | 87 |\n| Time to merge | ~9.7 hours |\n| Tech Lead score | 9/10 (final) |\n| Revision rounds | 3 of 4 max |\n| Integration fix attempts | 18+ |\n\n**Honest assessment:** This epic barely made it. 3 of 4 max revisions used. The root cause was cross-story interface mismatches — workers building components in parallel made incompatible assumptions about shared APIs, prop shapes, and naming conventions. The integration agent spent hours reconciling these conflicts. Future runs need stricter component API specs in the PRD."
  },
  {
    "id": "tbfbs-3",
    "title": "TBFBS-3: Deployment — Playwright E2E, CI Pipeline & Production Validation",
    "priority": "high",
    "storyCount": 9,
    "duration": "~36 min",
    "status": "deployed",
    "techLeadScore": "9/10",
    "prNumber": 3,
    "prUrl": "https://github.com/workermill-examples/teamboard/pull/3",
    "commentCount": 8,
    "personas": [
      "qa_engineer",
      "devops_engineer",
      "frontend_developer"
    ],
    "description": "# Deployment — Playwright E2E, CI Pipeline & Production Validation\n\nFinal epic. Sets up Playwright E2E test infrastructure (config, global setup, auth fixture), adds data-testid attributes to components, creates the deploy workflow, and runs production validation.\n\n## What Went Wrong\nThe deploy workflow was written **without a `prisma migrate deploy` step** (or `prisma db push`). The Vercel deployment succeeded — the app was live — but it was hitting an **empty database with zero tables**. Additionally, the `SEED_TOKEN` GitHub Actions secret didn't match the Vercel environment variable, causing the seed step to fail with 401.\n\nThe PRD specified a CI pipeline but never specified the deploy pipeline steps. The worker had to invent the deploy workflow and missed the critical database migration step. This is a spec gap — not a worker failure.\n\n## Resolution\nDatabase schema pushed and seed data loaded manually against the Neon production database. The app is now fully functional at https://teamboard.workermill.com with demo data.\n\n## Lesson\nPRDs must specify deploy pipelines with the same precision as CI pipelines. \"Deploy to Vercel\" is not a spec — the exact sequence (migrations → build → deploy → seed → verify) must be spelled out.",
    "buildLog": "**WorkerMill** — 2026-03-08 14:54 UTC\n\n**Epic TBFBS-3 started** — Deployment, E2E tests, and production validation.\n\nPlanning agent analyzing the codebase after PR #1 and #2 merged. 9 stories planned covering Playwright config, auth fixtures, E2E test specs, data-testid additions, deploy workflow, and smoke tests.\n\n**WorkerMill** — 2026-03-08 16:10 UTC\n\n**Stories completing.** QA engineer adding data-testid attributes to components and verifying builds pass. DevOps engineer writing deploy workflow and CI E2E job.\n\n**WorkerMill** — 2026-03-08 16:16 UTC\n\n**PR #3 created.** Integration agent running quality gates.\n\n**WorkerMill** — 2026-03-08 16:42 UTC\n\n**CI runs failing** — but these are expected during integration. The integration agent is fixing lint and typecheck issues from cross-story conflicts.\n\n**WorkerMill** — 2026-03-08 16:52 UTC\n\n✅ **PR #3 approved and merged** (score: 9/10)\n\nTech Lead approved on first review. Clean implementation of E2E infrastructure.\n\n**WorkerMill** — 2026-03-08 16:55 UTC\n\n❌ **Deploy workflow failed at seed step.**\n\n```\nHTTP Status: 401\n❌ Seeding failed with status 401\n{\"error\":\"Invalid seed token\"}\n```\n\nTwo problems:\n1. **No database migration step in deploy workflow.** The Neon production database had zero tables. The app deployed to Vercel successfully but every API route that touched the database would fail.\n2. **SEED_TOKEN mismatch.** The GitHub Actions secret value didn't match the Vercel environment variable. The seed endpoint correctly rejected the request.\n\n**Root cause:** The PRD specified the CI pipeline in detail but never specified the deploy pipeline. The worker wrote a deploy workflow that went straight from Vercel deploy to seeding, skipping `prisma db push` / `prisma migrate deploy` entirely.\n\n**WorkerMill** — 2026-03-08 17:15 UTC (manual intervention)\n\n🔧 **Manual fix applied.** Database schema pushed and seed data loaded directly against the Neon production database.\n\n```\n$ npx prisma db push\n🚀 Your database is now in sync with your Prisma schema.\n\n$ npx tsx prisma/seed.ts\nCreated demo user: demo@workermill.com\nCreated 30 cards across 3 boards\nSeeding completed successfully\n```\n\nApp now fully functional at https://teamboard.workermill.com.\n\n📊 **Stats:**\n| Metric | Value |\n|--------|-------|\n| Files changed | 39 |\n| Lines added | 2,625 |\n| Lines removed | 920 |\n| Time to merge | ~36 minutes |\n| Tech Lead score | 9/10 |\n| Revision rounds | 0 |\n| Deploy pipeline | ❌ Failed (manual fix) |\n\n---\n\n## Full Build Summary\n\n| Epic | Duration | Score | Revisions | Status |\n|------|----------|-------|-----------|--------|\n| Foundation | ~43 min | 9/10 | 0 | ✅ Clean |\n| Frontend | ~9.7 hrs | 9/10 | 3/4 | ⚠️ Struggled |\n| Deployment | ~36 min | 9/10 | 0 | ❌ Deploy gap |\n| **Total** | **~14 hrs** | | | **Live with manual fix** |\n\n**Total cost:** ~$485 (Claude API usage across all workers)\n**Lines of code:** ~23,000\n**What worked:** Foundation was clean and fast. Tech Lead review caught real issues. Integration agent resolved 30+ cross-story conflicts.\n**What didn't:** Frontend epic nearly exhausted its revision budget. Deploy pipeline was missing database migration step. SEED_TOKEN secret mismatch. PRD gaps in component API specs and deploy workflow.\n**Honest take:** This is what real AI-built software looks like today. It's not magic — it's a system that grinds through problems, sometimes elegantly, sometimes barely. The app works and it's deployed, but it took human intervention to fix the deploy pipeline gap."
  }
];
