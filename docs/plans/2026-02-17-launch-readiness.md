# WorkerMill Launch Readiness — Free Tier

**Date:** 2026-02-17
**Status:** In Progress

---

## Critical — Must fix before launch

### 1. Settings API lets free users bypass plan limits
**File:** `api/src/routes/settings/general.ts` — PUT `/api/settings`
**Problem:** Allows changing `maxConcurrentWorkers`, `maxParallelExperts`, `warmPoolSize` with zero plan validation. A free user can set `maxConcurrentWorkers: 10` via API call and it'll be respected by the task claimer.
**Fix:** Add plan-limit validation to the PUT endpoint — reject values exceeding `PLAN_MAX_WORKERS[plan]`, `PLAN_MAX_EXPERTS[plan]`, and gate `warmPoolSize` behind `PLAN_FEATURES[plan].warmPool`.
**Status:** FIXED

### 2. Org defaults don't match free tier limits
**File:** `api/src/models/Organization.ts:236-248`
**Problem:** New orgs get `maxConcurrentWorkers: 3` (should be 1), `maxParallelExperts: 4` (should be 3), `logRetentionDays: 30` (should be 14), `defaultWorkerModel: "claude-opus-4-6"` (expensive, should be haiku for free).
**Fix:** Set defaults to match free tier limits since all new orgs start on free.
**Status:** FIXED

### 3. No pre-flight validation before running tasks
**File:** `api/src/routes/boards.ts` (~line 1470)
**Problem:** "Run Card" doesn't check if SCM credentials exist or if an AI provider API key is configured. Tasks queue, then fail minutes later with no clear error.
**Fix:** Add pre-flight checks before queuing — validate SCM provider credentials and AI provider configuration exist. Return 400 with clear error message.
**Status:** FIXED

### 4. Free tier + cloud execution = silent failure
**Problem:** Free plan has `cloudExecution: false`. If a free user queues a task, the orchestrator silently skips it with no error. The task sits `queued` forever.
**Fix:** Check plan features at task creation time and return an error if cloud execution is required but not available. Also add a clear error in the task claimer when skipping for plan reasons.
**Status:** FIXED

### 5. Failed tasks have no error message
**File:** `api/src/services/task-cleanup.ts`
**Problem:** Originally reported as missing error messages on failed tasks.
**Actual state:** Already fixed — all failure paths (`failOrphanedTasks`, `failHungTasks`, `cleanupStuckPlanningTasks`, `releaseStaleAgentTasks`) set descriptive `errorMessage` with specific reasons (timeout duration, heartbeat status, orphan cause, etc.).
**Status:** ALREADY FIXED (no change needed)

---

## High — Should fix before launch

### 6. Hardcoded oncallshift/OCS references throughout the frontend
**Files:**
- Dashboard role views (EngineerView, ManagerView, TechLeadView, CTOView, MarketingView, ProductManagerView, QAView, DevOpsView, SecurityView) use mock data with "OCS-123" task keys
- Docs pages use "OCS-123" as examples (`MCP.tsx:94`, `Integrations.tsx:270`, `AdvancedFeatures.tsx:257`)
- Settings show an "OnCallShift" integration panel visible to all users (`settings/index.tsx:274-281`)
- Support admin email hardcoded to `admin@localhost` (`SupportTicketDetail.tsx:74`)
**Fix:** Replaced all OCS-* task keys with generic PROJ-*/ACME-*/APP-* across 9 dashboard role views and 7 docs pages. Removed OnCallShift integration card and SlideOver from settings. Changed support admin email to `support@workermill.com`.
**Status:** FIXED

### 7. Dead footer links on landing page
**File:** `frontend/src/components/Footer.tsx:26-36`
**Problem:** Links to `/changelog`, `/about`, `/careers`, `/contact` go to pages that don't exist. They silently redirect to home.
**Fix:** Removed dead links. Replaced with working links: Status (status.workermill.com), Support (mailto:support@workermill.com), Sales (mailto:sales@workermill.com).
**Status:** FIXED

### 8. No empty state guidance for new users
**File:** `Dashboard/MainDashboard.tsx:3750`
**Problem:** New user with no tasks sees "No tasks yet" in a table cell. No getting-started guide, no CTA, no link to docs.
**Fix:** Added rich empty state with Rocket icon, description, and CTA links to Boards and Quick Start Guide.
**Status:** FIXED

### 9. SetupWizard is unreachable
**File:** `frontend/src/pages/SetupWizard.tsx`
**Problem:** The 4-step setup wizard exists but the onboarding route skips it. Users can complete signup without configuring any integration, then immediately fail when running tasks.
**Actual state:** Already addressed — `SetupBanner` component (`frontend/src/components/SetupBanner.tsx`) checks issue tracker, SCM, and AI provider configuration. Renders on the dashboard with progress bar and checklist linking to settings. Pre-flight validation (item 3) also catches missing config at task creation time.
**Status:** ALREADY IMPLEMENTED (no change needed)

### 10. Outdated docs reference "Team Planning"
**File:** `Docs/QuickStart.tsx:20`
**Problem:** Still says "Triggers Team Planning (parallel stories)" but team planning was removed in v0.8.0.
**Fix:** Renamed "Team Planning" to "Epic Planning" / "Planning" across QuickStart.tsx, TaskLifecycle.tsx, DocsOverview.tsx, AdvancedFeatures.tsx, and RemoteAgent.tsx.
**Status:** FIXED

---

## Medium — Fix soon after launch

### 11. Task quota exists but isn't enforced
**File:** `api/src/services/billing.ts:592`
**Problem:** `canCreateTask()` always returns `allowed: true` with `quota: -1`. The `org.taskQuota` column and `taskUsageThisMonth` counter exist but never block.
**Fix:** Added quota enforcement — when `org.taskQuota > 0` and usage meets/exceeds quota, returns `allowed: false` with clear message. Quota of -1 or 0 means unlimited (no change for those orgs).
**Status:** FIXED

### 12. No 404 error page
**File:** `App.tsx:423`
**Problem:** All unknown routes redirect to home. No visible 404 page.
**Fix:** Replaced catch-all `Navigate` with inline 404 page showing "Page not found" with a Go Home link.
**Status:** FIXED

### 13. Missing Open Graph / social meta tags
**File:** `frontend/index.html`
**Problem:** No og:title, og:description, og:image, or Twitter Card tags.
**Fix:** Added og:title, og:description, og:url, og:site_name, og:type, twitter:card, twitter:title, twitter:description to index.html.
**Status:** FIXED

### 14. Coordination feed empty state for single-expert tasks
**File:** `CoordinationFeed.tsx`
**Problem:** Standard SDK mode posts nothing to the feed. Empty white space with no explanation.
**Fix:** Empty state now shows "Single-expert mode" with explanation that coordination messages appear in multi-expert (Epic) mode. Epic tasks and no-task-selected states have their own messages.
**Status:** FIXED

### 15. Log streaming has no keep-alive
**Problem:** SSE log endpoint doesn't send heartbeats. Browser closes connection after ~30s inactivity.
**Actual state:** Already has a ping every 20 seconds (`setInterval(sendPing, 20000)` at `logs.ts:432`). Connection cleanup is also correct — both `clearInterval()` calls and event unsubscribes fire on `req.on("close")`.
**Status:** ALREADY FIXED (no change needed)

### 16. Dashboard table not responsive
**File:** `MainDashboard.tsx`
**Problem:** 11-column table with no mobile breakpoints. Unusable on tablets/phones.
**Fix:** `overflow-x-auto` wrapper already existed. Added `min-w-[900px]` to the table so it scrolls horizontally on smaller screens instead of squishing columns.
**Status:** FIXED

---

---

## Round 2 — Deep Dive Findings (2026-02-17)

### 17. Welcome email sent from founder's personal address
**File:** `api/src/services/email/welcome-emails.ts:254`
**Problem:** Emails sent from `Jarod Rosenthal <jarod.rosenthal@workermill.com>` — users reply to founder instead of support.
**Fix:** Changed to `WorkerMill <support@workermill.com>`.
**Status:** FIXED

### 18. OCS references in backend API (swagger, utils, routes)
**Files:** `api/src/config/swagger.ts`, `api/src/utils/jira.ts`, `api/src/utils/linear.ts`, `api/src/routes/tasks/crud.ts`
**Problem:** Swagger docs and JSDoc comments still used OCS-123, OCS-19, OCS-410 examples.
**Fix:** Replaced all with PROJ-123, PROJ-19, PROJ-410.
**Status:** FIXED

### 19. Hardcoded test email in auth middleware
**File:** `api/src/middleware/auth.ts:50, 133, 285, 397`
**Problem:** Local-mode auth used `admin@localhost` to find dev user. Not a production risk (gated by `EXECUTION_MODE === "local"`) but unnecessarily specific.
**Fix:** Changed to `{ role: "admin" }` lookup — finds any admin user for local dev.
**Status:** FIXED

### 20. Stripe price fallback uses invalid literal string
**File:** `api/src/config/index.ts:142-144`
**Problem:** If `STRIPE_PRICE_PRO` env var not set, defaults to `"price_pro"` literal — not a valid Stripe price ID. Checkout would fail with cryptic error.
**Fix:** Changed fallback to empty string so the existing `if (!priceId)` guard catches it cleanly.
**Status:** FIXED

### 21. Card description and comment content have no length limit
**Files:** `api/src/routes/boards.ts:1117, 1696`
**Problem:** Card description and comment body accepted unlimited text — storage abuse vector.
**Fix:** Added `.isLength({ max: 5000 })` to both validators.
**Status:** FIXED

### 22. Card number generation doesn't check org ownership
**File:** `api/src/routes/boards.ts:1146`
**Problem:** Raw SQL UPDATE to increment card number only checked board ID, not org ID.
**Fix:** Added `AND "org_id" = $2` to WHERE clause.
**Status:** FIXED

### 23. Label delete doesn't verify board org ownership
**File:** `api/src/routes/boards.ts:1613`
**Problem:** Delete card-label only checked cardId+labelId, not that the board belongs to the requesting org.
**Fix:** Added board ownership verification before delete.
**Status:** FIXED

### 24. VerifyEmail resend button disabled when email empty
**File:** `frontend/src/pages/VerifyEmail.tsx:315`
**Problem:** Resend code button was disabled if email field was empty — user got stuck if URL param was lost after code expired.
**Fix:** Removed `!email` from disabled condition. Handler already shows "Please enter your email" if field is empty.
**Status:** FIXED

### 25. Expired invite has no recovery path
**File:** `frontend/src/pages/AcceptInvite.tsx:243`
**Problem:** Error state showed "request a new one" but had no link or contact info.
**Fix:** Added support email link and guidance to contact team admin.
**Status:** FIXED

### 26. Dead pages bloating bundle (~3,700 LOC)
**Files:** `PricingPage.tsx`, `ProductPage.tsx`, `SolutionsPage.tsx`, `Build.tsx`
**Problem:** 4 orphaned page files never imported or routed anywhere.
**Fix:** Deleted all 4 files.
**Status:** FIXED

### 27. Missing OpenGraph meta tags
**(See item 13 above — FIXED)**

---

## Low — Cleanup items

- ~~Pro-only features shown grayed out in Settings — could hide entirely or improve "Upgrade" messaging~~ FIXED — LockedOverlay now links to /pricing with hover highlight
- ~~`VITE_API_URL` fallback to empty string could cause subtle issues~~ NOT A BUG — empty string means same-origin relative URLs, which is correct for production
- ~~Coordination feed lacks timestamps on messages~~ ALREADY IMPLEMENTED — `formatTime()` renders HH:MM:SS on every message
- ~~Coordination feed doesn't auto-scroll to new messages~~ ALREADY IMPLEMENTED — `wasAtBottomRef` auto-scrolls when user is at bottom, shows "New messages" button otherwise
- ~~Multiple `console.error()` calls with minimal context~~ FIXED — removed console.error in CoordinationFeed SSE handler

---

## What's working well

- Signup → email verification → login flow is solid
- API key auto-generated at org creation
- Auth boundaries properly enforced (no leaks on public pages)
- Pricing page accurate and clear
- Legal pages (Terms, Privacy, Security) present and dated
- Profile management complete (name, password, MFA, delete account)
- Boards/Kanban feature ready
- Credit billing system properly implemented
- Cloud execution and multi-provider properly gated in middleware
