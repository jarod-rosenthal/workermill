### Epic Overview
Fix the six remaining issues preventing TeamBoard from working. No CSS styles render (missing Tailwind v4 PostCSS plugin), the middleware crashes on every page load, the seed data is incomplete, the E2E job runs too many browser projects, the Playwright webServer command is wrong for standalone output, and duplicate data-testid attributes cause all E2E tests to fail.

### Scope Boundary
- PRs #1-#4 already fixed: schema alignment, React component bugs, RBAC enforcement, SSE fixes, data-testid attributes, deploy config, and credentials.
- This card fixes ONLY the six issues below. Do NOT modify API routes, Prisma schema, or RBAC logic.
- This card MUST NOT rewrite E2E test specs — the tests are correctly written.

### Prerequisites
- PRs #1-#4 merged (foundation, frontend, deploy config, prior stabilization)

### Deliverables

#### 1. Add Tailwind v4 PostCSS plugin (zero styles rendering)

The app has zero CSS styling. Tailwind v4 requires `@tailwindcss/postcss` as a PostCSS plugin — unlike Tailwind v3, Next.js does not auto-detect it. Without this plugin, `@import "tailwindcss"` and `@theme` directives in `globals.css` are never compiled. The browser sees raw CSS it doesn't understand, so nothing is styled.

**Steps:**
1. Install: `npm install -D @tailwindcss/postcss`
2. Create `postcss.config.mjs`:
```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

That's it. No other changes needed — `globals.css` already has the correct `@import "tailwindcss"` and `@theme` block.

**Acceptance Criteria:**
- [ ] `@tailwindcss/postcss` is in `devDependencies`
- [ ] `postcss.config.mjs` exists with the plugin configured
- [ ] `npm run build` succeeds
- [ ] Load any page — Tailwind utility classes render correctly (backgrounds, spacing, colors, typography all visible)
- [ ] Landing page (`/`) shows styled hero section, not unstyled raw HTML

---

#### 2. Fix middleware Edge runtime crash

`middleware.ts` imports `auth` from `@/lib/auth`, which imports `bcrypt` (native C++ addon) and `prisma` (Node.js runtime). Next.js middleware runs in the Edge runtime, which cannot execute native Node.js modules. Every page navigation crashes with `TypeError: Cannot read properties of undefined (reading 'modules')` from `.next/server/middleware.js`.

**File:** `middleware.ts`

Replace the entire file with NextAuth v5's Edge-compatible `auth()` wrapper:
```typescript
import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isAuthenticated = !!req.auth

  const publicRoutes = ['/', '/login', '/signup']
  const isPublicRoute = publicRoutes.includes(pathname)
  const authRoutes = ['/login', '/signup']
  const isAuthRoute = authRoutes.includes(pathname)

  if (isAuthenticated && isAuthRoute) {
    const url = req.nextUrl.clone()
    url.pathname = '/workspaces'
    return NextResponse.redirect(url)
  }

  if (!isAuthenticated && !isPublicRoute) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    if (pathname !== '/login') {
      url.searchParams.set('callbackUrl', pathname)
    }
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|browserconfig.xml|og-image.png|icons).*)',
  ],
}
```

NextAuth v5's `auth()` export works as both a server-side session getter AND a middleware wrapper. When passed a callback, it decodes the JWT and attaches the session to `req.auth`. No bcrypt or Prisma needed — JWT strategy stores session data in the token itself.

**If `auth()` still pulls in bcrypt/prisma at build time**, split the auth config:
1. Create `lib/auth.config.ts` — export the NextAuth config object (providers array with Credentials, callbacks, pages) but WITHOUT `PrismaAdapter` and WITHOUT the `authorize` function that calls prisma/bcrypt
2. Create `lib/auth.ts` — import config from `auth.config.ts`, add the PrismaAdapter and authorize function, export `{ handlers, auth, signIn, signOut }`
3. In `middleware.ts` — import `auth` from a separate `NextAuth(authConfig)` call using only `auth.config.ts`

This split is documented in the NextAuth v5 docs for Edge middleware compatibility.

**Acceptance Criteria:**
- [ ] `npm run build` succeeds without Edge runtime errors
- [ ] `middleware.ts` does NOT import `bcrypt`, `prisma`, `PrismaAdapter`, or any Node.js-only module
- [ ] Navigate to `/login` — page loads without `TypeError: Cannot read properties of undefined (reading 'modules')`
- [ ] Unauthenticated user visiting `/acme-product/dashboard` is redirected to `/login`
- [ ] Authenticated user visiting `/login` is redirected to `/workspaces`
- [ ] Static routes (`/api/*`, `/_next/*`, `/favicon.ico`) are not intercepted by middleware

#### 3. Expand seed to 30 cards

The seed creates 8 cards (4 + 2 + 2). Expand to 30 total.

**Files:**
- `prisma/seed.ts` — expand `board1Cards` to 12 items, `board2Cards` to 10 items, `board3Cards` to 8 items
- `scripts/verify-seed.sh` — line 46: change `EXPECTED_CARDS=8` to `EXPECTED_CARDS=30`
- `app/api/seed/route.ts` — update if it has its own card definitions (check first)

Each card needs: title, description, varied priority (LOW/MEDIUM/HIGH/URGENT), varied assigneeId (some null, some demoUser.id), varied dueDate (some past/overdue, some future, some null), distributed across columns.

Follow the existing seed pattern: `findFirst` + conditional `create` for idempotency. Do not use `createMany`.

**Acceptance Criteria:**
- [ ] `prisma/seed.ts` creates exactly 30 cards: 12 (Product Roadmap) + 10 (Sprint 14) + 8 (Bug Tracker)
- [ ] Cards have varied priorities: at least 3 URGENT, 7 HIGH, 10 MEDIUM, 10 LOW across all boards
- [ ] Cards have varied assignees: at least 10 cards assigned to demoUser, at least 5 with null assignee
- [ ] Cards have varied due dates: at least 5 overdue (past), at least 5 future, at least 5 null
- [ ] Seed is idempotent — running twice produces no duplicates
- [ ] `scripts/verify-seed.sh` passes with `EXPECTED_CARDS=30`
- [ ] `npm run db:seed` completes without errors

#### 4. Run only Desktop Chrome in CI

The E2E job runs 148 tests x 3 browser projects (Desktop Chrome, Pixel 5, iPhone 13) = 444 tests, sequentially with 2 retries. This takes over 45 minutes.

**File:** `playwright.config.ts`

Only include mobile projects when NOT in CI:
```typescript
projects: [
  {
    name: 'Desktop Chrome',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1280, height: 720 }
    },
  },
  ...(!process.env.CI ? [
    {
      name: 'Pixel 5',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 393, height: 851 }
      },
    },
    {
      name: 'iPhone 13',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 }
      },
    },
  ] : []),
],
```

**Acceptance Criteria:**
- [ ] `CI=true npx playwright test --list` shows ~148 tests (Desktop Chrome only)
- [ ] `npx playwright test --list` (no CI) shows ~444 tests (all 3 projects)
- [ ] CI E2E job completes in under 15 minutes
- [ ] No mobile test projects appear in CI logs

#### 5. Fix Playwright webServer command for standalone output

`next.config.ts` sets `output: 'standalone'`. With this setting, `next start` does NOT work — Next.js warns: `"next start" does not work with "output: standalone" configuration. Use "node .next/standalone/server.js" instead.` The webServer never starts, so all E2E tests fail.

**File:** `playwright.config.ts`

Change the webServer command:
```typescript
webServer: {
  command: 'npm run build && node .next/standalone/server.js',
  // NOT: 'npm run build && npm run start'
  port: 3000,
  reuseExistingServer: !process.env.CI,
  timeout: 120 * 1000,
}
```

Also update any CI workflow steps that use `npm run start` to start the app — they must use `node .next/standalone/server.js` instead.

**Acceptance Criteria:**
- [ ] `playwright.config.ts` webServer command uses `node .next/standalone/server.js`
- [ ] No references to `npm run start` or `next start` for serving the built app
- [ ] Playwright webServer starts without the standalone warning
- [ ] E2E tests can connect to the running server

#### 6. Fix duplicate data-testid="user-menu" causing all E2E tests to fail

The sidebar component renders TWO DOM trees — one for desktop (`hidden lg:fixed`) and one for mobile drawer (`fixed lg:hidden`). Both contain `data-testid="user-menu"`. The E2E auth fixture (`e2e/fixtures/auth.fixture.ts:52`) does `page.locator('[data-testid="user-menu"]')` which fails with `strict mode violation: locator resolved to 2 elements`. This blocks EVERY authenticated test — 100% E2E failure rate.

**File:** `components/layout/sidebar.tsx`

Fix by making the testid unique per variant:
- Desktop: `data-testid="user-menu-desktop"`
- Mobile: `data-testid="user-menu-mobile"`

**File:** `e2e/fixtures/auth.fixture.ts`

Update the auth fixture to target the desktop variant (since E2E tests run at 1280x720):
```typescript
// Line 52: change from
await expect(page.locator('[data-testid="user-menu"]')).toBeVisible({ timeout: 10000 })
// to
await expect(page.locator('[data-testid="user-menu-desktop"]')).toBeVisible({ timeout: 10000 })
```

Also update line 65 (logout click) and any other references in `e2e/auth.spec.ts` and `e2e/mobile.spec.ts`.

**Acceptance Criteria:**
- [ ] No duplicate `data-testid` values exist in the sidebar at the 1280x720 viewport
- [ ] `page.locator('[data-testid="user-menu-desktop"]')` resolves to exactly 1 element
- [ ] Auth fixture login succeeds without strict mode violation
- [ ] `npx playwright test --project="Desktop Chrome" e2e/auth.spec.ts` passes

### Definition of Done
- [ ] All six deliverables implemented
- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] App starts, `/login` loads without errors
- [ ] `npx playwright test --project="Desktop Chrome" e2e/auth.spec.ts` passes
- [ ] `npx playwright test --project="Desktop Chrome"` — majority of tests pass
- [ ] `scripts/verify-seed.sh` — all counts match (3 boards, 30 cards, 25 activities, 5 labels)
- [ ] `CI=true npx playwright test --list` — Desktop Chrome only (~148 tests)
- [ ] PR passes GitHub Actions CI pipeline

### Service Dependencies
- Requires PostgreSQL (docker-compose or GitHub Actions service container)
- Run `docker compose up -d --wait` then `npx prisma db push` before tests
