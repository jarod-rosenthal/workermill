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
