# Hooks & Custom Commands

Two ways to extend WorkerMill without touching its source:

- **Hooks** — shell commands or HTTP requests that run around tool calls and lifecycle events
- **Custom commands** (a.k.a. skills) — markdown files that become new slash commands

---

## Hooks

Hooks run code at specific points in the CLI's execution. Use them to:

- Run a formatter after every file write
- Block dangerous operations before they happen
- Notify Slack when `/ship` finishes
- Stream tool errors to your observability stack
- Run project-specific quality gates after the agent finishes

### Configuration

Hooks are configured in `~/.workermill/cli.json` under the `hooks` key. There's no `/settings` command for hooks — edit the file directly.

```json
{
  "hooks": {
    "pre": [ ],
    "post": [ ],
    "on": { }
  }
}
```

- **`pre`** — hooks that run *before* a tool call. Can block the call.
- **`post`** — hooks that run *after* a tool call completes (success or failure).
- **`on`** — lifecycle event hooks keyed by event name.

### Pre-tool hook

```json
{
  "hooks": {
    "pre": [
      {
        "command": "./scripts/audit-log.sh",
        "tools": ["write_file", "edit_file", "patch", "bash"]
      }
    ]
  }
}
```

The hook's `command` receives tool context via environment variables and runs before the tool executes. **A non-zero exit code blocks the tool call** and surfaces the hook's stderr back to the agent, which can then retry with different input.

### Post-tool hook

```json
{
  "hooks": {
    "post": [
      {
        "command": "npx prettier --write $WORKERMILL_TOOL_INPUT",
        "tools": ["write_file", "edit_file"]
      },
      {
        "command": "npm run typecheck",
        "tools": ["write_file", "edit_file", "patch"]
      }
    ]
  }
}
```

Post-hooks run after tool success or failure. Use them for:

- **Auto-formatting** written files (`prettier`, `black`, `rustfmt`)
- **Project quality gates** (`npm run typecheck`, `cargo check`, `go vet`)
- **Audit logging**
- **Notifications**

Non-zero exit codes from post-hooks are logged but don't abort further tool calls.

### Lifecycle hook

```json
{
  "hooks": {
    "on": {
      "ship_complete": [
        { "command": "say 'ship finished'" },
        { "command": "notify-send 'WorkerMill' 'Ship complete'" }
      ],
      "tool_error": [
        { "url": "https://your-webhook.example.com/workermill", "type": "http" }
      ],
      "session_end": [
        { "command": "./scripts/upload-session-log.sh" }
      ]
    }
  }
}
```

### Lifecycle events

| Event | When it fires |
|---|---|
| `session_start` | CLI session begins |
| `session_end` | CLI session ends |
| `ship_start` | `/ship` orchestration begins |
| `ship_complete` | `/ship` orchestration finishes (success or failure) |
| `review_complete` | Tech lead review finishes |
| `compact` | Context compaction triggered |
| `tool_error` | Any tool execution error |
| `permission_denied` | User denied a tool permission |
| `story_complete` | An individual `/ship` story finishes |
| `memory_saved` | A `::learning::` or `::remember::` marker was extracted |

### HTTP hooks

Use `type: "http"` and a `url` instead of a `command` to POST tool context as JSON to a webhook. Fire-and-forget — no retries, no blocking.

```json
{ "url": "https://example.com/workermill-webhook", "type": "http" }
```

The POST body includes tool input, output, success status, and event name where applicable.

### Environment variables in command hooks

| Variable | Set by | Contents |
|---|---|---|
| `WORKERMILL_TOOL_INPUT` | pre, post hooks | JSON-stringified tool input (truncated to 10KB) |
| `WORKERMILL_TOOL_OUTPUT` | post hooks only | Tool result string (truncated to 10KB) |
| `WORKERMILL_TOOL_SUCCESS` | post hooks only | `"true"` or `"false"` |
| `WORKERMILL_EVENT` | lifecycle hooks | Event name (e.g. `"ship_complete"`) |

Hooks run in the working directory at CLI launch, so you can use relative paths to project scripts.

### Tool filter

The `tools` field restricts a hook to specific tools. Omit it (or use `["*"]`) to run the hook for every tool:

```json
{ "command": "echo 'any tool called'", "tools": ["*"] }
```

### Viewing hooks

```
/hooks
```

Shows the currently configured hooks grouped by type (pre / post / lifecycle).

### Example: pre-commit-style quality gate

Run typecheck and lint after every write, block if they fail:

```json
{
  "hooks": {
    "post": [
      {
        "command": "npx tsc --noEmit && npx eslint $WORKERMILL_TOOL_INPUT",
        "tools": ["write_file", "edit_file", "patch"]
      }
    ]
  }
}
```

When the agent writes broken code, the hook reports the typecheck error. The agent sees the error in the next turn and fixes it.

### Example: Slack notification on ship complete

```json
{
  "hooks": {
    "on": {
      "ship_complete": [
        {
          "url": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
          "type": "http"
        }
      ]
    }
  }
}
```

---

## Custom Commands (Skills)

Custom commands are markdown files that become new slash commands. Drop a file in `.workermill/commands/deploy.md` and now `/deploy` is a command.

Use them for:

- **Project-specific workflows** — `/deploy`, `/test-integration`, `/migrate`
- **Repeated prompts** — `/summarize-pr`, `/extract-types`, `/refactor-to-hooks`
- **Team playbooks** — shared `.md` files committed to the repo so everyone gets the same commands

### File locations

Files are loaded from four locations with these source labels:

| Location | Scope |
|---|---|
| `.workermill/commands/*.md` | Project, team-wide (commit to repo) |
| `~/.workermill/commands/*.md` | User, every project |
| `.workermill/skills/*.md` | Project skills (alternative path) |
| `~/.workermill/skills/*.md` | User skills (alternative path) |

`commands` and `skills` are treated identically — use either directory name.

### File format

```markdown
---
name: deploy
description: Deploy to production
allowedTools: [bash, read_file]
model: anthropic/claude-sonnet-4-6
whenToUse: When the user wants to deploy the current branch to production
args: environment (staging|production)
---

Deploy the current branch using the deployment script.

1. Run `./scripts/pre-deploy-check.sh`
2. Push the current branch to origin
3. Run `./scripts/deploy.sh` with the environment argument
4. Tail the deployment logs and report status

If the pre-deploy check fails, do not proceed. Report the failure.
```

### Frontmatter fields

| Field | Required | Purpose |
|---|---|---|
| `name` | no (defaults to filename) | Command name — becomes `/<name>` |
| `description` | no | Shown in `/skills` and autocomplete |
| `allowedTools` | no | Array limiting which tools this command can call. Omit for all tools. |
| `model` | no | Override the active model for this command (e.g. `anthropic/claude-opus-4-6`) |
| `whenToUse` | no | Hint for when the agent should auto-invoke this skill. Surfaced in the system prompt. |
| `args` | no | Description of expected arguments, shown in `/skills` |

### Body

Everything after the closing `---` is the prompt. It's sent as the user message when the command is invoked. Write it like you're writing a clear instruction to the agent.

The command supports positional arguments: `/deploy production` passes `production` to the body (the agent sees it in context).

### Name collisions with built-ins

If a custom command shares a name with a built-in slash command (e.g. `help`, `ship`, `model`), the built-in wins. `/skills` warns when it detects a shadowed custom command — rename the file to resolve the conflict.

### Viewing custom commands

```
/skills
```

Shows all loaded custom commands, their source directory, descriptions, and any warnings about shadowed built-ins.

### Example: `/migrate`

`.workermill/commands/migrate.md`:

```markdown
---
name: migrate
description: Create and apply a database migration
allowedTools: [bash, read_file, write_file, edit_file, glob, grep]
args: migration name (e.g. "add_user_roles")
---

Create a new database migration and apply it.

1. Run `npm run migrate:create <migration-name>` to generate the migration file
2. Read the generated file and fill in the `up` and `down` methods based on the user's description
3. Run `npm run migrate:up` to apply it
4. Run the test suite to verify nothing broke: `npm test`
5. If tests fail, investigate and fix before reporting success
```

Now `/migrate add_user_roles` runs the full migration workflow.

### Example: `/review-pr`

`~/.workermill/commands/review-pr.md`:

```markdown
---
name: review-pr
description: Review a GitHub PR with security and quality focus
model: anthropic/claude-opus-4-6
allowedTools: [bash, read_file, glob, grep, fetch, web_search]
args: PR number or URL
---

Review the given PR thoroughly.

1. Fetch the PR diff with `gh pr view <pr> --json files,body,title`
2. Read every changed file in its full context (not just the diff)
3. Check for:
   - Security issues (auth, injection, data exposure, secret leakage)
   - Logic bugs
   - Missing error handling
   - Test coverage gaps
   - Breaking changes to public APIs
4. Score the PR 1-10 and list specific issues with file:line references
5. Suggest concrete fixes for each issue
```

This puts a high-powered review command in every project without needing to type the whole prompt each time.

---

## Choosing between hooks, custom commands, and personas

| Use case | Choose |
|---|---|
| "Run X whenever Y happens automatically" | **Hook** |
| "Add a new command I can type" | **Custom command** |
| "Give workers a specialist role with its own prompt and tool allowlist" | **Persona** |
| "Format code after every write" | **Hook** (post-hook on `write_file`) |
| "Add `/deploy` command to every project" | **Custom command** (user-level) |
| "Make the backend dev aware of our Drizzle schema conventions" | **Persona** (project-level override) |
| "Notify Slack on ship complete" | **Hook** (lifecycle on `ship_complete`) |
| "Repeat a complex prompt without retyping" | **Custom command** |
| "Block writes to certain paths" | **Permission rule** (see [Configuration](configuration.md#permissions)) |

Combine them: a project might have a custom `/deploy` command, a lifecycle hook for deploy notifications, and a custom `devops_engineer` persona with your infrastructure conventions baked in.
