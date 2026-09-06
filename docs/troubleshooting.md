# Troubleshooting

## Setup

### `wm doctor` — start here

Run this first for any setup issue. It checks Node.js version, Git, the config file, provider credentials, and local model availability.

```bash
wm doctor
```

### "No configuration found"

You haven't run setup. Just launch the CLI — it will walk you through provider setup automatically on first run.

```bash
npx workermill
```

### Provider not found / API key missing

Cloud providers need their API key in an environment variable or in `~/.workermill/cli.json`. Set one with:

```
/settings key anthropic sk-ant-...
/settings key openai sk-...
/settings key google ...
/settings key xai xai-...
/settings key groq gsk_...
/settings key deepseek sk-...
/settings key mistral ...
```

The setting saves to `~/.workermill/cli.json` and also populates `process.env` for the current session.

### Ollama not detected

The CLI auto-detects Ollama at `http://localhost:11434`. If you're on WSL, it also checks the Windows host IP. To point at a custom host:

```
/settings ollama.host http://your-host:11434
```

Make sure Ollama is running (`ollama ps`) and at least one model is pulled (`ollama pull qwen3-coder:30b`).

### LM Studio not detected

LM Studio is auto-detected at `http://localhost:1234`. Make sure the local server is running (LM Studio app → Developer tab → Start Server).

## Runtime

### Tool call asks for permission on every use

The default permission mode allows ordinary read tools and asks before other actions. Options:

- Press `Shift+Tab` to cycle to `acceptEdits` — auto-approves file edits but still prompts for dangerous commands
- Choose "Yes, don't ask again" to save an allow rule; shell commands use a command-family rule, not blanket shell access. If saving fails, the rule remains session-only
- View and edit rules with `/permissions`

### "Permission denied" for a tool you expected to work

Check your rules with `/permissions`. Deny rules override allow rules. Remove a stale rule by editing `~/.workermill/cli.json` under the `permissions` key.

### Conversation feels slow, responses lag

Context window is probably full. Run `/compact` to compress history, or `/clear` to reset. Micro-compaction runs automatically at ~60% context usage, but you can force it manually.

### Cost shows `<$0.01` or `$0.00`

- These displays summarize estimated cost from recorded usage and pricing, not your provider's invoice.
- A zero display is not proof that no billable work occurred. Check the recorded token usage and selected provider/model; missing usage or incomplete pricing can make the estimate incomplete.
- Local execution can have no per-token API charge while still using paid hardware, electricity, or hosting.

### `/build` plan is "0 stories"

The planner wrote text analysis but didn't output a JSON stories block. The CLI attempts a one-shot JSON extraction retry automatically. If that still fails, try:

- Tightening the ticket requirements (clearer acceptance criteria)
- Switching planner model to a stronger one: `/settings route planner anthropic` then `/model planner anthropic/claude-opus-4-6`
- Enabling the plan critic: `/settings review.critic true` (scores the plan and refines it until it passes — see [Quality Gates](quality-gates.md#planner-critic))

### Model switching fails

Check that the provider has an API key set and the model ID matches what the provider actually serves. The `/model` autocomplete only shows models in the curated registry — for a custom model, pass the full `provider/model` string and make sure the provider entry exists in your config.

### MCP tools not loading

`/mcp` lists configured servers; configuration alone does not prove a connection is healthy. Run-owned connections close when that run settles. If a server cannot connect during a prompt, check the error and its stderr in `~/.workermill/logs/`. For Docker Desktop's auto-detected MCP gateway, make sure Docker Desktop is running and has at least one MCP server enabled.

### Anthropic rejects tools with `input_schema.type: Field required`

Some MCP servers return tool schemas without the required `type` field. The CLI patches this automatically, so rebuild/update to the latest version.

## Git & PR

### "no upstream branch" when pushing

The CLI stays on the feature branch after `/build` so you can review. Push manually:

```bash
git push -u origin $(git branch --show-current)
```

Or use `gh pr create` to open a PR directly.

### `gh` not found

GitHub CLI is optional but needed for automatic PR creation. Install from [cli.github.com](https://cli.github.com/) and run `gh auth login`.

## Logs & Diagnostics

### Where are the logs?

```
~/.workermill/logs/<session-id>/cli.log
```

View recent entries with `/log` inside the CLI, or tail the file directly.

### `/status` — what's active right now

Shows message count, token usage, current model, cost, permission mode, and working directory.

### `/cost` — detailed cost breakdown

Per-role, per-provider breakdown of input/output tokens and estimated cost.

## Getting Help

1. Run `wm doctor` and include the output in your report
2. Check [GitHub Issues](https://github.com/jarod-rosenthal/workermill/issues) for similar problems
3. Open an issue with:
   - `wm doctor` output
   - OS and Node version
   - Steps to reproduce
   - Relevant log excerpt from `~/.workermill/logs/`
