# Spec Engineering — Design Document

> **Date:** 2026-02-27
> **Status:** Approved
> **Goal:** Make specifications a first-class entity in WorkerMill — stored, versioned, scored, with org-level templates and governance. Position WorkerMill as the spec-driven development platform.

---

## Problem

WorkerMill has world-class execution but no specification engineering. Today the flow is: **paste PRD text → decompose → board → execute**. The spec is treated as throwaway input — no storage, no validation, no quality feedback, no org standards.

This is the highest-leverage gap in the platform. A 10% better spec produces dramatically better decompositions, plans, and code. Yet users get zero help writing specs.

Industry consensus (Addy Osmani, GitHub Spec Kit, Thoughtworks SDD, OpenSpec) confirms: the spec is the anchor artifact that should drive everything downstream.

## Solution

Spec Engineering as a first-class product feature:

1. **Spec as entity** — stored, versioned, scoreable, linked to boards
2. **Quality scoring** — 5-dimension AI evaluation with actionable feedback
3. **Org standards** — templates, required sections, quality gates
4. **Spec → Board lineage** — every board traces back to its source spec
5. **Public documentation** — methodology guide at workermill.com/docs

---

## Data Model

### KbSpec

```
KbSpec
├── id (uuid, PK)
├── organizationId (FK → Organization)
├── title (varchar)
├── content (text — full spec markdown)
├── status: draft | validated | decomposed | archived
├── qualityScore (int 0-100, nullable — null until scored)
├── qualityFeedback (JSONB — structured scoring breakdown)
├── templateId (FK → KbSpecTemplate, nullable)
├── version (int, auto-increment per spec)
├── createdBy (FK → User)
├── boardId (FK → KbBoard, nullable — set after decomposition)
├── metadata (JSONB — tech stack, repo URL, etc.)
├── createdAt (timestamp)
├── updatedAt (timestamp)
```

### KbSpecTemplate

```
KbSpecTemplate
├── id (uuid, PK)
├── organizationId (FK → Organization)
├── name (varchar — "SaaS Web App", "API Service", etc.)
├── description (text)
├── content (text — template markdown with placeholders)
├── requiredSections (JSONB — ["scope_boundary", "version_constraints", ...])
├── isDefault (boolean — org default template)
├── isPublic (boolean — visible to all orgs as starter)
├── createdAt (timestamp)
├── updatedAt (timestamp)
```

### KbSpecVersion

```
KbSpecVersion
├── id (uuid, PK)
├── specId (FK → KbSpec)
├── content (text — snapshot)
├── qualityScore (int, nullable)
├── version (int)
├── createdAt (timestamp)
```

### Org-Level Settings (new columns on Organization)

- `specMinQualityScore` (int, default 0) — minimum score before decomposition allowed
- `specRequiredSections` (JSONB, default null) — org-wide required sections

### Board Lineage (new column on KbBoard)

- `specId` (FK → KbSpec, nullable) — which spec produced this board

---

## Quality Scoring

### Dimensions (weighted, total = 100)

| Dimension | Weight | Measures |
|-----------|--------|----------|
| **Completeness** | 30 | Required sections present: scope boundary, version constraints, acceptance criteria, file structure |
| **Clarity** | 20 | Intent unambiguous, requirements testable, no vague language |
| **Decomposability** | 20 | Can be broken into independent stories, dependencies explicit |
| **Constraints** | 15 | Version pinning, tech stack specificity, "DO NOT" sections, scope boundaries |
| **Testability** | 15 | Acceptance criteria measurable, quality gates defined |

### Scoring Flow

1. User writes/pastes spec → clicks "Score"
2. API sends spec + rubric to LLM (Claude) via system prompt
3. LLM returns structured JSON: per-dimension score + specific suggestions
4. Stored in `qualityFeedback` JSONB, aggregate in `qualityScore`
5. UI shows radar chart + actionable suggestions per dimension

### Example Feedback

```json
{
  "overall": 72,
  "dimensions": {
    "completeness": {
      "score": 80,
      "feedback": "Missing scope boundary section. Add explicit 'DO NOT create' list."
    },
    "clarity": {
      "score": 65,
      "feedback": "Story 3 uses vague language: 'nice responsive design'. Specify breakpoints."
    },
    "decomposability": {
      "score": 85,
      "feedback": "Stories are well-isolated. Consider explicit dependency ordering."
    },
    "constraints": {
      "score": 60,
      "feedback": "No version constraints for dependencies. Pin major versions."
    },
    "testability": {
      "score": 70,
      "feedback": "Acceptance criteria present but 2 of 5 are not measurable."
    }
  },
  "suggestions": [
    "Add a '## Scope Boundary' section listing what workers should NOT create",
    "Pin dependency versions in a JSON block (see CalMill CM-1 as reference)",
    "Change 'nice responsive design' to specific breakpoints: mobile (<640px), tablet (640-1024px), desktop (>1024px)"
  ]
}
```

### Org Quality Gate

If `specMinQualityScore` is set (e.g., 70), decomposition is blocked until the spec scores above the threshold. UI shows the gap and prioritized suggestions to close it.

---

## User Flow & UI

### Navigation

New top-level nav item "Specs" alongside "Boards":

```
Sidebar:
  Boards      ← existing
  Specs       ← NEW
  Settings
```

### Specs List Page (`/specs`)

- Table of all specs in the org
- Columns: Title, Status (draft/validated/decomposed), Quality Score (color-coded), Template, Created By, Board (link if decomposed), Date
- Actions: New Spec, Import Spec
- Filters: status, template, score range

### Spec Editor Page (`/specs/:specId`)

- **Left panel**: Markdown editor with spec content
- **Right panel**: Quality feedback — radar chart + per-dimension scores + suggestions
- **Top bar**: Title, status badge, "Score" button, "Decompose" button (gated by quality score)
- **Template selector**: When creating new spec, pick from org templates or start blank
- **Version history**: Sidebar tab showing previous versions with diff view

### New Spec Flow

1. Click "New Spec" → choose template or blank
2. Template pre-fills sections with placeholders and guidance comments
3. Write/paste spec content
4. Click "Score" → quality score appears on right panel with suggestions
5. Iterate: edit spec → re-score → see score improve
6. When score meets org threshold (or no threshold set) → "Decompose" button activates
7. Click "Decompose" → creates board, links spec → board, status becomes "decomposed"
8. Board page shows "Source Spec: [link]" at the top

### Decompose Integration

The existing `POST /api/prd/decompose` endpoint is enhanced:
- Accepts `specId` parameter (existing raw text still works for backward compatibility)
- If `specId` provided: reads spec content, validates quality gate, creates board with `specId` linkage
- Board creation sets `KbBoard.specId`

---

## API Routes

### Specs CRUD

```
GET    /api/specs                    — List specs (org-scoped, filterable)
POST   /api/specs                    — Create spec (from template or blank)
GET    /api/specs/:specId            — Get spec detail + latest score
PUT    /api/specs/:specId            — Update spec content (creates version)
DELETE /api/specs/:specId            — Archive spec (soft delete)
```

### Scoring

```
POST   /api/specs/:specId/score      — Run quality scoring (async)
GET    /api/specs/:specId/score      — Get latest quality score + feedback
```

### Templates

```
GET    /api/spec-templates           — List templates (org + public)
POST   /api/spec-templates           — Create org template (admin only)
PUT    /api/spec-templates/:id       — Update template
DELETE /api/spec-templates/:id       — Delete template
```

### Version History

```
GET    /api/specs/:specId/versions   — List version history
GET    /api/specs/:specId/versions/:v — Get specific version
```

### Decompose Integration

```
POST   /api/prd/decompose            — Enhanced: accepts specId param
```

---

## Built-in Templates (Starters)

| Template | Use Case | Key Sections |
|----------|----------|-------------|
| **SaaS Web App** | Full-stack Next.js/React app | DB schema, API routes, components, auth, deployment |
| **API Service** | Backend API (Express, FastAPI, Go) | Endpoints, data models, auth, error handling, CI |
| **CLI Tool** | Command-line application | Commands, flags, config, installation, testing |
| **Mobile App** | React Native / Flutter | Screens, navigation, state, native APIs, store deploy |

Each template includes required sections with placeholder text and guidance comments.

### Required Sections (Standard Template)

Based on analysis of CalMill, TeamBoard, ShipAPI, and TaskPulse showcase specs, the standard template includes:

1. **Overview** — High-level deliverables (what this spec produces)
2. **Technical Specification** — Version constraints, pinned dependencies
3. **Data Model** — Database schema (Prisma, SQL, etc.)
4. **Architecture** — File structure, patterns, conventions
5. **API Specification** — Endpoints with request/response shapes
6. **Component Specification** — UI components with props/behavior
7. **Quality Gates** — Lint, typecheck, test commands
8. **Acceptance Criteria** — Measurable success conditions
9. **Scope Boundary** — Explicit "DO NOT create" list
10. **Pre-Provisioned Infrastructure** — What already exists (repos, hosting, DNS, etc.)

---

## Documentation Page

New public docs page at `/docs/specifications` covering:

1. **What is specification engineering** — Why specs matter for AI coding agents
2. **The WorkerMill spec format** — Section template with showcase examples
3. **Quality scoring** — The 5 dimensions and how to improve each
4. **Org standards** — Setting templates and quality gates
5. **Before/after examples** — Weak spec vs. strong spec, side by side
6. **Spec engineering principles**:
   - Pin versions explicitly
   - Define scope boundaries ("DO NOT" sections)
   - Make acceptance criteria measurable
   - Include file structure
   - Specify quality gates upfront

---

## Industry References

- [Addy Osmani — How to write a good spec for AI agents](https://addyosmani.com/blog/good-spec/)
- [GitHub Spec Kit — spec-driven development toolkit](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)
- [Thoughtworks — Spec-driven development: one of 2025's key new practices](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices)
- [OpenSpec — lightweight spec-driven framework](https://github.com/Fission-AI/OpenSpec)
- [The New Stack — Spec-Driven Development for scalable AI agents](https://thenewstack.io/spec-driven-development-the-key-to-scalable-ai-agents/)

---

## Existing Showcase Spec Analysis

WorkerMill's existing showcase specs (CalMill CM-1 through CM-7, TeamBoard TB-7-11, TaskPulse TP-1-5, ShipAPI) already demonstrate many spec engineering best practices:

**Strengths:**
- Comprehensive scope boundaries ("DO NOT create" sections)
- Version pinning with exact dependency versions
- Incremental epics building on prior deliverables
- Persona assignment per story
- Complete data models inline (Prisma schemas)
- File tree specifications
- Quality gate definitions

**Gaps (compared to industry best practices):**
- No formal scoring or quality metrics
- No template standardization across projects
- No org-level governance
- Specs exist as static markdown files, not interactive artifacts
- No version history or diff tracking
- No lineage from spec → board → execution results

This feature closes those gaps by making specs interactive, scoreable, and governed.
