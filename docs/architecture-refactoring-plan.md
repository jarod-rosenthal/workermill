# WorkerMill Architecture Refactoring Plan

> **Status:** Draft
> **Created:** 2026-02-02
> **Author:** Claude Code Analysis

## Executive Summary

This plan outlines how to apply Clean Architecture, Hexagonal Architecture, and Domain-Driven Design patterns to the WorkerMill codebase using the **Strangler Fig Pattern** for incremental, low-risk migration.

### Current State vs Target

| Metric | Current | Target |
|--------|---------|--------|
| **orchestrator.ts** | 5,652 lines, 19+ dependencies | 6-8 focused use cases, <500 lines each |
| **Test Coverage** | ~5% (4 test files for 60 services) | 80%+ for extracted use cases |
| **Circular Dependencies** | 1 critical (orchestrator ↔ planning-agent) | 0 |
| **Route Handler Size** | 150-350 lines | 10-20 lines (thin controllers) |
| **Repository Abstraction** | 0 (768 direct getRepository calls) | Full repository pattern |

---

## Table of Contents

1. [Current Architecture Analysis](#current-architecture-analysis)
2. [Implementation Strategy](#implementation-strategy)
3. [Phase 1: Foundation](#phase-1-foundation-week-1-2)
4. [Phase 2: First Use Cases](#phase-2-extract-first-use-cases-week-2-3)
5. [Phase 3: Infrastructure Adapters](#phase-3-infrastructure-adapters-week-3-4)
6. [Phase 4: Decompose Orchestrator](#phase-4-decompose-orchestrator-week-4-6)
7. [Phase 5: Route Layer](#phase-5-route-layer-refactoring-week-6-7)
8. [Risk Assessment](#risk-assessment)
9. [Testing Strategy](#testing-strategy)
10. [Sacred Patterns](#sacred-patterns-do-not-change)

---

## Current Architecture Analysis

### Directory Structure

```
api/src/
├── models/           # TypeORM entities (ORM-coupled, not pure domain)
├── services/         # Business logic + infrastructure (mixed concerns)
├── routes/           # Heavy controllers with business logic
├── middleware/       # Auth, validation, error handling
├── config/           # Environment + secrets
├── providers/        # AI provider abstractions
├── scm-providers/    # Git provider abstractions
└── utils/            # Shared utilities
```

### Key Problems Identified

#### 1. Monolithic Orchestrator (5,652 lines)

The orchestrator handles 12+ distinct responsibilities:

| Responsibility | Lines | External Dependencies |
|---------------|-------|----------------------|
| Credentials Management | ~400 | AWS SecretsManager |
| Task Claiming | ~50 | PostgreSQL |
| Task Discovery | ~180 | PostgreSQL, Billing, Budget |
| Planning & Validation | ~800 | AI Agents, Jira |
| Multi-Story Dispatch | ~500 | PostgreSQL, SCM |
| Worker Spawning | ~400 | ECS, Credentials |
| Task Monitoring | ~750 | ECS, PostgreSQL |
| Manager Review | ~400 | ECS, Jira |
| Parent Task Consolidation | ~500 | PostgreSQL, SCM |
| Dependency Management | ~200 | PostgreSQL |
| Cleanup & Maintenance | ~400 | PostgreSQL, S3 |
| Main Polling Loop | ~230 | All above |

#### 2. Circular Dependency

```
orchestrator.ts → planning-agent.ts
         ↑                    ↓
         └────────────────────┘
```

- `orchestrator.ts` imports planning functions
- `planning-agent.ts` imports `enforceFileDependencies` from orchestrator

#### 3. No Repository Abstraction

- 768 direct `AppDataSource.getRepository()` calls
- Scattered across 42 files
- Makes unit testing nearly impossible

#### 4. Heavy Route Handlers

| Route File | Lines | Largest Handler |
|-----------|-------|-----------------|
| analytics.ts | 4,276 | 150+ lines |
| settings.ts | 4,475 | 100-200 lines |
| webhooks.ts | 3,797 | 200+ lines |
| control-center.ts | 2,279 | 200+ lines |

#### 5. Testing Gaps

- 4 test files for 60 services
- No mocks for external services (AWS, Stripe, AI providers)
- Tight coupling prevents unit testing

---

## Implementation Strategy

### Strangler Fig Pattern

Per [AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html) and [Microsoft Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig):

```
┌─────────────────────────────────────────────────────────┐
│                    FAÇADE LAYER                         │
│         (Routes remain unchanged initially)             │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Legacy    │  │   New Use   │  │   New Use   │
│ Orchestrator│  │   Cases     │  │   Cases     │
│  (shrinks)  │  │  (grows)    │  │  (grows)    │
└─────────────┘  └─────────────┘  └─────────────┘
```

**Key Principles:**
1. Start small and incrementally
2. Use façade/proxy layer for routing
3. Maintain parallel operation during transition
4. Freeze legacy features (new features in new architecture only)
5. Plan for decommissioning

### Target Architecture

```
api/src/
├── domain/
│   ├── entities/           # Pure domain models (no TypeORM)
│   │   ├── Task.ts
│   │   └── Organization.ts
│   ├── value-objects/
│   │   ├── TaskStatus.ts
│   │   └── Money.ts
│   └── interfaces/         # Ports (abstractions)
│       ├── ITaskRepository.ts
│       ├── IContainerRunner.ts
│       └── ITicketSystem.ts
│
├── use-cases/              # Application business rules
│   ├── ClaimTaskUseCase.ts
│   ├── SpawnWorkerUseCase.ts
│   └── MonitorTasksUseCase.ts
│
├── adapters/
│   ├── repositories/       # TypeORM implementations
│   │   └── TaskRepository.ts
│   ├── infrastructure/     # External service adapters
│   │   ├── EcsContainerRunnerAdapter.ts
│   │   └── AwsSecretsAdapter.ts
│   ├── external/           # Third-party API adapters
│   │   ├── JiraAdapter.ts
│   │   └── StripeAdapter.ts
│   └── presenters/         # Response formatters
│       └── TaskPresenter.ts
│
├── services/               # Coordinating services (thin)
│   └── orchestrator.ts     # Now ~200 lines, coordinates use cases
│
└── routes/                 # Thin controllers
    └── control-center.ts   # Now ~300 lines
```

---

## Phase 1: Foundation (Week 1-2)

### 1.1 Break Circular Dependency

**Problem:** `orchestrator.ts` ↔ `planning-agent.ts` circular import

**Solution:** Extract `enforceFileDependencies()` to new module

**Files:**
- Create: `api/src/services/planning-utils.ts`
- Modify: `orchestrator.ts`, `planning-agent.ts`

**Risk:** LOW - Pure extraction, no behavior change

| Pros | Cons |
|------|------|
| Eliminates circular import risk | One more file to maintain |
| Enables independent testing | Minimal |
| Required foundation for further work | |

### 1.2 Create Repository Interfaces

**Purpose:** Define contracts before implementations

**Files to Create:**
```typescript
// api/src/domain/interfaces/ITaskRepository.ts
export interface ITaskRepository {
  findById(id: string): Promise<WorkerTask | null>;
  findQueuedTasks(orgId: string): Promise<WorkerTask[]>;
  claimTask(taskId: string): Promise<boolean>;
  save(task: WorkerTask): Promise<WorkerTask>;
}

// api/src/domain/interfaces/IOrganizationRepository.ts
export interface IOrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  findByApiKey(apiKey: string): Promise<Organization | null>;
}
```

**Risk:** NONE - Additive only

### 1.3 Create First Repository Adapter

**File:** `api/src/adapters/repositories/TaskRepository.ts`

```typescript
export class TaskRepository implements ITaskRepository {
  constructor(private dataSource: DataSource) {}

  async findById(id: string): Promise<WorkerTask | null> {
    return this.dataSource.getRepository(WorkerTask).findOne({ where: { id } });
  }

  async claimTask(taskId: string): Promise<boolean> {
    // Atomic claim via UPDATE...WHERE (preserves existing pattern)
    const result = await this.dataSource
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ status: "claimed" })
      .where("id = :id AND status = :status", { id: taskId, status: "queued" })
      .execute();
    return result.affected === 1;
  }
}
```

**Risk:** LOW - Wrapper over existing behavior

---

## Phase 2: Extract First Use Cases (Week 2-3)

### 2.1 ValidateTaskStateTransitionUseCase

**Why First:** Pure business logic (95%), no external dependencies, highest testability

**Current Location:** `orchestrator.ts` lines 73-146

```typescript
// api/src/use-cases/ValidateTaskStateTransitionUseCase.ts
export class ValidateTaskStateTransitionUseCase {
  private static VALID_TRANSITIONS: Record<string, string[]> = {
    queued: ["claimed", "cancelled", "failed"],
    claimed: ["executing", "failed", "cancelled"],
    executing: ["completed", "failed", "review_requested", "deployed"],
    // ... 17 total states
  };

  execute(currentStatus: string, newStatus: string): ValidationResult {
    const validNext = this.VALID_TRANSITIONS[currentStatus];
    if (!validNext?.includes(newStatus)) {
      return { valid: false, reason: `Invalid transition: ${currentStatus} → ${newStatus}` };
    }
    return { valid: true };
  }
}
```

| Aspect | Details |
|--------|---------|
| Lines Moved | 120 |
| Risk | LOW |
| Test Coverage | 100% achievable |

### 2.2 ClaimTaskUseCase

**Why Second:** Critical path, pure database logic, well-defined contract

```typescript
// api/src/use-cases/ClaimTaskUseCase.ts
export class ClaimTaskUseCase {
  constructor(
    private taskRepository: ITaskRepository,
    private stateValidator: ValidateTaskStateTransitionUseCase
  ) {}

  async execute(taskId: string): Promise<ClaimResult> {
    const validation = this.stateValidator.execute("queued", "claimed");
    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }

    const claimed = await this.taskRepository.claimTask(taskId);
    return { success: claimed };
  }
}
```

| Aspect | Details |
|--------|---------|
| Dependencies | ITaskRepository, ValidateTaskStateTransitionUseCase |
| Risk | MEDIUM - Critical path |

### 2.3 FetchOrgCredentialsUseCase

**Why Third:** Isolates AWS SecretsManager coupling

```typescript
// api/src/use-cases/FetchOrgCredentialsUseCase.ts
export class FetchOrgCredentialsUseCase {
  constructor(
    private secretsAdapter: ISecretsManagerAdapter,
    private orgRepository: IOrganizationRepository,
    private cache: ICredentialsCache
  ) {}

  async execute(orgId: string): Promise<OrgCredentials> {
    // Check cache (5 min TTL)
    const cached = this.cache.get(orgId);
    if (cached && !this.cache.isExpired(orgId)) {
      return cached;
    }

    const org = await this.orgRepository.findById(orgId);
    const secrets = await this.secretsAdapter.getOrgSecrets(org);

    this.cache.set(orgId, secrets, 5 * 60 * 1000);
    return secrets;
  }
}
```

| Aspect | Details |
|--------|---------|
| Lines Moved | ~400 |
| New Interfaces | ISecretsManagerAdapter, ICredentialsCache |
| Risk | MEDIUM |

---

## Phase 3: Infrastructure Adapters (Week 3-4)

### 3.1 EcsContainerRunnerAdapter

**Purpose:** Abstract ECS behind interface (could swap to Kubernetes)

```typescript
// api/src/domain/interfaces/IContainerRunner.ts
export interface IContainerRunner {
  spawnWorker(task: WorkerTask, credentials: OrgCredentials): Promise<SpawnResult>;
  describeTask(taskArn: string): Promise<TaskDescription>;
  stopTask(taskArn: string): Promise<void>;
}

// api/src/adapters/infrastructure/EcsContainerRunnerAdapter.ts
export class EcsContainerRunnerAdapter implements IContainerRunner {
  constructor(private ecsClient: ECSClient) {}

  async spawnWorker(task: WorkerTask, credentials: OrgCredentials): Promise<SpawnResult> {
    // Move logic from ecs-task-runner.ts
  }
}
```

| Aspect | Details |
|--------|---------|
| Files to Deprecate | `ecs-task-runner.ts` (gradual) |
| Risk | HIGH - Critical infrastructure |

### 3.2 JiraAdapter

**Purpose:** Consolidate all Jira API calls

```typescript
// api/src/domain/interfaces/ITicketSystem.ts
export interface ITicketSystem {
  postComment(issueKey: string, comment: string): Promise<void>;
  createSubtask(parentKey: string, summary: string): Promise<string>;
  transitionIssue(issueKey: string, status: string): Promise<void>;
}

// api/src/adapters/external/JiraAdapter.ts
export class JiraAdapter implements ITicketSystem {
  // Consolidate from utils/jira.ts + inline calls
}
```

| Aspect | Details |
|--------|---------|
| Files to Consolidate | `utils/jira.ts` + inline calls |
| Risk | MEDIUM |

---

## Phase 4: Decompose Orchestrator (Week 4-6)

### Use Case Extraction Priority

| Use Case | Lines | Priority | Dependencies |
|----------|-------|----------|--------------|
| DiscoverEligibleTasksUseCase | 180 | HIGH | TaskRepo, Billing, Budget |
| SpawnWorkerUseCase | 400 | HIGH | ContainerRunner, Credentials |
| MonitorExecutingTasksUseCase | 750 | MEDIUM | ContainerRunner, TaskRepo |
| GenerateExecutionPlanUseCase | 800 | MEDIUM | PlanningAgent, CriticAgent |
| ConsolidateParentTaskUseCase | 500 | MEDIUM | TaskRepo, ScmProvider |
| UnblockDependentTasksUseCase | 200 | LOW | TaskRepo |
| CleanupStaleTasksUseCase | 400 | LOW | TaskRepo, S3Adapter |

### Final Orchestrator (After Refactoring)

```typescript
// api/src/services/orchestrator.ts (~200 lines)
export class Orchestrator {
  constructor(
    private discoverTasks: DiscoverEligibleTasksUseCase,
    private claimTask: ClaimTaskUseCase,
    private spawnWorker: SpawnWorkerUseCase,
    private monitorTasks: MonitorExecutingTasksUseCase,
    // ... other use cases injected
  ) {}

  async pollLoop(): Promise<void> {
    while (this.running) {
      const tasks = await this.discoverTasks.execute();
      for (const task of tasks) {
        const claimed = await this.claimTask.execute(task.id);
        if (claimed) {
          await this.spawnWorker.execute(task);
        }
      }
      await this.monitorTasks.execute();
      await this.sleep(5000);
    }
  }
}
```

**Result:** 5,652 lines → ~200 lines

---

## Phase 5: Route Layer Refactoring (Week 6-7)

### 5.1 Create Presenter Services

```typescript
// api/src/adapters/presenters/TaskPresenter.ts
export class TaskPresenter {
  static formatForDashboard(task: WorkerTask, enrichments: TaskEnrichments): TaskDTO {
    return {
      id: task.id,
      jiraIssueKey: task.jiraIssueKey,
      // ... 50+ fields with transformation logic
    };
  }

  static formatForList(task: WorkerTask): TaskListItemDTO {
    return { /* minimal fields */ };
  }
}
```

### 5.2 Thin Controller Pattern

**Before:**
```typescript
// control-center.ts - 350 lines per handler
router.get("/", authenticateRequest, async (req, res) => {
  // 350 lines of query, aggregation, formatting...
});
```

**After:**
```typescript
// control-center.ts - 10-20 lines per handler
router.get("/", authenticateRequest, asyncHandler(async (req, res) => {
  const useCase = container.resolve(GetControlCenterDashboardUseCase);
  const result = await useCase.execute(req.organization!);
  res.json(result);
}));
```

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1. Foundation | LOW | Additive only, no behavior changes |
| 2. First Use Cases | LOW-MEDIUM | Small extractions, high test coverage |
| 3. Infrastructure Adapters | HIGH | Extensive integration testing, feature flags |
| 4. Decompose Orchestrator | HIGH | Incremental, keep old code until verified |
| 5. Route Refactoring | MEDIUM | One route at a time |

---

## Testing Strategy

### Unit Tests (New)
- All use cases: 100% coverage target
- Presenters: 100% coverage
- Adapters: Mock external services

### Integration Tests (Enhanced)
- Repository adapters with real DB (transaction rollback)
- Use case chains with mocked adapters

### E2E Tests (Existing)
- Verify no regression in task lifecycle
- Dashboard functionality preserved

---

## Sacred Patterns (DO NOT CHANGE)

Per CLAUDE.md, these working patterns **must be preserved**:

| Pattern | Why Sacred | How We Preserve It |
|---------|------------|-------------------|
| Log streaming via PostgreSQL + SSE | Took a week to get working | Move to LogRepository, keep DB polling |
| Task orchestration via DB polling | Atomic claim via UPDATE...WHERE | Move to ClaimTaskUseCase, same SQL |
| Worker entrypoint `post_log()` | Real-time log delivery | No changes to worker side |
| LLM Models | No unauthorized changes | Credentials use case preserves model config |

---

## Success Metrics

| Metric | Before | After | Measurement |
|--------|--------|-------|-------------|
| Orchestrator Size | 5,652 lines | <500 lines | `wc -l orchestrator.ts` |
| Test Coverage | 5% | 80%+ | Vitest coverage report |
| Circular Dependencies | 1 | 0 | `madge --circular` |
| Average Route Handler | 200 lines | 20 lines | Code review |
| Time to Add New SCM | ~3 days | ~4 hours | Historical comparison |

---

## Timeline Summary

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1 | Foundation | Broken circular dep, repository interfaces |
| 2 | Foundation + Use Cases | TaskRepository, ValidateStateTransition, ClaimTask |
| 3 | Use Cases | FetchCredentials, DiscoverTasks |
| 4 | Adapters | EcsContainerRunner, JiraAdapter |
| 5 | Orchestrator | SpawnWorker, MonitorTasks use cases |
| 6 | Orchestrator | Remaining use cases, thin coordinator |
| 7 | Routes | Presenters, thin controllers |

---

## References

- [AWS Strangler Fig Pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html)
- [Microsoft Azure Strangler Fig](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)
- [Microservices.io Strangler Application](https://microservices.io/patterns/refactoring/strangler-application.html)
- [Clean Architecture by Robert C. Martin](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Hexagonal Architecture by Alistair Cockburn](https://alistair.cockburn.us/hexagonal-architecture/)

---

## Appendix: Detailed Analysis Reports

The following analysis was conducted to inform this plan:

1. **Orchestrator Decomposition Analysis** - Identified 12+ responsibilities, 19 external dependencies
2. **Model/Repository Pattern Analysis** - Found 768 direct getRepository calls across 42 files
3. **Testing Infrastructure Analysis** - 4 test files for 60 services, minimal mocking
4. **Service Dependency Mapping** - Identified circular dependency and coupling issues
5. **Route Layer Analysis** - Found 150-350 line handlers with embedded business logic
