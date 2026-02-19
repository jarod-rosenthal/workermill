# Streamline WorkerMill for Launch — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove noise features (mock role dashboards, unearned compliance center, defensive comparison table) and add Beta badges to experimental features so WorkerMill presents a focused, credible product at launch.

**Architecture:** Frontend-only changes across 4 areas: delete dead view files, gate one route by org plan, add CSS badges to dropdown items, remove one landing page section. No API changes.

**Tech Stack:** React 19, React Router, Zustand (auth-store), TailwindCSS

---

### Task 1: Delete Role-Based Dashboard Views

Delete all 12 mock role-based view files plus supporting infrastructure. These use 100% hardcoded mock data and are not linked from the main dashboard nav.

**Files:**
- Delete: `frontend/src/pages/Dashboard/EngineerView.tsx`
- Delete: `frontend/src/pages/Dashboard/ManagerView.tsx`
- Delete: `frontend/src/pages/Dashboard/DevOpsView.tsx`
- Delete: `frontend/src/pages/Dashboard/SecurityView.tsx`
- Delete: `frontend/src/pages/Dashboard/QAView.tsx`
- Delete: `frontend/src/pages/Dashboard/TechLeadView.tsx`
- Delete: `frontend/src/pages/Dashboard/ProductManagerView.tsx`
- Delete: `frontend/src/pages/Dashboard/HRView.tsx`
- Delete: `frontend/src/pages/Dashboard/CTOView.tsx`
- Delete: `frontend/src/pages/Dashboard/FinanceView.tsx`
- Delete: `frontend/src/pages/Dashboard/SalesView.tsx`
- Delete: `frontend/src/pages/Dashboard/MarketingView.tsx`
- Delete: `frontend/src/components/dashboards/RoleSwitcher.tsx`
- Delete: `frontend/src/components/dashboards/index.ts`
- Delete: `frontend/src/components/dashboards/` (entire directory — all components are only consumed by the deleted View files)
- Delete: `frontend/src/types/dashboard.ts`
- Modify: `frontend/src/pages/Dashboard/index.tsx` — Remove all View imports, RoleSwitcher import, UserRole import, RoleBasedDashboard export, and individual view re-exports. Keep only the `export { default } from "./MainDashboard"` line.
- Modify: `frontend/src/App.tsx` — Remove the `/views` route and `RoleBasedDashboard` import.

**Step 1: Delete the 12 view files**

```bash
rm frontend/src/pages/Dashboard/EngineerView.tsx \
   frontend/src/pages/Dashboard/ManagerView.tsx \
   frontend/src/pages/Dashboard/DevOpsView.tsx \
   frontend/src/pages/Dashboard/SecurityView.tsx \
   frontend/src/pages/Dashboard/QAView.tsx \
   frontend/src/pages/Dashboard/TechLeadView.tsx \
   frontend/src/pages/Dashboard/ProductManagerView.tsx \
   frontend/src/pages/Dashboard/HRView.tsx \
   frontend/src/pages/Dashboard/CTOView.tsx \
   frontend/src/pages/Dashboard/FinanceView.tsx \
   frontend/src/pages/Dashboard/SalesView.tsx \
   frontend/src/pages/Dashboard/MarketingView.tsx
```

**Step 2: Delete the dashboards components directory and types**

```bash
rm -rf frontend/src/components/dashboards
rm frontend/src/types/dashboard.ts
```

**Step 3: Rewrite `frontend/src/pages/Dashboard/index.tsx`**

Replace the entire file with just the default export:

```tsx
// Re-export the main Dashboard component as the default export
// This allows `import Dashboard from "./pages/Dashboard"` to resolve correctly
export { default } from "./MainDashboard";
```

**Step 4: Remove `/views` route from `frontend/src/App.tsx`**

Remove the import on line 7:
```tsx
import { RoleBasedDashboard } from "./pages/Dashboard/index";
```

Remove the route block (lines 290-297):
```tsx
          <Route
            path="/views"
            element={
              <ProtectedRoute>
                <RoleBasedDashboard />
              </ProtectedRoute>
            }
          />
```

**Step 5: Verify typecheck passes**

Run: `cd frontend && npx tsc -b`
Expected: No errors

**Step 6: Commit**

```bash
git add -A frontend/src/pages/Dashboard/ frontend/src/components/dashboards/ frontend/src/types/dashboard.ts frontend/src/App.tsx
git commit -m "feat: remove mock role-based dashboard views

12 role views (Engineer, Manager, CTO, etc.) used 100% hardcoded mock
data. Remove views, supporting components, and /views route."
```

---

### Task 2: Gate `/compliance` Behind Enterprise Plan

Only show the Compliance Center route and its Settings sidebar link when the org is on the enterprise plan.

**Files:**
- Modify: `frontend/src/App.tsx:365-373` — Wrap `/compliance` route in plan check
- Modify: `frontend/src/pages/settings/index.tsx:81-83` — Gate the Compliance Center external link

**Step 1: Add plan-gated compliance route in `frontend/src/App.tsx`**

The `/compliance` route block (lines 365-373) currently reads:

```tsx
          {/* Compliance Center */}
          <Route
            path="/compliance"
            element={
              <ProtectedRoute>
                <Compliance />
              </ProtectedRoute>
            }
          />
```

Wrap it in a conditional that checks the org plan. Add `useAuthStore` usage — it's already imported on line 61. Inside the `App` component, the `organization` is not currently destructured but we can read it inline in the JSX. However, since `App` already calls `useAuthStore` for multiple selectors (lines 111-116), add one more:

After line 116 (`const setNeedsSetup = ...`), the org data is set via `setOrganization`. But we need to read the current org in the render. Add after line 116:

```tsx
const organization = useAuthStore((state) => state.organization);
```

Then replace the compliance route block with:

```tsx
          {/* Compliance Center — enterprise plan only */}
          {organization?.plan === 'enterprise' && (
            <Route
              path="/compliance"
              element={
                <ProtectedRoute>
                  <Compliance />
                </ProtectedRoute>
              }
            />
          )}
```

**Step 2: Gate the Settings sidebar link in `frontend/src/pages/settings/index.tsx`**

The Settings component already reads `organization` from auth store on line 87. The external links are rendered at line 2218. Change the `EXTERNAL_LINKS` constant (lines 81-83) to be computed inside the component based on org plan.

Remove the top-level constant (lines 80-83):
```tsx
// External link items (not categories, but navigation links)
const EXTERNAL_LINKS: ExternalLinkItem[] = [
  { label: "Compliance Center", icon: <Shield className="w-5 h-5" />, href: "/compliance" },
];
```

Inside the `Settings()` function, after line 89 (`const [activeCategory, ...]`), add:

```tsx
  const externalLinks: ExternalLinkItem[] = organization?.plan === 'enterprise'
    ? [{ label: "Compliance Center", icon: <Shield className="w-5 h-5" />, href: "/compliance" }]
    : [];
```

Then at line 2218, change `EXTERNAL_LINKS.map` to `externalLinks.map`. Also wrap the entire "Enterprise" section so it doesn't show an empty header:

```tsx
              {/* External Links */}
              {externalLinks.length > 0 && (
                <div className="mt-6 pt-4 border-t border-border/30">
                  <p className="px-3 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Enterprise</p>
                  {externalLinks.map((link) => (
```

And close the conditional `)}` after the existing closing `</div>`.

**Step 3: Verify typecheck passes**

Run: `cd frontend && npx tsc -b`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/settings/index.tsx
git commit -m "feat: gate compliance center behind enterprise plan

Compliance Center route and Settings sidebar link now only visible
when org.plan === 'enterprise'."
```

---

### Task 3: Add Beta Badges to Insights Dropdown

Add a small "Beta" pill badge next to Cost Intelligence, Memory, Skills, and Directive Effectiveness in the Insights dropdown. Analytics stays unbadged.

**Files:**
- Modify: `frontend/src/pages/Dashboard/MainDashboard.tsx:2209-2240` — Add badge spans

**Step 1: Add Beta badges to four dropdown items**

In `MainDashboard.tsx`, the Insights dropdown items are at lines 2209-2240. Add a `<span>` badge after the text label for each of the four items. The badge style is:

```
className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto"
```

The four items to badge (leave Analytics at line 2201-2208 untouched):

**Cost Intelligence** (line 2215): Change from:
```tsx
                      Cost Intelligence
```
to:
```tsx
                      Cost Intelligence
                      <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
```

**Memory Management** (line 2223): Change from:
```tsx
                      Memory Management
```
to:
```tsx
                      Memory Management
                      <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
```

**Skill Library** (line 2231): Change from:
```tsx
                      Skill Library
```
to:
```tsx
                      Skill Library
                      <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
```

**Directive Analytics** (line 2239): Change from:
```tsx
                      Directive Analytics
```
to:
```tsx
                      Directive Analytics
                      <span className="text-[10px] font-medium bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full ml-auto">Beta</span>
```

**Step 2: Verify typecheck passes**

Run: `cd frontend && npx tsc -b`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/pages/Dashboard/MainDashboard.tsx
git commit -m "feat: add Beta badges to experimental Insights features

Badge Cost Intelligence, Memory, Skills, and Directive Analytics
as Beta in the dashboard Insights dropdown."
```

---

### Task 4: Remove CompetitiveComparison from Landing Page

Remove the competitive comparison table from the landing page. Keep the component file for potential future use.

**Files:**
- Modify: `frontend/src/pages/LandingV0.tsx:12,215` — Remove import and render

**Step 1: Remove import and usage from `LandingV0.tsx`**

Remove the import on line 12:
```tsx
import CompetitiveComparison from "../components/CompetitiveComparison";
```

Remove the render on lines 214-215:
```tsx
          {/* Competitive Comparison */}
          <CompetitiveComparison />
```

**Step 2: Verify typecheck passes**

Run: `cd frontend && npx tsc -b`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/pages/LandingV0.tsx
git commit -m "feat: remove competitive comparison from landing page

The comparison table vs Copilot/Cursor/Devin risks looking defensive
and ages quickly. Component file kept for potential future use."
```

---

### Task 5: Final Verification

**Step 1: Full typecheck**

Run: `cd frontend && npx tsc -b`
Expected: No errors

**Step 2: Lint check**

Run: `cd frontend && npm run lint`
Expected: No new errors (pre-existing warnings are OK)

**Step 3: Visual verification (if dev server running)**

Verify:
- `/views` returns 404
- `/compliance` shows 404 for non-enterprise orgs
- Dashboard Insights dropdown shows Beta badges on 4 items, not on Analytics
- Landing page has no comparison table section
- Everything else works normally
