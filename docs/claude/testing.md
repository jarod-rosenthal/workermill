# Testing & CI/CD

## E2E Tests (Playwright)

Location: `frontend/e2e/`. Run on ephemeral ECS Fargate Spot runners via GitHub Actions (manual checkbox).
- Run single test: `cd frontend && npx playwright test e2e/some-test.spec.ts`
- Debug mode: `cd frontend && npx playwright test e2e/some-test.spec.ts --debug`

## Integration Tests (Vitest)

Location: `api/src/__tests__/integration/`. Each test runs in a transaction that rolls back after completion.
- Coverage generates lcov output: `cd api && npm run test:coverage`

## CI/CD Workflows

| Workflow | Trigger | Runs on repo | Purpose |
|----------|---------|--------------|---------|
| `ci-cd.yml` | Manual (workflow_dispatch) | both | Main pipeline — lint, test, deploy |
| `agent-release.yml` | `agent-v*` tags | **`workermill/workermill` ONLY** | Build 4 platform binaries → upload to S3 CDN + GitHub Release |
| `vscode-release.yml` | `vscode-v*` tags | **`jarod-rosenthal/workermill` ONLY** | Package → publish to VS Code Marketplace |
| `e2e-local.yml` | Manual (workflow_dispatch) | both | E2E test runner (local or production target) |

No automatic triggers on push/PR.

**CRITICAL: Workflow ↔ repo mapping matters.** Both repos have the same workflow files, but:
- `agent-release.yml` needs AWS secrets (only on `workermill/workermill`) — will fail on `jarod-rosenthal/workermill`
- `vscode-release.yml` needs `VSCE_PAT` (only on `jarod-rosenthal/workermill`) — will fail on `workermill/workermill`
- Tags pushed to the WRONG repo will trigger a failing workflow. The workflow files use `if: github.repository == '...'` guards to prevent this.

## GitHub Repositories

| Repo | Purpose | Secrets |
|------|---------|---------|
| `jarod-rosenthal/workermill` | Development (public) | `VSCE_PAT` (Marketplace publish) |
| `workermill/workermill` | Production (private) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (S3 CDN upload) |

Both repos share the same code. Push to both: `git push origin main && git push upstream main`.
Git remote `origin` = `jarod-rosenthal/workermill`, `upstream` = `workermill/workermill`.

**Tag routing:**
- `vscode-v*` tags → push to `origin` only (jarod-rosenthal)
- `agent-v*` tags → push to `upstream` only (workermill/workermill)
