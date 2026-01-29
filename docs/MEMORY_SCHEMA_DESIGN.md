# Agent Memory Schema Design

**Date:** 2026-01-28
**Status:** Design Complete
**Database:** PostgreSQL with pgvector extension

---

## Memory Type Overview

The Agent Memory System uses three distinct memory types, each serving a different purpose in helping AI workers learn and improve:

| Memory Type | Purpose | Example |
|-------------|---------|---------|
| **Episodic** | Specific events/experiences | "Task #123 failed because the API endpoint was missing auth" |
| **Semantic** | General knowledge/facts | "This repository uses Jest for testing" |
| **Procedural** | How-to procedures/skills | "To add an API endpoint: 1. Create route file 2. Add validation 3. Register in index" |

---

## Schema Design

### 1. Episodic Memory

Episodic memories capture specific task experiences - what happened, what worked, what failed.

```sql
CREATE TABLE episodic_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Context: What task/repo was this about?
    task_id UUID REFERENCES worker_tasks(id) ON DELETE SET NULL,
    repository VARCHAR(255) NOT NULL,           -- e.g., "jarod-rosenthal/pagerduty-lite"

    -- The experience
    event_type VARCHAR(50) NOT NULL,            -- 'task_completed', 'task_failed', 'approach_worked', 'approach_failed'
    summary TEXT NOT NULL,                       -- Human-readable description
    details JSONB,                               -- Structured data (error messages, file paths, etc.)

    -- Outcome tracking
    outcome VARCHAR(20) NOT NULL,               -- 'success', 'failure', 'partial'
    outcome_details TEXT,                        -- Why it succeeded/failed

    -- Embedding for similarity search
    embedding vector(1536),                      -- OpenAI ada-002 or similar

    -- Metadata
    persona VARCHAR(50),                         -- Which persona created this memory
    model VARCHAR(100),                          -- Which model was used
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Retrieval tracking
    retrieval_count INTEGER DEFAULT 0,
    last_retrieved_at TIMESTAMP WITH TIME ZONE,
    effectiveness_score FLOAT                    -- How often retrieval led to success
);

-- Indexes
CREATE INDEX idx_episodic_org_repo ON episodic_memories(org_id, repository);
CREATE INDEX idx_episodic_event_type ON episodic_memories(event_type);
CREATE INDEX idx_episodic_outcome ON episodic_memories(outcome);
CREATE INDEX idx_episodic_embedding ON episodic_memories USING hnsw (embedding vector_cosine_ops);
```

**Example Records:**

```json
{
  "event_type": "approach_failed",
  "summary": "Attempted to use raw SQL for complex join, but TypeORM relations were already defined",
  "details": {
    "files_affected": ["src/services/analytics.ts"],
    "error": "Duplicate column names in result set",
    "correct_approach": "Use TypeORM QueryBuilder with relations"
  },
  "outcome": "failure",
  "outcome_details": "Had to rewrite using QueryBuilder after wasting 3 tool calls"
}
```

---

### 2. Semantic Memory

Semantic memories store general knowledge about repositories, patterns, and conventions.

```sql
CREATE TABLE semantic_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Scope: What does this knowledge apply to?
    repository VARCHAR(255),                     -- NULL = org-wide knowledge
    scope VARCHAR(50) NOT NULL,                  -- 'repository', 'organization', 'global'

    -- The knowledge
    category VARCHAR(50) NOT NULL,               -- 'convention', 'pattern', 'technology', 'structure', 'rule'
    subject VARCHAR(255) NOT NULL,               -- What is this about? e.g., "testing", "authentication", "error handling"
    knowledge TEXT NOT NULL,                     -- The actual knowledge

    -- Confidence
    confidence FLOAT DEFAULT 0.5,                -- 0-1, increases with validation
    source VARCHAR(50) NOT NULL,                 -- 'inferred', 'explicit', 'feedback', 'documentation'
    evidence_count INTEGER DEFAULT 1,            -- How many times this was confirmed

    -- Embedding for similarity search
    embedding vector(1536),

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_validated_at TIMESTAMP WITH TIME ZONE,

    -- Retrieval tracking
    retrieval_count INTEGER DEFAULT 0,
    last_retrieved_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_semantic_org_repo ON semantic_memories(org_id, repository);
CREATE INDEX idx_semantic_scope ON semantic_memories(scope);
CREATE INDEX idx_semantic_category ON semantic_memories(category);
CREATE INDEX idx_semantic_subject ON semantic_memories(subject);
CREATE INDEX idx_semantic_embedding ON semantic_memories USING hnsw (embedding vector_cosine_ops);

-- Unique constraint: one knowledge entry per subject per scope
CREATE UNIQUE INDEX idx_semantic_unique ON semantic_memories(org_id, COALESCE(repository, ''), scope, category, subject);
```

**Example Records:**

```json
{
  "scope": "repository",
  "repository": "jarod-rosenthal/pagerduty-lite",
  "category": "convention",
  "subject": "testing",
  "knowledge": "This repository uses Vitest for unit tests. Test files are co-located with source files using .test.ts suffix. Run tests with 'npm test'.",
  "confidence": 0.95,
  "source": "inferred",
  "evidence_count": 12
}
```

```json
{
  "scope": "repository",
  "repository": "jarod-rosenthal/pagerduty-lite",
  "category": "pattern",
  "subject": "error handling",
  "knowledge": "API errors should use the AppError class from src/utils/errors.ts. Always include error code, message, and HTTP status.",
  "confidence": 0.8,
  "source": "inferred",
  "evidence_count": 5
}
```

---

### 3. Procedural Memory

Procedural memories store reusable procedures (skills) extracted from successful tasks.

```sql
CREATE TABLE procedural_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Skill identification
    name VARCHAR(255) NOT NULL,                  -- Human-readable name, e.g., "Add REST API Endpoint"
    slug VARCHAR(255) NOT NULL,                  -- URL-safe identifier
    description TEXT NOT NULL,                   -- What this skill does

    -- Applicability
    repository VARCHAR(255),                     -- NULL = applies to any repo
    applicable_to JSONB,                         -- Conditions when this skill applies
    -- e.g., {"task_types": ["feature", "api"], "technologies": ["express", "typescript"]}

    -- The procedure
    steps JSONB NOT NULL,                        -- Ordered list of steps
    -- e.g., [{"step": 1, "action": "Create route file", "details": "..."}, ...]

    prerequisites JSONB,                         -- What must be true before using this skill
    -- e.g., {"files_must_exist": ["src/routes/index.ts"], "dependencies": ["express"]}

    -- Source tracking
    source_task_id UUID REFERENCES worker_tasks(id) ON DELETE SET NULL,
    extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Quality metrics
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    success_rate FLOAT GENERATED ALWAYS AS (
        CASE WHEN (success_count + failure_count) > 0
        THEN success_count::FLOAT / (success_count + failure_count)
        ELSE NULL END
    ) STORED,

    -- Embedding for similarity search
    embedding vector(1536),

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Retrieval tracking
    retrieval_count INTEGER DEFAULT 0,
    last_retrieved_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_procedural_org_repo ON procedural_memories(org_id, repository);
CREATE INDEX idx_procedural_slug ON procedural_memories(org_id, slug);
CREATE INDEX idx_procedural_success_rate ON procedural_memories(success_rate DESC NULLS LAST);
CREATE INDEX idx_procedural_embedding ON procedural_memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_procedural_applicable ON procedural_memories USING gin (applicable_to);

-- Unique slug per org
CREATE UNIQUE INDEX idx_procedural_unique_slug ON procedural_memories(org_id, slug);
```

**Example Record:**

```json
{
  "name": "Add REST API Endpoint",
  "slug": "add-rest-api-endpoint",
  "description": "Procedure for adding a new REST API endpoint to an Express/TypeScript backend",
  "applicable_to": {
    "task_types": ["feature", "api"],
    "technologies": ["express", "typescript"],
    "keywords": ["endpoint", "route", "api", "rest"]
  },
  "steps": [
    {
      "step": 1,
      "action": "Create route file",
      "details": "Create src/routes/{resource}.ts with Express Router",
      "example": "import { Router } from 'express'; const router = Router();"
    },
    {
      "step": 2,
      "action": "Add validation",
      "details": "Use express-validator for request validation",
      "example": "body('name').isString().notEmpty()"
    },
    {
      "step": 3,
      "action": "Implement handler",
      "details": "Create async handler with try/catch and proper error responses"
    },
    {
      "step": 4,
      "action": "Register route",
      "details": "Import and use router in src/routes/index.ts"
    },
    {
      "step": 5,
      "action": "Add tests",
      "details": "Create src/routes/{resource}.test.ts with request/response tests"
    }
  ],
  "prerequisites": {
    "files_must_exist": ["src/routes/index.ts", "src/app.ts"],
    "dependencies": ["express", "express-validator"]
  },
  "success_count": 15,
  "failure_count": 2
}
```

---

## Supporting Tables

### Memory Retrieval Log

Track when memories are retrieved to measure effectiveness.

```sql
CREATE TABLE memory_retrieval_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- What was retrieved
    memory_type VARCHAR(20) NOT NULL,            -- 'episodic', 'semantic', 'procedural'
    memory_id UUID NOT NULL,

    -- Context
    task_id UUID REFERENCES worker_tasks(id) ON DELETE SET NULL,
    query_embedding vector(1536),                -- What query triggered this retrieval
    similarity_score FLOAT,                      -- How similar was the match

    -- Outcome (filled in after task completes)
    was_helpful BOOLEAN,                         -- Did this memory help?
    task_outcome VARCHAR(20),                    -- 'success', 'failure', 'partial'

    retrieved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_retrieval_memory ON memory_retrieval_log(memory_type, memory_id);
CREATE INDEX idx_retrieval_task ON memory_retrieval_log(task_id);
CREATE INDEX idx_retrieval_time ON memory_retrieval_log(retrieved_at DESC);
```

### Memory Feedback

Capture explicit feedback on memories (from PR reviews, user corrections).

```sql
CREATE TABLE memory_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Target memory
    memory_type VARCHAR(20) NOT NULL,
    memory_id UUID NOT NULL,

    -- Feedback
    feedback_type VARCHAR(20) NOT NULL,          -- 'correction', 'validation', 'deprecation'
    feedback_source VARCHAR(50) NOT NULL,        -- 'pr_review', 'user', 'task_outcome'
    details TEXT,

    -- Who provided feedback
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    task_id UUID REFERENCES worker_tasks(id) ON DELETE SET NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_feedback_memory ON memory_feedback(memory_type, memory_id);
```

---

## TypeORM Entity Summary

| Entity | Table | Description |
|--------|-------|-------------|
| `EpisodicMemory` | `episodic_memories` | Task-specific experiences |
| `SemanticMemory` | `semantic_memories` | General knowledge and conventions |
| `ProceduralMemory` | `procedural_memories` | Reusable skills/procedures |
| `MemoryRetrievalLog` | `memory_retrieval_log` | Retrieval tracking for analytics |
| `MemoryFeedback` | `memory_feedback` | Corrections and validations |

---

## Embedding Strategy

| Content Type | Embedding Input |
|--------------|-----------------|
| Episodic | `{event_type}: {summary}` |
| Semantic | `{category} - {subject}: {knowledge}` |
| Procedural | `{name}: {description}. Steps: {step summaries}` |

**Model:** OpenAI `text-embedding-3-small` (1536 dimensions, cost-effective)

**Alternative:** Anthropic embeddings when available, or local models via Ollama for cost reduction.

---

## Query Patterns

### Find similar past experiences
```sql
SELECT * FROM episodic_memories
WHERE org_id = $1
  AND repository = $2
  AND embedding <=> $3 < 0.5
ORDER BY embedding <=> $3
LIMIT 5;
```

### Get repository conventions
```sql
SELECT * FROM semantic_memories
WHERE org_id = $1
  AND (repository = $2 OR repository IS NULL)
  AND category = 'convention'
ORDER BY confidence DESC;
```

### Find applicable skills
```sql
SELECT * FROM procedural_memories
WHERE org_id = $1
  AND (repository = $2 OR repository IS NULL)
  AND embedding <=> $3 < 0.4
  AND (success_rate IS NULL OR success_rate > 0.6)
ORDER BY success_rate DESC NULLS LAST, embedding <=> $3
LIMIT 3;
```

---

## Migration Sequence

1. Enable pgvector extension
2. Create `episodic_memories` table
3. Create `semantic_memories` table
4. Create `procedural_memories` table
5. Create `memory_retrieval_log` table
6. Create `memory_feedback` table
7. Create HNSW indexes for vector search
