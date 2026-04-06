# WorkerMill Project Guide

## 1. Project Overview
WorkerMill is the open-source operations layer for AI coding agents. It provides a platform for deploying, orchestrating, and monitoring autonomous AI coding teams that plan, execute, and deliver pull requests.

The platform serves developers and teams who want to leverage AI agents for software development tasks, offering multi-expert orchestration, quality gates, real-time monitoring, and enterprise-grade security features.

## 2. Tech Stack
- **Languages**: TypeScript 5.9.3 (API, Worker, Agent, CLI), TypeScript ~5.9.3 (Frontend), TypeScript 6.0.2 (CLI newer)
- **Frameworks**: Express 4.21.0 (API), React 19.2.0 + Vite 7.2.4 (Frontend), Ink 6.8.0 (CLI terminal UI)
- **Database**: PostgreSQL 13+ with TypeORM 0.3.20
- **ORM**: TypeORM with entity subscribers for auto-encryption
- **Cache/Message Queue**: Redis (optional, falls back to DB polling)
- **Authentication**: Cognito JWT (cloud) or local admin bypass (dev)
- **AI Providers**: Anthropic Claude, OpenAI GPT, Google Gemini, Ollama (via Vercel AI SDK)
- **Testing**: Vitest 4.1.0 (API, Frontend, Worker), Playwright 1.49.1 (E2E)
- **Key Libraries**: ai v6.0.0, bcryptjs, stripe, winston, zod, zustand

## 3. Architecture
Monorepo with independent services: API (Express), Frontend (React SPA), Worker (Docker execution), Agent (CLI/binary), CLI (npm package).

**Directory Structure**:
- `api/` - REST API server with TypeORM entities and routes
- `frontend/` - React SPA with Zustand state management
- `worker/` - AI execution scripts in Docker containers
- `agent/` - CLI agent with binary builds (Bun compile)
- `cli/` - Open-source CLI package (npx workermill)
- `packages/vscode-workermill/` - VS Code extension
- `packages/workermill-mcp/` - Model Context Protocol server

**Data Flow**: Client → API → Orchestrator polls DB → Spawns Workers → Execute in Docker → Git commits → Quality gates → PR creation.

**Key Abstractions**: 
- Boards (Kanban UI) vs Projects (internal tasks)
- 7 inline agents (reviewer, verifier, CI fixer, etc.)
- Planning workflow with critic loop
- Execution pipeline with quality gates

## 4. Quick Reference
| Task | Command |
|------|---------|
| Install | `npm install` (root workspaces) |
| Dev server API | `cd api && npm run dev` |
| Dev server Frontend | `cd frontend && npm run dev` |
| Dev server Local | `./bin/local-workermill start` |
| Test API | `cd api && npm run test` |
| Test API Integration | `cd api && npm run test:integration` |
| Test Frontend | `cd frontend && npm run test` |
| Test Frontend E2E | `cd frontend && npm run test:e2e` |
| Test Worker | `cd worker && npm run test` |
| Build API | `cd api && npm run build` |
| Build Frontend | `cd frontend && npm run build` |
| Build Agent Binary | `cd agent && npm run build:binary` |
| Build Worker Docker | `./bin/local-workermill build-worker` |
| Lint API | `cd api && npm run lint` |
| Lint Frontend | `cd frontend && npm run lint` |
| Type check API | `cd api && npm run typecheck` |
| Type check Frontend | `cd frontend && npx tsc -b` |
| Type check Agent | `cd agent && npm run typecheck` |
| Type check Worker | `cd worker && npm run typecheck` |
| Type check CLI | `cd cli && npm run typecheck` |
| Create Migration | `cd api && npm run migrate:create NAME` |
| Run Migration | `cd api && npm run migrate` |
| Seed Data | `cd api && npm run seed` |
| Package VS Code Ext | `cd packages/vscode-workermill && npm run package` |
| Publish CLI | `cd cli && npm publish --access public` |
| Deploy Cloud | `./deploy.sh --api/--frontend/--worker/--all` |
| Connect Prod DB | `./bin/bastion start` |
| Stop Prod DB | `./bin/bastion stop` |

## 5. Coding Standards
- **Naming**: camelCase for variables/functions, PascalCase for components/classes, snake_case for DB columns
- **File Structure**: One component per file, barrel exports (index.ts), routes in separate files
- **Imports**: Grouped (external libs, then internal), relative imports with `./`
- **Error Handling**: Try/catch with specific error types, Winston logging
- **State Management**: Zustand stores (frontend), DB polling + Redis pub/sub (coordination)
- **Comments**: JSDoc for public APIs, inline for complex logic
- **Async**: Async/await preferred, Promises for complex flows
- **Styling**: Tailwind CSS classes, consistent spacing

## 6. Key Files & Entry Points
- **API**: `api/src/index.ts` (Express server), `api/src/routes/index.ts` (route mounting)
- **Frontend**: `frontend/src/main.tsx` (Vite entry), `frontend/src/App.tsx` (routing)
- **Agent**: `agent/src/entry.ts` (binary entry), `agent/src/cli.ts` (CLI mode)
- **CLI**: `cli/src/index.ts` (Commander.js), `cli/src/agent.ts` (orchestrator)
- **Worker**: `worker/epic-entrypoint.sh` (Docker entry), `worker/epic/coordinator.ts` (execution)
- **VS Code**: `packages/vscode-workermill/src/extension.ts`
- **DB Schema**: `api/src/models/` (TypeORM entities), `api/src/db/connection.ts` (config)
- **Config**: `api/src/config/index.ts`, `.env.local.example`
- **Environment**: `DATABASE_URL`, `EXECUTION_MODE=local`, `CLAUDE_CODE_OAUTH_TOKEN`

## 7. Testing
- **Framework**: Vitest (all services), Playwright (E2E frontend)
- **Structure**: Co-located test files (`*.test.ts`), separate integration/e2e directories
- **Run Single Test**: `cd api && npx vitest run src/routes/some.test.ts`
- **Patterns**: Unit tests for utils, integration for API routes (transaction isolation), E2E for full flows
- **Fixtures**: Factories in `worker/epic/__tests__/helpers/factories.ts`, mocks in `mocks.ts`

## 8. Common Pitfalls
- **Node Version**: Requires Node >=20 everywhere
- **Local Dev**: Use `./bin/local-workermill start` (spawns API + frontend + workers)
- **Git**: Never `git add -f` or bypass `.gitignore` (critical docs in `/docs/`, `/private/`)
- **TypeORM**: `save()` clobbers concurrent changes — use atomic UPDATE
- **Express**: Route middleware applies to ALL subsequent routes (order matters)
- **Org Credentials**: Stored encrypted in DB, accessed via `getOrgSecretFromDb()`
- **Agent Binary**: Changes require new binary release (not hot-reload)
- **Docker Desktop**: Socket detection uses `isDockerDesktop()` (includes win32)
- **Planner**: Critic threshold 85/100, simplified planning mode default
- **Hardcoded Fallbacks**: Avoid `??` or `||` for org settings (pass through)
- **Frontend Settings**: Mirror VS Code extension settings identically
- **Ollama**: Set `keep_alive: "-1"` to prevent model unload
- **Bash Tool**: Process groups (`detached: true`, `process.kill(-pid)`) for cleanup
- **Tool Loop Detection**: Aborts if 4+ identical tool calls in 6 steps
- **Control-center Status**: Include `cancelled` in BOTH `dashboard.ts` and `stream.ts` filters

## 9. Git & Workflow
- **Branch**: Work on `main`, feature branches optional
- **Commits**: Conventional commits (type: description)
- **PR**: Manual CI/CD workflows (no auto on push), manual deploy triggers
- **Release**: Agent binary (`agent-v*` tag), VS Code ext (`vscode-v*` tag)