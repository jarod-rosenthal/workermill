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
**Fix:** Replace all OCS references with generic examples (PROJ-123, ACME-456). Remove or gate OnCallShift integration panel. Move support admin emails to org settings.
**Status:** TODO

### 7. Dead footer links on landing page
**File:** `frontend/src/components/Footer.tsx:26-36`
**Problem:** Links to `/changelog`, `/about`, `/careers`, `/contact` go to pages that don't exist. They silently redirect to home.
**Fix:** Remove dead links or create placeholder pages.
**Status:** TODO

### 8. No empty state guidance for new users
**File:** `Dashboard/MainDashboard.tsx:3750`
**Problem:** New user with no tasks sees "No tasks yet" in a table cell. No getting-started guide, no CTA, no link to docs.
**Fix:** Add a proper empty state component with icon, description, and CTA button (like BoardsList has).
**Status:** TODO

### 9. SetupWizard is unreachable
**File:** `frontend/src/pages/SetupWizard.tsx`
**Problem:** The 4-step setup wizard exists but the onboarding route skips it. Users can complete signup without configuring any integration, then immediately fail when running tasks.
**Fix:** Either integrate the wizard into the onboarding flow or add a "setup incomplete" banner on the dashboard that links to settings.
**Status:** TODO

### 10. Outdated docs reference "Team Planning"
**File:** `Docs/QuickStart.tsx:20`
**Problem:** Still says "Triggers Team Planning (parallel stories)" but team planning was removed in v0.8.0.
**Fix:** Update to "Triggers planning and execution workflow."
**Status:** TODO

---

## Medium — Fix soon after launch

### 11. Task quota exists but isn't enforced
**File:** `api/src/services/billing.ts:592`
**Problem:** `canCreateTask()` always returns `allowed: true` with `quota: -1`. The `org.taskQuota` column and `taskUsageThisMonth` counter exist but never block.
**Fix:** Wire up quota enforcement in `canCreateTask()`.
**Status:** TODO

### 12. No 404 error page
**File:** `App.tsx:423`
**Problem:** All unknown routes redirect to home. No visible 404 page.
**Fix:** Create a 404 page component.
**Status:** TODO

### 13. Missing Open Graph / social meta tags
**File:** `frontend/index.html`
**Problem:** No og:title, og:description, og:image, or Twitter Card tags.
**Fix:** Add standard meta tags for social sharing.
**Status:** TODO

### 14. Coordination feed empty state for single-expert tasks
**File:** `CoordinationFeed.tsx`
**Problem:** Standard SDK mode posts nothing to the feed. Empty white space with no explanation.
**Fix:** Show "Single-expert mode" placeholder.
**Status:** TODO

### 15. Log streaming has no keep-alive
**Problem:** SSE log endpoint doesn't send heartbeats. Browser closes connection after ~30s inactivity.
**Fix:** Add SSE keep-alive/heartbeat.
**Status:** TODO

### 16. Dashboard table not responsive
**File:** `MainDashboard.tsx`
**Problem:** 11-column table with no mobile breakpoints. Unusable on tablets/phones.
**Fix:** Add horizontal scroll wrapper or card-based mobile layout.
**Status:** TODO

---

## Low — Cleanup items

- Pro-only features shown grayed out in Settings — could hide entirely or improve "Upgrade" messaging
- `VITE_API_URL` fallback to empty string could cause subtle issues
- Coordination feed lacks timestamps on messages
- Coordination feed doesn't auto-scroll to new messages
- Multiple `console.error()` calls with minimal context

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
