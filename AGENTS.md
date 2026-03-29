# AGENTS.md

This file provides behavioral guidance for AI coding agents working in this repository. For codebase documentation, commands, and architecture details, see `CLAUDE.md`.

## Communication Style

**Be transparent and narrate your work.** Share what you're doing before starting, what you find during exploration, your reasoning on decisions, and summarize what was done after completing work.

**Parallelize your work whenever possible.** Run independent tasks concurrently - for example, build API while updating frontend, or deploy while writing tests. Use background tasks and parallel tool calls to maximize efficiency.

## Agent Workflow Guidelines

**Spawn parallel agents for cross-stack work.** This is a full-stack app where API, frontend, and infrastructure work can run concurrently.

| Task | Parallel Approach |
|------|-------------------|
| Add new API endpoint + UI | Agent 1: backend route, Agent 2: frontend page |
| Add new model + routes | Agent 1: TypeORM model + migration, Agent 2: API routes |
| Type checking | Run `npx tsc --noEmit` in api/ and frontend/ in parallel |

## Progress Tracking

For multi-phase implementations, track progress in a local progress file to enable resumption if interrupted.

## Task Prioritization

When working on tasks:

1. **Understand before acting** - Read relevant files before making changes
2. **Verify assumptions** - Check existing patterns in the codebase
3. **Small, focused changes** - Avoid over-engineering or scope creep
4. **Test your changes** - Run type checking (`npm run typecheck`) after modifications

## File Operation Preferences

- **Prefer editing over creating** - Modify existing files rather than creating new ones
- **No unnecessary files** - Don't create README, documentation, or config files unless explicitly requested
- **Follow existing patterns** - Match the code style and structure already in the codebase

## Jira Ticket Handling

When creating Jira tickets via MCP tools:

**NEVER add labels when creating tickets.** The `workermill` label triggers automatic AI worker deployment. Only add labels after the ticket is created and with explicit user approval.

Correct workflow:
1. Create ticket with NO labels
2. Show user the ticket
3. Ask "Ready to add the workermill label to trigger the worker?"
4. Only add label after explicit confirmation

## Deployment Awareness

After any deployment:
1. Verify the deployment succeeded
2. Mention the deployment in your summary
3. Provide the relevant URL for verification

## When to Ask vs. Proceed

**Ask first when:**
- Making architectural changes to proven patterns (see "DO NOT CHANGE" section in CLAUDE.md)
- Changing default models, AI providers, or model configurations
- Unsure about requirements or approach
- Task involves infrastructure or security changes

**Proceed when:**
- Task is clearly defined with specific requirements
- Following established patterns in the codebase
- Making routine code changes (bug fixes, features matching existing patterns)

## Error Handling

When encountering errors:

1. **Git Bash issues** - If commands fail with syntax errors involving `$(...)` or variable expansion, spawn a Task agent instead of debugging
2. **Build failures** - Check if the error is in your code or infrastructure; report infrastructure issues rather than attempting fixes

## References

- **Codebase documentation**: `CLAUDE.md`
- **Worker container instructions**: `worker/AGENTS.md`
