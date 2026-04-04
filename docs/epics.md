# Epics & Stories

Organize large features into a board of tasks that WorkerMill executes in dependency order. Access at `/boards`.

## What are Epics?

An epic is a board of related tasks (cards) that together deliver a larger feature. Instead of creating one massive task, break it into smaller cards that workers can execute independently.

- **Board** — The overall feature or initiative
- **Cards** — Individual tasks within the board
- **Execution** — Cards run in dependency order, building on each other

## Creating an Epic

1. Navigate to `/boards` from the sidebar
2. Click **New Board** — fill in the board name, key (e.g., `AUTH`), description, and target repository
3. Click into the board and **Add Cards** for each task

## The Epic Board

Each epic has a Kanban-style board with customizable columns:

```
BACKLOG → READY → IN PROGRESS → REVIEW → DONE
```

Drag stories between columns to change their status. The board auto-updates as workers progress.

## Defining Stories

Well-defined stories lead to better worker output. Include as much context as helpful:

| Field | Required | Description |
|-------|----------|-------------|
| Title | ✓ | Brief description of the story |
| User Story | — | As a [role], I want [feature], so that [benefit] |
| Acceptance Criteria | — | Gherkin format: Given/When/Then conditions |
| Definition of Done | — | Checklist items that must be completed |
| Technical Notes | — | Implementation hints for the worker |
| Persona | — | Which worker type should handle this (backend, frontend, etc.) |
| Model | — | AI model to use (default from settings) |
| Labels | — | Additional configuration labels |

## User Story Format

Use the standard user story format:

```
As a [user role],
I want [feature/capability],
So that [benefit/value].
```

**Example:**
```
As a logged-in user,
I want to reset my password from settings,
So that I can regain access if I forget it.
```

## Story Statuses

| Status | Description |
|--------|-------------|
| Draft | Story being defined, not ready for execution |
| Ready | Story is fully defined and ready to run |
| Queued | Story queued for worker execution |
| Executing | Worker actively working on story |
| Review | PR created, waiting for review |
| Completed | Story done, PR merged |
| Failed | Execution failed, needs attention |

## Running an Epic

Once stories are defined and marked as "Ready":

1. **Click "Run All"** — Workers start executing cards in dependency order
2. **Monitor Progress** — Watch cards move through the board
3. **Review PRs** — Approve or request changes on generated PRs
4. **Handle Failures** — Edit and retry any failed cards

> **Tip:** Cards execute in dependency order by default. Each card can build on the previous one's changes.

## Epic Settings

Configure epic-wide settings at `/boards/:id/settings`:

- **Target Repository** — Which GitHub/GitLab repo to work on
- **Default Persona** — Default worker type for stories
- **Default Model** — Default AI model for stories
- **Board Columns** — Customize the Kanban columns
- **WIP Limits** — Set work-in-progress limits per column

## Best Practices

- **Keep stories small** — Each story should be completable in one worker session
- **Order stories logically** — Foundation first, features second
- **Include acceptance criteria** — Clear pass/fail conditions help workers
- **Add technical notes** — Point workers to relevant files or patterns
- **Review before running** — Ensure all stories are well-defined
