# Testing & CI/CD

## E2E Tests (Playwright)

Location: `frontend/e2e/`. Run via GitHub Actions (manual trigger).
- Run single test: `cd frontend && npx playwright test e2e/some-test.spec.ts`
- Debug mode: `cd frontend && npx playwright test e2e/some-test.spec.ts --debug`

## Integration Tests (Vitest)

Location: `api/src/__tests__/integration/`. Each test runs in a transaction that rolls back after completion.
- Coverage generates lcov output: `cd api && npm run test:coverage`

## CI/CD Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci-cd.yml` | Manual (workflow_dispatch) | Main pipeline — lint, test, deploy |
| `agent-release.yml` | `agent-v*` tags | Build 4 platform binaries → GitHub Release |
| `vscode-release.yml` | `vscode-v*` tags | Package → publish to VS Code Marketplace |
| `e2e-local.yml` | Manual (workflow_dispatch) | E2E test runner (local or production target) |

No automatic triggers on push/PR.

## Tag-Based Releases

- `agent-v*` tags → triggers `agent-release.yml` (builds binaries for all platforms)
- `vscode-v*` tags → triggers `vscode-release.yml` (publishes to VS Code Marketplace)

---

## Vitest Configuration

### Unit Tests (`api/vitest.config.ts`)

| Setting | Value |
|---------|-------|
| Config file | `api/vitest.config.ts` |
| Include | `src/**/*.test.ts` |
| Exclude | `src/__tests__/integration/**` |
| Environment | `node` |
| Globals | `true` (no need to import `describe`/`it`/`expect`) |
| Test timeout | 30 000 ms |
| Hook timeout | 30 000 ms |
| Coverage provider | `v8` — reporters: text, json, html |
| Coverage excludes | Test files and `src/db/migrations/**` |

Run commands:
```bash
cd api && npm run test              # all unit tests
cd api && npx vitest run src/routes/some.test.ts   # single file
cd api && npm run test:coverage     # with coverage report
```

### Integration Tests (`api/vitest.integration.config.ts`)

| Setting | Value |
|---------|-------|
| Config file | `api/vitest.integration.config.ts` |
| Include | `src/__tests__/integration/**/*.test.ts` |
| Pool | `forks` with `singleFork: true` |
| Max workers | 1 (sequential — avoids DB connection pool conflicts) |
| Test timeout | 60 000 ms |
| Hook timeout | 60 000 ms |
| Setup file | `src/__tests__/integration/setup.ts` |

**Prerequisites:** `DATABASE_URL` environment variable must be set. The database must be accessible (self-hosted runner in VPC, or local dev DB on port 5432).

**Transaction isolation:** The setup file creates a TypeORM `DataSource` once before all tests. Each test gets a fresh `QueryRunner` transaction in `beforeEach`, which rolls back in `afterEach`. Use `getTestManager()` to get the scoped `EntityManager` inside tests. Enable SQL logging with `DEBUG=true`.

Run commands:
```bash
cd api && npm run test:integration                # all integration tests
cd api && npx vitest run --config vitest.integration.config.ts src/__tests__/integration/some.test.ts  # single file
cd api && npm run test:integration:watch          # watch mode
```

---

## Playwright Configuration (E2E)

Config file: `frontend/playwright.config.ts`

### General Settings

| Setting | Value |
|---------|-------|
| Test directory | `frontend/e2e/tests` |
| Fully parallel | `true` |
| Workers | 4 locally, 2 in CI |
| Retries | 0 locally, 2 in CI |
| `forbidOnly` | `true` in CI (prevents `.only` from slipping through) |
| Global timeout | 60 000 ms |
| Expect timeout | 10 000 ms |
| Reporter | HTML (`playwright-report/`) + list |
| Output directory | `e2e/test-results` |

### Artifacts

| Artifact | When captured |
|----------|---------------|
| Trace | On first retry |
| Screenshot | Only on failure |
| Video | Retained on failure |

### Projects (Test Phases)

1. **`setup`** — Runs `auth.setup.ts` to log in via Cognito hosted UI and save session state to `e2e/.auth/user.json`.
2. **`chromium`** — Main test suite. Uses Desktop Chrome device profile with the saved `storageState`. Depends on `setup`.
3. **`unauthenticated`** — Runs `auth-routes.spec.ts` only. No saved auth state (tests route protection and public pages).

### Environment Variables

Set in `frontend/.env` or shell:

| Variable | Purpose |
|----------|---------|
| `BASE_URL` | Target environment URL (default: `http://localhost:5173`) |
| `E2E_TEST_USER_EMAIL` | Test user email for Cognito login |
| `E2E_TEST_USER_PASSWORD` | Test user password for Cognito login |
| `CI` | Set by CI runners — enables stricter settings |

### Dev Server

When neither `CI` nor `BASE_URL` is set, Playwright auto-starts the Vite dev server on `http://localhost:5173` (with `reuseExistingServer: true`, 30s startup timeout). For production testing, set `BASE_URL=https://workermill.com`.

### Global Setup / Teardown

- **`e2e/global-setup.ts`** — Verifies the API is healthy before tests start. Derives API URL from `BASE_URL` (`:3001` locally, same host in production).
- **`e2e/global-teardown.ts`** — Cleans up E2E test tasks via `DELETE /api/control-center/tasks/cleanup` with prefix `E2E-`.

### Mock Worker Behavior

E2E tests create tasks with special Jira key prefixes that control mock worker behavior:

| Prefix | Behavior |
|--------|----------|
| `E2E-TEST-*` | Success (default) |
| `E2E-FAIL-*` | Failure |
| `E2E-BLOCKER-*` | Escalation |
| `E2E-SLOW-*` | Slow execution (30s) |

Run commands:
```bash
cd frontend && npm run test:e2e                          # all E2E tests (headless)
cd frontend && npx playwright test e2e/tests/some.spec.ts  # single file
cd frontend && npm run test:e2e:headed                   # with visible browser
cd frontend && npm run test:e2e:ui                       # Playwright UI mode (interactive)
cd frontend && npx playwright test --debug               # step-through debugger
```

---

## Debugging Tests Locally

### Vitest (Unit / Integration)

```bash
# Run a single test file
cd api && npx vitest run src/routes/some.test.ts

# Run tests matching a name pattern
cd api && npx vitest run -t "should create task"

# Watch mode (re-runs on file change)
cd api && npx vitest src/routes/some.test.ts

# Verbose output
cd api && npx vitest run --reporter=verbose src/routes/some.test.ts

# Integration tests with SQL logging
cd api && DEBUG=true npm run test:integration
```

### Playwright (E2E)

```bash
# Run with visible browser
cd frontend && npx playwright test e2e/tests/some.spec.ts --headed

# Step-through debugger (pauses at each action)
cd frontend && npx playwright test e2e/tests/some.spec.ts --debug

# Interactive UI mode (pick and run tests, view traces)
cd frontend && npm run test:e2e:ui

# Run a specific test by name
cd frontend && npx playwright test -g "should show dashboard"

# View the HTML report after a run
cd frontend && npx playwright show-report

# Run only the chromium project (skip setup if auth state exists)
cd frontend && npx playwright test --project=chromium

# Target production instead of local
cd frontend && BASE_URL=https://workermill.com npx playwright test
```

### Parallelism Summary

| Test type | Parallelism | Why |
|-----------|-------------|-----|
| Unit (Vitest) | Parallel (default pool) | No shared state |
| Integration (Vitest) | Sequential (`singleFork`, `maxWorkers: 1`) | Shared DB connection pool, transaction isolation |
| E2E (Playwright) | Parallel (`fullyParallel: true`, 4 workers locally) | Independent browser contexts |
