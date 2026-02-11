# TeamBoard E2E Test Post-Mortem

> Why the PRD's E2E test requirements were not met by AI workers, and what needs to change.

## Context

The TeamBoard PRD (`docs/TEAMBOARD_PRD.md` in the teamboard repo) includes comprehensive E2E testing requirements:

- **Quality Gate**: "E2E tests: 100% pass" (Playwright)
- **Accessibility Gate**: "0 violations on main pages" (axe-core in Playwright)
- **Mandatory Rule #7**: E2E tests must cover core user flows (auth, workspace, dashboard, board, mobile)
- **Mandatory Rule #9**: Workers must update existing test mocks after code changes
- **Mandatory Rule #10**: Never merge a PR with failing CI, even with the deploy label

Despite these explicit requirements, TB-5 (OCS-35: Extended Features) was merged via PR #6 with **4 failing E2E tests and 1 flaky test**. Two additional manual fix commits were required to reach green CI.

---

## What Failed

### TB-5 PR #6 Test Results

| Result | Count |
|--------|-------|
| Passed | 94 |
| **Failed** | **4** |
| Flaky | 1 |
| Skipped | 27 |

### Failure 1: Dashboard axe-core critical violation

**Test**: `accessibility.spec.ts:80` — "workspace dashboard has no critical a11y violations"

**Root cause**: The WorkspaceSearch component (new in TB-5) rendered an `<input type="search">` with `aria-expanded="false"` and `aria-controls="search-results"`. Per the WAI-ARIA spec, `aria-expanded` is **not allowed** on `type="search"` inputs. axe-core correctly flagged this as a critical `aria-allowed-attr` violation.

**Fix**: Remove `aria-expanded` and `aria-controls` from the search input (commit `191f70b`).

**Why the worker got it wrong**: The worker applied ARIA attributes by pattern-matching (combobox/autocomplete patterns) without verifying they're valid for the specific element role. A search input with `role="search"` wrapper does not support `aria-expanded`.

### Failure 2: Boards page — non-existent route

**Test**: `accessibility.spec.ts:96` — "boards page has no critical a11y violations"

**Root cause**: The test navigated to `/acme-product/boards` and expected a heading "Boards". This page **does not exist** — boards are at `/acme-product/boards/[id]` (individual board pages). There is no boards list page.

**Fix**: Changed test to fetch boards via API, navigate to the first board's page, and assert on the board name (commit `191f70b`).

**Why the worker got it wrong**: The worker assumed a `/boards` index page existed based on the sidebar nav item, without verifying the actual routes. The test was written against an imagined UI, not the real one.

### Failure 3: Sidebar keyboard navigation — wrong element targeted

**Test**: `accessibility.spec.ts:111` — "sidebar navigation items are keyboard accessible"

**Root cause**: The test used `nav.getByText('Dashboard')` which resolved to the `<span>Dashboard</span>` inside the `<a>` link. When `.focus()` was called on the span, the **parent link** received focus (as expected for focusable elements), but `toBeFocused()` on the span returned "inactive" because spans are not focusable.

**Fix**: Changed to `nav.getByRole('link', { name: /Dashboard/i })` to target the actual focusable `<a>` element (commit `191f70b`).

**Why the worker got it wrong**: The worker didn't understand the distinction between text nodes and focusable elements. `getByText` finds the innermost element containing the text (the span), but focus goes to the nearest focusable ancestor (the link).

### Failure 4: Chart descriptions — strict mode violation + wrong selector

**Test**: `accessibility.spec.ts:184` — "chart sections have accessible descriptions"

**Root cause (two issues)**:
1. `getByText('Workspace Overview')` (without `{ exact: true }`) matched both the chart title "Workspace Overview" and the dashboard subtitle "Workspace overview and analytics" (substring match).
2. `locator('[role="img"]')` matched both the intentional `<div role="img">` wrappers AND recharts' internal `<svg>` elements (which have implicit `role="img"`), inflating the count.

**Fix**: Added `{ exact: true }` to the text query and changed selector to `div[role="img"]` (commit `191f70b`).

**Why the worker got it wrong**: The worker didn't understand Playwright's default substring matching behavior for `getByText`, and didn't account for SVG elements having implicit ARIA roles.

### Flaky: Focus indicator — brittle tab order assumption

**Test**: `accessibility.spec.ts:226` — "interactive elements have visible focus indicators"

**Root cause**: The test pressed Tab 3 times (skip link → TeamBoard link → email input) and asserted `toBeFocused()` on the email input. Tab order varies across browsers — on mobile-safari, focus behavior differs from chromium.

**Flaky on**: `mobile-safari` project (WebKit/iPhone 14 viewport).

---

## Mandatory Rules Violated

| Rule | Requirement | What Happened |
|------|------------|---------------|
| **#7** | E2E tests must cover core user flows | Tests were written but don't actually test the real UI — they test imagined pages and wrong selectors |
| **#9** | Workers must update existing test mocks | Worker added new components (WorkspaceSearch) with invalid ARIA that broke existing axe-core tests |
| **#10** | Never merge with failing CI | PR #6 was merged with 4 failing E2E tests |

---

## Root Cause Analysis

### 1. Worker did not run E2E tests before merging

The worker merged PR #6 without verifying E2E tests passed. The CI ran and failed, but the worker had already merged. This is the most critical issue — all other failures would have been caught and fixed if the worker verified CI first.

### 2. Tests written against assumptions, not the actual DOM

Three of the four failures stem from the worker assuming what the DOM looks like rather than inspecting it:
- Assumed `/boards` route exists (it doesn't)
- Assumed `getByText` returns the focusable element (it returns the text node)
- Assumed `getByText` does exact matching (it does substring by default)
- Assumed `[role="img"]` only matches wrapper divs (SVGs also have this role)

### 3. ARIA attributes applied by pattern without validation

The worker applied `aria-expanded` to a search input following combobox patterns, but didn't verify the attribute is valid for the element's implicit role. This is a common mistake when workers copy ARIA patterns from examples without understanding role-specific attribute constraints.

### 4. No pre-merge test execution in the worker execution pipeline

The Epic Mode worker pipeline does not enforce "run E2E tests and verify green" before creating the PR. The worker creates the PR immediately after code changes, relying on CI to catch issues — but then merges without waiting for CI results.

---

## Recommendations

### Short-term (Worker Directives)

1. **Add to CLAUDE.md**: "Before creating PR, run `npm run test:e2e` and verify all tests pass. If E2E tests fail, fix them before proceeding."

2. **Add to CLAUDE.md**: "When writing Playwright selectors, use `getByRole` with `{ name }` instead of `getByText` for interactive elements. Use `{ exact: true }` when text might be a substring of other content."

3. **Add to CLAUDE.md**: "Before adding ARIA attributes, verify they are allowed on the target element's role at https://www.w3.org/TR/wai-aria-1.2/#role_definitions."

### Medium-term (Platform Changes)

4. **Deploy gate enforcement**: When the `deploy` label is present, the worker should poll CI status and only merge after all checks pass. Currently, the worker merges immediately.

5. **E2E pre-flight check**: Add a step to the Epic coordinator that runs `npm run test:e2e` (if the script exists) before creating the PR. Block PR creation if tests fail.

6. **Axe-core integration in worker pipeline**: Run a quick axe-core scan as part of the worker's verification phase, not just in CI. This catches ARIA violations before they reach CI.

### Long-term (Quality Framework)

7. **Test-aware planning**: The planner should identify which existing E2E tests might break when modifying components. The plan should include "verify these tests still pass" as explicit stories.

8. **Post-merge CI monitor**: If CI fails after merge, automatically create a follow-up task to fix the failures instead of requiring manual intervention.

---

## Timeline of Events

| Time | Event |
|------|-------|
| 02:45 UTC | TB-5 PR #6 merged to main |
| 02:49 UTC | CI starts (126 tests, 1 worker) |
| 02:53 UTC | CI fails: 4 failed, 1 flaky |
| 03:21 UTC | First fix commit (`191f70b`): fixed 3 of 4 issues |
| 03:21 UTC | CI runs again, still fails (remaining issue) |
| 03:28 UTC | Second fix commit (`3c4ea56`): removed remaining invalid ARIA |
| 03:28 UTC | CI runs, all 126 tests pass |

**Total time to green CI**: 43 minutes of manual cleanup after a worker-generated PR.
