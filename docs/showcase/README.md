# TeamBoard Showcase

> A full-stack Kanban board application built entirely by autonomous AI workers, orchestrated by [WorkerMill](https://workermill.com).

**Live demo:** [teamboard.workermill.com](https://teamboard.workermill.com)
**Repository:** [workermill-examples/teamboard](https://github.com/workermill-examples/teamboard)

---

## What is TeamBoard?

TeamBoard is a Trello-like project management application with drag-and-drop Kanban boards, real-time updates, RBAC, and PWA support. It was built across 4 epics by WorkerMill's autonomous AI workers to demonstrate the platform's capabilities.

**Tech stack:** Next.js 15, React 19, TypeScript, Prisma, PostgreSQL (Neon), TailwindCSS, @dnd-kit, Recharts, NextAuth v5, Playwright, Vitest, Vercel.

---

## Epic Execution Timeline

| Epic | Title | Date | Stories | Personas | Score | PR |
|------|-------|------|---------|----------|-------|-----|
| [TB-7](./TB-7-project-setup.md) | Project Setup & Dev Environment | Feb 14, 2026 | 10 | 4 | 9/10 | [#58](https://github.com/workermill-examples/teamboard/pull/58) |
| [TB-8](./TB-8-core-backend-api.md) | Core Backend API | Feb 14, 2026 | 7 | 2 | Approved | [#63](https://github.com/workermill-examples/teamboard/pull/63) |
| [TB-9](./TB-9-web-dashboard.md) | Web Dashboard | Feb 15, 2026 | 8 | 2 | 9/10 | [#65](https://github.com/workermill-examples/teamboard/pull/65) |
| [TB-10](./TB-10-pwa-extended-features.md) | PWA & Extended Features | Feb 15, 2026 | 8 | 4 | Escalated | [#66](https://github.com/workermill-examples/teamboard/pull/66) |
| [TB-11](./TB-11-production-deploy.md) | Production Deploy & Validation | — | — | — | — | — |

---

## By the Numbers

| Metric | Value |
|--------|-------|
| **Total epics** | 4 completed, 1 pending |
| **Total worker stories** | 33 |
| **Unique personas used** | 5 (`backend_developer`, `frontend_developer`, `qa_engineer`, `devops_engineer`, `database_administrator`) |
| **API routes built** | 30+ |
| **React components** | 45+ |
| **E2E tests** | 56 |
| **Unit tests** | 135+ |
| **Tech Lead revision cycles** | 4 (one per epic) |
| **Total execution time** | ~4.5 hours across 2 days |

---

## How It Works

Each epic follows the same pattern:

1. **Planning** — WorkerMill's planner agent decomposes the ticket into parallel stories, each assigned to a persona (backend_developer, frontend_developer, etc.)
2. **Parallel execution** — Workers execute their stories simultaneously in isolated git worktrees, each writing to their assigned files
3. **Consolidation** — Changes are merged into a single branch, resolving any conflicts
4. **Tech Lead review** — An AI tech lead reviews the consolidated PR for quality, correctness, and adherence to the spec
5. **Revision** — If issues are found, affected stories are re-executed with targeted feedback
6. **Approval** — Once the tech lead is satisfied, the PR is marked ready for merge

Workers communicate via a coordination feed, posting decisions (`DEC-001`), blocking questions (`Q-BLOCKING-SCOPE`), and completion reports.

---

## Key Observations

**What went well:**
- Parallel execution of 7-10 stories per epic significantly reduced total time
- Workers correctly followed version constraints (Next.js 15, React 19, NextAuth v5 beta exact pin)
- RBAC implementation was thorough — business rules like last-owner protection implemented correctly
- Workers raised blocking questions when they found cross-story dependency issues (e.g., Prisma schema enum syntax)

**What required revision:**
- TypeScript and ESLint errors were the most common reason for revision cycles
- NextAuth v5 beta's import patterns are tricky — workers needed guidance on `@ts-expect-error` directives
- Cross-story file dependencies (e.g., one story creating components that another story imports) needed careful ordering

**Learnings applied between epics:**
- TB-9 incorporated 5 root-cause fixes from a failed earlier run (single-file ownership, no verification-only stories, explicit prop interfaces)
- TB-10 was pre-refined to replace PNG icons with SVG (workers can't create binary files) and removed impossible verification steps
