# WorkerMill CLI Documentation

Reference material, extension guides, and workflow recipes for the WorkerMill CLI.

If you're just getting started, read the [project README](../README.md) first — it covers installation, setup, and the core workflow. These docs go deeper on the things the README can't cover without becoming a wall of text.

## Reference

- **[Commands](commands.md)** — every slash command, subcommand, and flag. The lookup table.
- **[Configuration](configuration.md)** — every field in `~/.workermill/cli.json`, defaults, examples, and how to set them from inside the CLI.

## Extending the CLI

- **[Personas](personas.md)** — writing custom expert roles, overriding built-ins per project, tool restrictions, provider routing.
- **[Hooks & Custom Commands](hooks-and-skills.md)** — shell hooks around tool calls, lifecycle events, and custom slash commands (skills).

## Guides

- **[Quality Gates & Spec Check](quality-gates.md)** — output assertions that run after workers finish and before the reviewer sees the diff. Includes spec check (pre-planning ambiguity detection). Both are off by default.
- **[Recipes](recipes.md)** — concrete workflows combining features: mixed-provider teams, local-only setups, quality gates, custom personas, scheduled tasks.
- **[Troubleshooting](troubleshooting.md)** — common issues, diagnostics, and fixes.

## Internals

- **[Architecture](architecture.md)** — how the CLI is put together: execution modes, tool system, MCP, permission layers, compaction, safety.
- **[Contributing](contributing.md)** — dev setup, source layout, how to add commands / tools / personas, test conventions, release process.

## Reliability project recovery

- **[Current handoff](../HANDOFF.md)** — saved branch state, known failed checks, and the next bounded task.
- **[September 6 retrospective](recovery/2026-09-06-retrospective.md)** — incident evidence, completed and remaining work, and continuity safeguards.
