# Specification Engineering

Specs are the highest-leverage artifact when building with AI coding agents. A well-structured spec drives everything downstream — decomposition, planning, and code quality.

## What is Specification Engineering?

Specification engineering is the practice of writing precise, structured specs that AI coding agents can reliably execute. A 10% better spec produces dramatically better decompositions, plans, and code. The spec is the input that drives everything else.

WorkerMill pioneered spec-driven development for AI agents. Instead of giving agents vague instructions and hoping for the best, you write a structured spec that eliminates ambiguity, pins constraints, and defines measurable success conditions. The result: agents build what you actually want, the first time.

> The industry is converging on spec-driven development. Addy Osmani has written extensively about the importance of detailed specs for AI coding. GitHub released Spec Kit for structured AI prompting. Thoughtworks identified Specification-Driven Development (SDD) as a key practice. WorkerMill builds this into the platform as a first-class workflow.

## The WorkerMill Spec Format

Every WorkerMill spec follows a standard template with 10 sections. Each section serves a specific purpose in guiding AI agents toward correct implementation.

| # | Section | Description |
|---|---------|-------------|
| 1 | **Overview** | Deliverables as a numbered list. What exactly will be built? |
| 2 | **Technical Specification** | Version constraints, pinned dependencies, runtime requirements |
| 3 | **Data Model** | Complete database schema with column types, constraints, and relations |
| 4 | **File Structure** | Exact directory layout showing every file to create or modify |
| 5 | **API Specification** | Endpoints with HTTP methods, request/response shapes, status codes |
| 6 | **Component Specification** | UI components with props, state, and behavior descriptions |
| 7 | **Quality Gates** | Lint, typecheck, test, and build commands that must pass |
| 8 | **Acceptance Criteria** | Measurable success conditions — binary pass/fail, no ambiguity |
| 9 | **Scope Boundary** | Explicit "DO NOT create" list to prevent scope creep |
| 10 | **Pre-Provisioned Infrastructure** | What already exists: databases, queues, services, credentials |

## Quality Scoring

WorkerMill scores every spec across 5 dimensions. The total score (0–100) determines whether the spec is ready for decomposition or needs improvement.

| Dimension | Weight | What It Measures |
|-----------|--------|-----------------|
| **Completeness** | 30% | Does the spec cover all sections? Data models, API shapes, file structure, acceptance criteria all present? |
| **Clarity** | 20% | Is every requirement unambiguous? Could two engineers build the same thing from this spec? |
| **Decomposability** | 20% | Can the spec be broken into independent stories that workers can execute in parallel? |
| **Constraints** | 15% | Are versions pinned, scope boundaries defined, and pre-existing infrastructure documented? |
| **Testability** | 15% | Can every acceptance criterion be verified by running a command or checking a condition? |

**Example Score Breakdown:**
```
Completeness (30%)     27 / 30
Clarity (20%)          18 / 20
Decomposability (20%)  16 / 20
Constraints (15%)      12 / 15
Testability (15%)      13 / 15
─────────────────────────────
Total                  86 / 100
```

Specs scoring ≥85 are automatically approved for decomposition. Below 85, the Spec Improver agent suggests targeted improvements.

## Writing Better Specs — Principles

### Pin dependency versions explicitly

**Weak:**
```
Use React and TypeScript with Tailwind CSS for styling.
```

**Strong:**
```
React 19.0.0, TypeScript 5.7.x, Tailwind CSS 4.0, Vite 6.x
```

### Define scope boundaries with "DO NOT" sections

```markdown
## Scope Boundary
DO NOT create:
- Authentication system (use existing auth middleware)
- Database migrations (schema already exists)
- CI/CD pipeline configuration
- Docker or deployment files
- Any npm packages not listed in Technical Specification
```

### Make acceptance criteria measurable

**Weak:**
- The page loads quickly
- Users can manage their data
- Error handling works properly

**Strong:**
- `GET /api/users` returns 200 with paginated results in < 200ms
- `POST /api/users` with valid body returns 201 with user object
- `POST /api/users` with missing `email` returns 422 with validation errors

### Document pre-existing infrastructure

Tell agents what already exists so they don't recreate it:

```markdown
## Pre-Provisioned Infrastructure
- PostgreSQL 16 running at localhost:5432, database: myapp_dev
- Redis 7 at localhost:6379 (used for session storage)
- S3 bucket: myapp-assets-dev (credentials in env: AWS_*)
- Existing auth middleware at src/middleware/auth.ts
```

## Spec Improver

WorkerMill includes an automated **Spec Improver** agent that:
- Analyzes your spec against the quality scoring dimensions
- Identifies missing sections and weak criteria
- Suggests specific improvements with examples
- Optionally rewrites sections to meet the quality threshold

The Spec Improver runs automatically when your spec scores below 85. You can also trigger it manually from the task planning screen.
