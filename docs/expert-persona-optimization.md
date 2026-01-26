# Expert Persona Optimization

This document describes the persona system architecture, optimizations implemented, and future improvements.

## Persona System Overview

WorkerMill has **three parallel persona definitions** that evolved independently:

| Location | Purpose | Count |
|----------|---------|-------|
| `api/src/models/WorkerTask.ts` | `WorkerPersona` TypeScript type for API validation | 14 |
| `worker/directives/{persona}/` | Markdown files with rich guidance (400-600 lines each) | 17 folders |
| `worker/epic/experts.ts` | `EXPERT_CONFIGS` for Epic multi-agent mode | 13 |

### Why This Matters

- **Maintenance burden**: Adding a persona requires changes in 3 places
- **Inconsistency risk**: Persona names can drift between systems
- **Type errors**: Planning agent might assign a persona that doesn't exist in TypeScript

### Current Personas (Unified List)

| Persona | API Type | Directive | Epic Expert |
|---------|----------|-----------|-------------|
| `frontend_developer` | ✅ | ✅ | ✅ |
| `backend_developer` | ✅ | ✅ | ✅ |
| `devops_engineer` | ✅ | ✅ | ✅ |
| `security_engineer` | ✅ | ✅ | ✅ |
| `qa_engineer` | ✅ | ✅ | ✅ |
| `tech_writer` | ✅ | ✅ | ✅ |
| `project_manager` | ✅ | ✅ | ❌ |
| `tech_lead` | ✅ | ✅ | ✅ |
| `api_developer` | ✅ | ✅ | ✅ |
| `data_engineer` | ✅ | ✅ | ✅ |
| `database_administrator` | ✅ | ✅ | ✅ |
| `ml_engineer` | ✅ | ✅ | ✅ |
| `mobile_developer_ios` | ✅ | ✅ | ✅ |
| `mobile_developer_android` | ✅ | ✅ | ✅ |
| `manager` | ❌ | ✅ | ❌ |

## Optimizations Implemented

### 1. TypeScript Type Sync (January 2025)

**Problem**: API only recognized 7 personas, but directives had 17.

**Solution**: Added 7 new personas to `WorkerPersona` type:
- `tech_lead`
- `api_developer`
- `data_engineer`
- `database_administrator`
- `ml_engineer`
- `mobile_developer_ios`
- `mobile_developer_android`

**Files changed**:
- `api/src/models/WorkerTask.ts` - Added to type union
- `api/src/services/persona-inference.ts` - Added keywords, labels, display names

### 2. Directive Loading in Epic Mode

**Problem**: Epic experts had shallow prompts (~50-100 lines) while V1 directives had rich guidance (400-600 lines).

**Solution**: Epic executor now loads directive files and injects them into expert system prompts.

**How it works**:
```typescript
// In executor.ts
async function loadDirective(persona: ExpertPersona): Promise<string> {
  const directivePath = `/app/directives/${persona}/README.md`;
  // ... load and return content
}

// Injected into system prompt as "## Domain Expertise" section
```

**Files changed**:
- `worker/epic/executor.ts` - Added `loadDirective()` and `buildEnrichedSystemPrompt()`

### 3. Lazy Coordination Loading

**Problem**: 40+ line coordination instructions were injected into every expert's prompt, even for single-story tasks.

**Solution**: Only inject coordination instructions when `totalStories > 1`.

**Token savings**: ~1K tokens per single-story Epic task

**How it works**:
```typescript
// In executor.ts
if (totalStories > 1) {
  prompt += COORDINATION_INSTRUCTIONS;
} else {
  console.log(`[Epic] Skipping coordination instructions for single-story task`);
}
```

**Files changed**:
- `worker/epic/experts.ts` - Exported `COORDINATION_INSTRUCTIONS`, removed from individual prompts
- `worker/epic/executor.ts` - Conditionally injects coordination
- `worker/epic/coordinator.ts` - Tracks `totalStories` and passes to executor

## Prompt Architecture (Current)

Epic mode now uses a layered prompt architecture:

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Core Identity (~20 lines)                      │
│ "You are a senior backend developer..."                 │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Domain Expertise (~400 lines)                  │
│ Loaded from directives/{persona}/README.md              │
│ API patterns, validation rules, error handling...       │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Coordination Protocol (~40 lines)              │
│ Only for multi-story Epics                              │
│ Decision posting, question routing, sibling context...  │
├─────────────────────────────────────────────────────────┤
│ Layer 4: Story-Specific Context                         │
│ Constraints, sibling decisions, pending questions...    │
└─────────────────────────────────────────────────────────┘
```

## Future Improvements

### Medium Term

| Improvement | Effort | Benefit |
|-------------|--------|---------|
| **Unified persona registry** | 1 day | Single source of truth, derive types automatically |
| **Tool differentiation** | 4 hours | QA can't write prod code, tech_writer has no shell |
| **Task-specific directives** | 2 hours | Load `fix_bug.md` when task contains "bug" |

### Strategic

| Improvement | Effort | Benefit |
|-------------|--------|---------|
| **Persona performance tracking** | 2-3 days | Data-driven persona selection |
| **Dynamic persona selection** | 1 week+ | ML-based assignment from task content |

### Unified Registry Design (Proposed)

```typescript
// Single source of truth
const PERSONA_REGISTRY = {
  backend_developer: {
    id: "backend_developer",
    displayName: "Backend Developer",
    shortLabels: ["backend", "api", "server"],
    specialties: ["api", "database", "auth", "validation"],
    directivePath: "backend_developer/README.md",
    tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
    riskLevel: "standard",
  },
  // ...
};

// Derive types from registry
type WorkerPersona = keyof typeof PERSONA_REGISTRY;
```

### Tool Differentiation (Proposed)

| Persona | Tools | Rationale |
|---------|-------|-----------|
| `backend_developer` | Read, Write, Edit, Bash, Grep, Glob | Full development access |
| `frontend_developer` | Read, Write, Edit, Bash, Grep, Glob | Full development access |
| `qa_engineer` | Read, Bash, Grep, Glob | Can run tests, can't modify production code |
| `tech_writer` | Read, Write, Edit, Glob | Docs only, no shell access |
| `security_engineer` | Read, Grep, Glob, Bash | Audit access, limited writes |
| `tech_lead` | Read, Grep, Glob | Review only, no modifications |

## Related Files

- `api/src/models/WorkerTask.ts` - `WorkerPersona` type definition
- `api/src/services/persona-inference.ts` - Persona detection from Jira tickets
- `worker/directives/` - Rich guidance markdown files
- `worker/epic/experts.ts` - Epic expert configurations
- `worker/epic/executor.ts` - Story execution with directive loading
- `worker/epic/coordinator.ts` - Multi-agent coordination loop
