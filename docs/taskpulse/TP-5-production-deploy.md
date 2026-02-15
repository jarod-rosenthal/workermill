# TP-5: Production Deploy & Validation

> **TaskPulse Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/taskpulse`](https://github.com/workermill-examples/taskpulse)
> Architecture: [README.md](./README.md)

---

## What This Ticket Delivers

Production configuration and deployment validation for TaskPulse. This is the final ticket — minimal code changes (2 files) focused on production hardening, plus local verification that the entire codebase is deployment-ready.

**Status: Not yet executed.** Spec only.

## Scope Boundary

- **Creates:** `vercel.json` (new), modifies `next.config.js` (production optimizations)
- **Verifies locally:** typecheck, lint, tests, E2E tests, seed data correctness
- **Human validates after deploy:** live URL smoke tests, Vercel deployment status

## Prerequisites

TP-4 complete — all features implemented, all tests passing.

---

## Pre-Configured Infrastructure

| Resource | Status |
|----------|--------|
| Vercel project (Next.js, Node 22) | Ready |
| Custom domain `taskpulse.workermill.com` | DNS verified |
| Neon PostgreSQL | Provisioned |
| Vercel env vars | Set |
| GitHub secrets | Set |
| Auto-deploy on push to main | Enabled |
| SSL certificate | Automatic via Vercel |

---

## Work Groups

### Work Group 1: Production Config (2 files)

**`vercel.json`** (new):
```json
{
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
  ],
  "functions": {
    "src/app/api/**/*.ts": {
      "maxDuration": 10
    }
  },
  "regions": ["iad1"]
}
```

**`next.config.js`** (modify — preserve existing ESM `export default` syntax):
- Add `poweredByHeader: false`
- Add `compress: true`
- Do NOT add any `webpack` configuration (Next.js 16 uses Turbopack by default)

### Work Group 2: Seed Data Verification

Verify `prisma/seed.ts` creates:
- Demo user (`demo@workermill.com` / `demo1234`)
- "Acme Backend Services" project
- 5 task definitions with step templates
- 50 runs with steps and logs
- 2 schedules
- 2 API keys

### Work Group 3: Database Migration Check

- Verify `prisma/migrations/` directory exists
- If not, create initial migration: `npx prisma migrate dev --name init`
- Verify `npx prisma migrate deploy` succeeds

### Work Group 4: Local Verification

1. `npm run typecheck` — 0 errors
2. `npm run lint` — 0 errors
3. `npm run test` — all pass
4. `npm run test:e2e` — all pass
5. `npm run db:seed` — completes without errors
6. Verify "Built by WorkerMill" in landing page footer
7. Git commit and push to main

---

## Acceptance Criteria

- [ ] `vercel.json` created with security headers and function config
- [ ] `next.config.js` updated with `poweredByHeader: false`
- [ ] Prisma migrations exist and `migrate deploy` succeeds
- [ ] Seed script creates full demo data
- [ ] `npm run typecheck` and `npm run lint` pass
- [ ] All unit tests pass
- [ ] All E2E tests pass
- [ ] "Built by WorkerMill" present in landing page source
- [ ] Changes committed and pushed to main

---

## Post-Deploy Smoke Tests (Human Only)

After Vercel auto-deploys the push to main:

1. `GET /api/health` returns 200 with `{ status: "ok" }`
2. Landing page loads — dark theme, "Try the Demo" button visible
3. Demo login works — redirected to "Acme Backend Services" project
4. Runs page shows 50 historical runs with status badges
5. Click a run → trace timeline displays with step bars and logs
6. Trigger a new run → watch it appear with simulated execution
7. Dashboard shows 4 charts with real data
8. Tasks page shows 5 task definitions with run counts
9. Schedules page shows 2 schedules with cron displays
10. Settings → API Keys section shows 2 keys with masked prefixes
11. Ctrl/Cmd+K opens global search
12. Keyboard shortcuts help opens with `?`
13. Responsive at 320px mobile viewport
14. Security headers present in response (`X-Content-Type-Options`, `X-Frame-Options`)
15. "Built by WorkerMill" visible in footer

---

## Estimated Plan Size

3-4 stories.
