# Skill Library

> **Beta** — This feature is in active development.

The Skill Library stores reusable procedures learned from successful task completions. When workers encounter similar problems, they can retrieve proven solutions instead of starting from scratch.

## How Skills Work

Skills are procedural memories — step-by-step instructions extracted from successfully completed tasks. When a worker finishes a task, the system analyzes the execution and captures the procedure as a reusable skill.

### Skill Lifecycle

1. **Task Completes Successfully** — Worker finishes a task with all tests passing
2. **Procedure Extracted** — System analyzes execution and extracts key steps
3. **Skill Created** — Steps, prerequisites, and metadata stored in library
4. **Future Retrieval** — Workers query library for similar tasks, apply proven procedures

## Skill Anatomy

Each skill contains:

- **Name** — Descriptive identifier (e.g., "Add REST endpoint with TypeORM")
- **Trigger Pattern** — What types of tasks should use this skill
- **Prerequisites** — What must be true before applying
- **Steps** — Ordered, concrete implementation steps
- **Verification** — How to confirm the skill was applied correctly
- **Source Task** — The task execution this was learned from
- **Success Rate** — How often this skill leads to task completion

## Skill Retrieval

When a worker starts a task, it queries the Skill Library using semantic similarity:

1. Worker task description is embedded
2. Library is searched for similar successful procedures
3. Top matches are ranked by similarity + success rate
4. Relevant skills are injected into worker context

## Viewing the Library

Browse skills at **/skill-library** in the dashboard. You can:
- Search skills by name or description
- Filter by persona, language, or framework
- See usage count and success rate
- Edit or delete skills
- Manually create skills from scratch

## Creating Skills Manually

You can author skills directly without waiting for automatic extraction:

1. Go to **Settings → Skill Library**
2. Click **New Skill**
3. Write the procedure in structured markdown
4. Tag with relevant personas and contexts
5. Save and activate

Manual skills are especially useful for:
- Onboarding new workers to team conventions
- Capturing one-time migration procedures
- Encoding security-critical processes

## Skill Health

The library tracks skill effectiveness over time:

- **High confidence** (≥80% success rate) — Shown to workers automatically
- **Medium confidence** (50–79%) — Shown with a confidence note
- **Low confidence** (<50%) — Flagged for review or deletion
- **Deprecated** — Manually marked as no longer applicable
