# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is WorkerMill?

Mission control for autonomous AI coding agents. A real-time monitoring and orchestration system for AI agents that execute coding tasks - "htop for AI workers."

## Development Commands

### Local Development (Docker Compose)
```bash
# Start all services (PostgreSQL, API, Dashboard)
docker-compose up -d

# Start only PostgreSQL for local development
docker-compose up -d postgres

# Dashboard: http://localhost:3000
# API: http://localhost:4000
```

### Monorepo Commands (packages/*)
```bash
npm install          # Install all workspace dependencies
npm run build        # Build all packages
npm run dev          # Run dev for all packages (if present)
npm run lint         # Lint all packages
npm run test         # Test all packages
npm run typecheck    # Type-check all packages
```

### API Server (api/)
```bash
cd api
npm run dev          # Development with hot-reload (tsx watch)
npm run build        # Compile TypeScript
npm run start        # Run compiled code
npm run migrate      # Run database migrations
npm run seed         # Seed database
npm run lint         # ESLint
```

### Frontend (frontend/)
```bash
cd frontend
npm run dev          # Vite dev server
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # ESLint
```

### Infrastructure (Terraform)
```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform plan -var="domain_name=yourdomain.com"
terraform apply -var="domain_name=yourdomain.com"
```

## Architecture Overview

### Two Parallel Codebases

1. **Monorepo packages** (`packages/*`) - The original modular architecture:
   - `@workermill/core` - Orchestrator, TypeORM models, pluggable interfaces
   - `@workermill/api` - Express API (depends on core)
   - `@workermill/dashboard` - React dashboard (Vite, TanStack Query, Zustand)
   - `@workermill/cli` - Terminal monitoring (Commander, Chalk)
   - `@workermill/integrations` - AWS ECS/SQS adapters, GitHub integration

2. **Standalone services** (`api/`, `frontend/`) - Production-deployed code:
   - `api/` - Express API with Cognito auth, TypeORM, Winston logging
   - `frontend/` - React 19 with Vite, TailwindCSS, Zustand, React Hook Form

### Orchestrator Pattern (packages/core)

The `Orchestrator` class uses dependency injection with pluggable interfaces:
- `QueueProvider` - Message queue abstraction (SQS implementation in integrations)
- `ComputeProvider` - Container execution (ECS implementation in integrations)
- `TaskSource` - External task ingestion (Jira adapter)
- `ResultPublisher` - Output handling (GitHub PR creation)

Task flow: Queue message → Claim task → Check persona concurrency → Spawn container → Monitor completion → Parse output → Update status

### Key Models (packages/core/src/models)
- `AIWorkerTask` - Task state, cost tracking, git info
- `AIWorkerInstance` - Worker slot management per persona
- `AIWorkerTaskLog` - Event logging
- `AIWorkerApproval` - Human-in-the-loop gates

### Worker Directives (worker/directives/)
Role-specific instructions for AI workers: backend_developer, frontend_developer, devops_engineer, security_engineer, qa_engineer, tech_writer, project_manager. Common directives in `common/` (git workflow, testing, self-annealing).

## Infrastructure

AWS deployment via Terraform modules:
- **networking** - VPC, subnets, NAT
- **database** - RDS PostgreSQL
- **ecs-cluster/ecs-service** - Fargate containers
- **cdn** - CloudFront + S3 for frontend
- **secrets** - AWS Secrets Manager
- **dns** - Route53 + ACM

State stored in S3 (bootstrap first). Single `domain_name` variable required.

## Key Patterns

- Persona concurrency: Only 1 active task per persona type at a time
- Atomic task claiming via SQL UPDATE with status check
- Container output parsing uses `::result::`, `::pr_url::`, `::input_tokens::` markers
- Cost calculation from AI tokens + compute seconds
