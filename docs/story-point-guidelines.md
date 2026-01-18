# Story Point Guidelines for AI Worker Tasks

**Purpose:** Size Jira tickets appropriately for different Claude models to maximize accuracy and minimize context pollution.

---

## Executive Summary

Context window size (200K tokens) isn't the limiting factor — **context coherence** is. As models explore more files and make more decisions, accuracy degrades. Smaller, well-scoped tasks consistently outperform large, ambiguous ones.

| Model | Optimal Points | Max Files Modified | Max Files Read | Accuracy Target |
|-------|---------------|-------------------|----------------|-----------------|
| Haiku | 1-3 | 1-3 | 3-7 | 90%+ |
| Sonnet | 3-8 | 3-8 | 8-15 | 85%+ |
| Opus | 5-13 | 8-12 | 15-25 | 80%+ |

**Rule of thumb:** If a task exceeds 13 points, decompose it. Even Opus accuracy drops significantly on very large tasks.

---

## Context Coherence Degradation

### Why Accuracy Drops with Complexity

1. **Exploration noise** — Each file read adds context that may not be relevant
2. **Lost in the middle** — Details buried in long contexts get forgotten
3. **Decision fatigue** — More choices = more opportunities for wrong turns
4. **Error compounding** — One wrong decision pollutes subsequent reasoning

### Context Thresholds by Model

| Model | Coherent Context | Degraded Context | Failure Zone |
|-------|------------------|------------------|--------------|
| Haiku | 0-30K tokens | 30-50K tokens | 50K+ tokens |
| Sonnet | 0-60K tokens | 60-100K tokens | 100K+ tokens |
| Opus | 0-100K tokens | 100-150K tokens | 150K+ tokens |

**Implication:** A 5-point task that requires reading 20 files may push Haiku into failure zone, while Sonnet handles it comfortably.

---

## Model-Specific Guidelines

### Haiku (1-3 Story Points)

**Best for:** Fast, cheap, high-volume tasks with clear specifications.

**Ideal task characteristics:**
- Single file or 2-3 tightly related files
- Clear "do X in file Y" instructions
- Pattern already exists to follow
- No architectural decisions
- Minimal exploration required

**Example tickets:**

| Points | Description | Files |
|--------|-------------|-------|
| 1 | Add `createdBy` field to WorkerTask model | 1 model + 1 migration |
| 1 | Fix typo in error message at `auth.ts:45` | 1 file |
| 2 | Add `GET /api/health` endpoint returning `{ status: 'ok' }` | 1 route file |
| 2 | Add loading spinner to Dashboard during fetch | 1 component |
| 3 | Add email validation to user registration | 2-3 files (route, validation, test) |

**Ticket template for Haiku:**
```markdown
## Summary
[One sentence describing the change]

## Target Files
- `path/to/file.ts` (modify)
- `path/to/other.ts` (create)

## Pattern Reference
Follow the pattern in `path/to/example.ts:45-60`

## Acceptance Criteria
- [ ] Specific testable outcome 1
- [ ] Specific testable outcome 2

## Constraints
- DO NOT modify [specific files/systems]
- DO NOT add [out of scope features]
```

---

### Sonnet (3-8 Story Points)

**Best for:** Balanced performance on moderate complexity tasks.

**Ideal task characteristics:**
- Multi-file feature with defined boundaries
- Some decisions required, but bounded options
- May need to understand 1-2 existing patterns
- Clear acceptance criteria prevent scope creep
- Integration with existing systems

**Example tickets:**

| Points | Description | Files |
|--------|-------------|-------|
| 5 | Add rate limiting to webhook endpoints | 3-4 files (middleware, routes, config) |
| 5 | Implement task retry with exponential backoff | 3-5 files (orchestrator, model, migration) |
| 5 | Add filtering and pagination to task list API | 3-4 files (route, query builder, types) |
| 8 | Create settings page with form validation | 5-7 files (component, store, API, types) |
| 8 | Add Slack notification integration | 5-8 files (service, config, routes, UI) |

**Ticket template for Sonnet:**
```markdown
## Summary
[2-3 sentences describing the feature]

## User Story
As a [role], I want [capability], so that [benefit].

## Target Files
- `path/to/file.ts` (modify) - [what changes]
- `path/to/new.ts` (create) - [purpose]

## Reference Files (read for context)
- `path/to/pattern.ts` - [why relevant]

## Technical Approach
[Brief description of implementation approach]

## Acceptance Criteria
- [ ] Given X, when Y, then Z
- [ ] Error case handling
- [ ] Edge case coverage

## Out of Scope
- Feature A (separate ticket: XXX-123)
- Feature B (future consideration)
```

---

### Opus (8-13 Story Points)

**Best for:** Complex tasks requiring architectural judgment and cross-cutting changes.

**Ideal task characteristics:**
- Cross-cutting features touching multiple subsystems
- Architectural decisions required
- Multiple valid approaches, must evaluate tradeoffs
- Complex debugging with unknown root cause
- New patterns that will be reused

**Example tickets:**

| Points | Description | Files |
|--------|-------------|-------|
| 8 | Debug intermittent task failures in production | Unknown (investigation) |
| 8 | Add WebSocket support alongside existing SSE | 8-10 files |
| 13 | Implement multi-tenant billing with Stripe | 10-15 files |
| 13 | Refactor orchestrator for plugin architecture | 10-12 files |
| 13 | Add comprehensive audit logging system | 10-15 files |

**Ticket template for Opus:**
```markdown
## Summary
[Comprehensive description of the feature/problem]

## Background
[Context on why this is needed, what approaches were considered]

## User Story
As a [role], I want [capability], so that [benefit].

## Technical Requirements
1. Requirement with rationale
2. Requirement with rationale

## Architectural Considerations
- Option A: [description, tradeoffs]
- Option B: [description, tradeoffs]
- Recommended: [choice with justification]

## Affected Systems
- System A - [how affected]
- System B - [how affected]

## Acceptance Criteria
- [ ] Functional requirement
- [ ] Performance requirement
- [ ] Security requirement

## Dependencies
- Depends on: XXX-100 (must complete first)
- Blocks: XXX-200 (waiting on this)

## Risks
- Risk 1: [description, mitigation]
```

---

## Task Decomposition Rules

### When to Decompose

**Always decompose if:**
- Estimated >13 story points
- Touches >3 distinct subsystems
- Has multiple independent deliverables
- Contains both backend AND frontend work
- Requires sequential phases (research → implement → test)

### Decomposition Patterns

**Feature decomposition:**
```
❌ "Implement user authentication" (20+ pts)

✅ Break into:
- "Add JWT token generation/validation" (5 pts, Sonnet)
- "Add session middleware" (3 pts, Haiku)
- "Add login/logout API endpoints" (5 pts, Sonnet)
- "Add auth UI components" (5 pts, Sonnet)
- "Add password reset flow" (5 pts, Sonnet)
```

**Layer decomposition:**
```
❌ "Add task comments feature" (13+ pts)

✅ Break into:
- "Add Comment model and migration" (2 pts, Haiku)
- "Add comment CRUD API endpoints" (5 pts, Sonnet)
- "Add comment UI component" (5 pts, Sonnet)
- "Add real-time comment updates via SSE" (5 pts, Sonnet)
```

**Investigation + Fix:**
```
❌ "Fix intermittent failures" (unknown pts)

✅ Break into:
- "Investigate and document root cause of failures" (5 pts, Opus)
- "Implement fix for [specific cause]" (X pts, determined after investigation)
```

---

## Context Management Techniques

### 1. Explicit File Scoping

Always include in tickets:
```markdown
**Target Files:**
- api/src/routes/auth.ts (modify)
- api/src/middleware/jwt.ts (create)

**Reference Files (read-only):**
- api/src/middleware/auth.ts (existing auth pattern)
- api/src/routes/tasks.ts (route structure example)
```

### 2. Pattern Anchoring

Instead of: "Add validation"

Write: "Add validation following the pattern in `api/src/routes/settings.ts:45-60`"

### 3. Negative Constraints

Explicitly state what NOT to do:
```markdown
**Constraints:**
- DO NOT modify the existing auth middleware
- DO NOT add database indexes (separate ticket)
- DO NOT refactor existing code unless necessary for this feature
```

### 4. Acceptance Criteria as Guardrails

Each criterion should be:
- Testable (can verify pass/fail)
- Specific (no ambiguity)
- Bounded (doesn't invite scope creep)

```markdown
**Acceptance Criteria:**
- [ ] POST /api/auth/login returns JWT token in response body
- [ ] Token includes userId and orgId claims
- [ ] Token expires after 24 hours (configurable via env var)
- [ ] Invalid credentials return 401 with error message
- [ ] Rate limited to 5 attempts per minute per IP
```

---

## Accuracy Expectations

### Expected Success Rates

| Model | Points | First-Attempt Success | With Retry |
|-------|--------|----------------------|------------|
| Haiku | 1-2 | 95% | 99% |
| Haiku | 3 | 85% | 95% |
| Sonnet | 3-5 | 90% | 97% |
| Sonnet | 5-8 | 80% | 92% |
| Opus | 5-8 | 90% | 97% |
| Opus | 8-13 | 75% | 88% |
| Any | 13+ | <60% | <75% |

### Failure Modes by Model

**Haiku failures:**
- Gets confused by ambiguous requirements
- Misses edge cases not explicitly stated
- Doesn't recover well from wrong initial approach

**Sonnet failures:**
- Over-engineers simple solutions
- Sometimes misses existing patterns
- Can get stuck in refactoring spirals

**Opus failures:**
- Occasionally over-architects
- May propose changes beyond scope
- Higher latency can cause timeout issues

---

## Implementation Checklist

### For Ticket Authors

- [ ] Story points assigned based on guidelines
- [ ] Target files explicitly listed
- [ ] Reference files for patterns included
- [ ] Acceptance criteria are specific and testable
- [ ] Negative constraints ("DO NOT") included
- [ ] No single ticket exceeds 13 points
- [ ] Frontend/backend work separated if >5 points each

### For PRD Decomposition

- [ ] No story exceeds 8 points
- [ ] Each story targets ≤5 files to modify
- [ ] Dependencies between stories clearly mapped
- [ ] Stories can be executed by appropriate model tier
- [ ] Total PRD complexity matches sum of story estimates

### For Model Selection

- [ ] 1-3 points → Haiku (default)
- [ ] 3-8 points → Sonnet
- [ ] 8-13 points → Opus
- [ ] 13+ points → Decompose first

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                  STORY POINT QUICK GUIDE                    │
├─────────────────────────────────────────────────────────────┤
│  HAIKU (1-3 pts)                                            │
│  ✓ Single file changes    ✓ Clear instructions              │
│  ✓ Pattern exists         ✓ No decisions needed             │
│  ✗ Ambiguous scope        ✗ Multiple subsystems             │
├─────────────────────────────────────────────────────────────┤
│  SONNET (3-8 pts)                                           │
│  ✓ Multi-file features    ✓ Bounded decisions               │
│  ✓ Clear acceptance       ✓ Known patterns                  │
│  ✗ Architectural choices  ✗ Unknown scope                   │
├─────────────────────────────────────────────────────────────┤
│  OPUS (8-13 pts)                                            │
│  ✓ Cross-cutting changes  ✓ Architecture decisions          │
│  ✓ Complex debugging      ✓ New patterns                    │
│  ✗ Unbounded scope        ✗ >15 files                       │
├─────────────────────────────────────────────────────────────┤
│  DECOMPOSE (13+ pts)                                        │
│  → Break by feature/layer/phase                             │
│  → No single story >8 pts for PRDs                          │
│  → Always separate frontend/backend if large                │
└─────────────────────────────────────────────────────────────┘
```

---

## Appendix: Cost Considerations

| Model | Relative Cost | Speed | When to Use |
|-------|---------------|-------|-------------|
| Haiku | 1x (baseline) | Fastest | High volume, simple tasks |
| Sonnet | ~5x | Medium | Default for features |
| Opus | ~15x | Slowest | Complex/critical only |

**Cost optimization strategy:**
1. Default to Haiku for 1-3 point tasks
2. Use Sonnet for most feature work
3. Reserve Opus for genuinely complex tasks
4. Decompose large tasks to use cheaper models on sub-tasks
