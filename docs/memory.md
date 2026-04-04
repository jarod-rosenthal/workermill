# Memory System

WorkerMill maintains a persistent memory system that learns from every task execution. Workers build up knowledge about your codebase, team conventions, and what approaches work best.

## Memory Types

### Semantic Memory
Conceptual knowledge about code patterns, best practices, and domain expertise.

**Examples:**
- React component patterns for this codebase
- API authentication flow used in the project
- Database schema relationships
- Team coding conventions and preferences

**Fields:** Category, Subject, Knowledge, Confidence (0–100%), Repository

### Episodic Memory
Historical records of task executions, decisions made, and their outcomes.

**Examples:**
- Task PROJ-123 completed successfully with 2 retries
- PR #456 was rejected due to missing tests
- Deployment to staging failed — rollback executed
- Code review requested changes to error handling

**Fields:** Event Type, Summary, Outcome (success/failure/partial/escalated), Details

### Procedural Memory
Step-by-step procedures learned from successfully completed tasks. These become reusable [skills](/docs/skill-library).

**Examples:**
- Steps to add a new API endpoint in this codebase
- Database migration workflow for this project
- Frontend component creation pattern
- Testing approach for service layer

## How Memory Is Used

When a worker starts a task, WorkerMill:

1. **Retrieves relevant semantic memories** — codebase patterns, conventions, known issues
2. **Looks up episodic context** — past outcomes for similar tasks
3. **Fetches applicable procedures** — proven step-by-step approaches
4. **Injects into worker context** — the worker starts with institutional knowledge

This means workers improve over time. A team that has run 100 tasks has workers that understand the codebase far better than on day one.

## Memory Search

Memory uses **vector embeddings** (pgvector) for semantic similarity search. When a worker asks "how do we handle auth in this project?", it finds semantically similar memories even if they use different wording.

## Viewing Memory

Browse the memory system at **/memory** in the dashboard. You can:
- Search memories by content or category
- Filter by memory type
- See confidence scores and usage frequency
- Delete outdated or incorrect memories

## Memory Lifecycle

1. **Worker completes a task** — execution logs are analyzed
2. **Insights extracted** — patterns, conventions, and procedures identified
3. **Memories created** — stored with embeddings for future retrieval
4. **Confidence adjusted** — repeated confirmations increase confidence, contradictions decrease it

## Feedback Loop

Tech Lead Reviewer feedback is automatically captured as memory:
- "Don't use `any` type" → semantic memory about TypeScript conventions
- "Always write integration tests for API endpoints" → procedural memory
- "Use the existing `createError` helper" → semantic memory about codebase patterns

Over time, this creates a self-improving system where worker quality increases with each completed task.
