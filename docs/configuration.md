# Configuration Reference

Complete reference for `~/.workermill/cli.json`. Every field, what it does, and how to set it from inside the CLI with `/settings`.

The CLI loads config from two locations and merges them:

- **Global:** `~/.workermill/cli.json` (home directory)
- **Project:** `.workermill/config.json` (working directory, overrides global)

Both files are plain JSON. The CLI writes the global file when you run `/settings <key> <value>`, so you rarely need to edit it by hand.

## Top-level schema

```json
{
  "providers": { },
  "default": "anthropic",
  "routing": { },
  "review": { },
  "qualityGates": [ ],
  "permissions": { },
  "hooks": { },
  "mcp": { },
  "sandbox": true,
  "bell": false,
  "ticketSystem": "github",
  "jira": { },
  "linear": { }
}
```

Every field except `providers` and `default` is optional.

## `providers`

Map of provider ID → provider config. This is where API keys and model defaults live.

```json
"providers": {
  "anthropic": {
    "model": "claude-sonnet-4-6",
    "apiKey": "{env:ANTHROPIC_API_KEY}"
  },
  "openai": {
    "model": "gpt-5.4",
    "apiKey": "sk-..."
  },
  "ollama": {
    "model": "qwen3-coder:30b",
    "host": "http://localhost:11434",
    "contextLength": 65536
  },
  "xai": {
    "model": "grok-code-fast-1",
    "apiKey": "{env:XAI_API_KEY}"
  }
}
```

### Per-provider fields

| Field | Type | Purpose |
|---|---|---|
| `model` | string | Default model ID for this provider |
| `apiKey` | string | Literal key, or `{env:VAR_NAME}` to read from an environment variable |
| `host` | string | Override base URL (used by Ollama, LM Studio, and OpenAI-compatible endpoints) |
| `contextLength` | number | Context window size in tokens — for Ollama this sets `num_ctx` |

### Built-in provider IDs

`anthropic`, `openai`, `google`, `ollama`, `lmstudio`, `xai`, `groq`, `deepseek`, `mistral`, `openrouter`, `bedrock`, `azure`.

### Setting from the CLI

```
/settings key anthropic sk-ant-...
/settings key xai xai-...
/model anthropic/claude-opus-4-6
/settings ollama.host http://192.168.1.10:11434
/settings ollama.context 131072
```

`/settings key` also populates `process.env` for the current session, so you don't need to restart.

## `default`

The provider ID used when no persona routing is specified. Set by `/model <provider>/<model>` (switches both the default and the model), or directly with a config edit.

```json
"default": "anthropic"
```

## `routing`

Per-persona provider routing. Any persona not listed falls back to `default`.

```json
"routing": {
  "planner": "anthropic",
  "tech_lead": "openai",
  "backend_developer": "ollama",
  "frontend_developer": "ollama",
  "security_engineer": "anthropic"
}
```

The `planner` and `tech_lead` keys control the planner and reviewer roles in `/build`. Other keys route `/as <persona>` invocations.

### Setting from the CLI

```
/settings route planner anthropic
/settings route tech_lead openai
/settings route backend_developer ollama
```

The referenced provider must already exist in `providers`. Add one with `/settings key <provider> <key>` first if needed.

## `review`

Controls the `/build` review pipeline.

```json
"review": {
  "enabled": true,
  "maxRevisions": 3,
  "approvalThreshold": 9,
  "autoRevise": false,
  "useCritic": false,
  "criticThreshold": 8,
  "specCheck": false,
  "verifyEnabled": false
}
```

| Field | Default | Purpose |
|---|---|---|
| `enabled` | `true` | Run tech lead review after workers finish. Set to `false` to skip review entirely. |
| `maxRevisions` | `3` | Max review → revise cycles before giving up |
| `approvalThreshold` | `9` | Review score (1-10) at or above which the code is approved |
| `autoRevise` | `false` | Automatically send failed reviews back for revision without prompting the user |
| `useCritic` | `false` | Run a planning critic before execution — scores the plan 1-10 and refines it before workers start |
| `criticThreshold` | `8` | Plan score (1-10) at or above which the critic approves the plan |
| `specCheck` | `false` | Before planning: identifies up to 3 high-severity ambiguities in your task description and prompts you to answer them. Answers are appended to the spec before the planner runs. In unattended mode, suggestions are applied silently. |
| `verifyEnabled` | `false` | After workers finish: instructs the planner to generate `verificationCommands` per story — shell commands that assert observable output before the tech lead reviewer sees the diff. Gate failures are injected into the reviewer's context as must-fix items. |

### Setting from the CLI

```
/settings review.enabled true
/settings review.maxRevisions 5
/settings review.threshold 8
/settings review.autoRevise true
/settings review.critic true
/settings review.criticThreshold 8
```

`specCheck` and `verifyEnabled` are not yet exposed via `/settings` — set them directly in `.workermill/config.json`:

```json
{
  "review": {
    "specCheck": true,
    "verifyEnabled": true
  }
}
```

See [Quality Gates & Spec Check](quality-gates.md) for full documentation, examples, and guidance on writing effective verification commands.

## `qualityGates`

Static shell commands that run on every `/build`, after all stories complete and before the tech lead reviewer sees the diff. Use these for project-wide invariants — things that must always hold regardless of what was built.

**Off by default.** Add to `.workermill/config.json` to enable:

```json
{
  "qualityGates": [
    {
      "name": "app starts",
      "commands": ["timeout 5 node dist/index.js --help > /dev/null"]
    },
    {
      "name": "config schema valid",
      "commands": ["node dist/index.js config validate --config config/defaults.json"]
    }
  ]
}
```

| Field | Purpose |
|---|---|
| `name` | Label shown in the TUI and injected into the reviewer's context |
| `commands` | Shell commands run sequentially — first non-zero exit marks the gate as failed |

All gates run in parallel. A gate fails on the first command that exits non-zero.

**Do not use for:** `npm test`, `tsc`, `pytest`, `go build` — workers already run these. Use quality gates for black-box assertions on the *built artifact*, not the build process itself.

See [Quality Gates & Spec Check](quality-gates.md) for examples across Node, Python, Go, and Ruby.

## `permissions`

Pattern-based tool allow/ask/deny rules. These apply on top of the permission mode (`default`, `acceptEdits`, `plan`, `bypassPermissions`) cycled with `Shift+Tab`.

```json
"permissions": {
  "allow": [
    "bash(git *)",
    "bash(npm test)",
    "read_file(*)",
    "glob(*)",
    "ls(*)"
  ],
  "ask": [
    "bash(curl *)"
  ],
  "deny": [
    "bash(rm -rf *)",
    "write_file(.env)",
    "write_file(.ssh/*)",
    "bash(git push --force*)"
  ]
}
```

### Pattern syntax

Each pattern is `<tool_name>(<argument_pattern>)`. The argument pattern supports `*` as a wildcard. For `bash` tool calls, the argument is the command string; for file tools, it's the file path.

### Evaluation order

1. **`deny`** — if any deny rule matches, the tool is blocked (always wins)
2. **`ask`** — force a prompt even in `acceptEdits` mode
3. **`allow`** — skip the prompt entirely

### Setting from the CLI

```
/permissions allow bash(git *)
/permissions deny bash(rm *)
/permissions reset
```

Or when a prompt appears during a tool call, choose **"Yes, don't ask again"** to save a permanent allow rule.

## `hooks`

Shell commands or HTTP requests that run around tool calls and lifecycle events. Edit `~/.workermill/cli.json` directly — there's no `/settings` command for hooks.

```json
"hooks": {
  "pre": [
    {
      "command": "echo '[hook] about to write' $WORKERMILL_TOOL_INPUT",
      "tools": ["write_file", "edit_file", "patch"]
    }
  ],
  "post": [
    {
      "command": "npx prettier --write $WORKERMILL_TOOL_INPUT",
      "tools": ["write_file", "edit_file"]
    },
    {
      "command": "npm run typecheck",
      "tools": ["write_file", "edit_file", "patch"]
    }
  ],
  "on": {
    "ship_complete": [
      { "command": "say 'build finished'" }
    ],
    "tool_error": [
      { "url": "https://your-webhook.example.com/workermill", "type": "http" }
    ]
  }
}
```

### Hook types

**Command hook** — runs a shell command. Non-zero exit code from a pre-hook **blocks** the tool call.

```json
{ "command": "shell command here", "tools": ["tool_name"] }
```

**HTTP hook** — POSTs JSON to a URL. Fire-and-forget.

```json
{ "url": "https://example.com/webhook", "type": "http", "tools": ["*"] }
```

### Environment variables available to command hooks

| Variable | When set | Contents |
|---|---|---|
| `WORKERMILL_TOOL_INPUT` | pre, post | JSON-stringified tool input (truncated to 10KB) |
| `WORKERMILL_TOOL_OUTPUT` | post only | Tool result (truncated to 10KB) |
| `WORKERMILL_TOOL_SUCCESS` | post only | `true` or `false` |
| `WORKERMILL_EVENT` | lifecycle | Event name (e.g. `ship_complete`) |

### `tools` filter

Set to an array of tool names to restrict a hook to specific tools, or `["*"]` for all tools. Omit the field for the same effect as `["*"]`.

### Lifecycle events

Attach hooks to `hooks.on.<event>`:

| Event | Fires when |
|---|---|
| `session_start` | CLI session begins |
| `session_end` | CLI session ends |
| `ship_start` | `/build` orchestration begins |
| `ship_complete` | `/build` finishes (success or failure) |
| `review_complete` | Tech lead review finishes |
| `compact` | Context compaction triggered |
| `tool_error` | Any tool execution error |
| `permission_denied` | User denied a tool permission |
| `story_complete` | An individual `/build` story finishes |
| `memory_saved` | A `::learning::` or `::remember::` marker was extracted |

### Viewing configured hooks

```
/hooks
```

## `mcp`

MCP (Model Context Protocol) server configuration. Each entry spawns a server process and registers its tools.

```json
"mcp": {
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
  },
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
  }
}
```

| Field | Purpose |
|---|---|
| `command` | Binary or command to spawn |
| `args` | Arguments passed to the command |
| `env` | Extra environment variables for the server process |

Tools from MCP servers appear as `mcp__<server>__<tool>`. Docker Desktop's MCP gateway is auto-detected if installed — no config needed.

### Viewing MCP status

```
/mcp
```

## `sandbox`

File and bash tool sandboxing.

| Value | Effect |
|---|---|
| `true` (default) | Restrict file and bash tools to the working directory |
| `false` | No restriction — tools can read and write anywhere |
| `"os"` | OS-level sandboxing via `@anthropic-ai/sandbox-runtime` (where supported) |

### Setting from the CLI

```
/settings sandbox true
/settings sandbox false
```

## `bell`

Play a terminal bell and desktop notification when `/build` completes or fails, and on auto-compaction. Default `false`.

```
/settings bell true
```

## `ticketSystem`, `jira`, `linear`

Configures which issue tracker `/build <ticket-ref>` fetches from.

```json
"ticketSystem": "github"
```

Options: `"github"` (default, uses `gh` CLI), `"jira"`, `"linear"`, `"none"`.

### Jira credentials

```json
"ticketSystem": "jira",
"jira": {
  "baseUrl": "https://yourteam.atlassian.net",
  "email": "you@company.com",
  "apiToken": "..."
}
```

### Linear credentials

```json
"ticketSystem": "linear",
"linear": {
  "apiKey": "..."
}
```

### Setting from the CLI

```
/settings tickets jira
/settings jira.url https://yourteam.atlassian.net
/settings jira.email you@company.com
/settings jira.token <api-token>

/settings tickets linear
/settings linear.key <api-key>
```

## Environment variables

The CLI reads API keys from these environment variables if not set in config:

| Provider | Variable |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` |
| xAI | `XAI_API_KEY` |
| Groq | `GROQ_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |

In config, use `{env:VAR_NAME}` syntax to reference them without embedding the actual key:

```json
"apiKey": "{env:ANTHROPIC_API_KEY}"
```

## Project config overrides

A project-local `.workermill/config.json` overrides the global config for fields you specify. Useful for pinning a project to specific models or stricter permissions:

```json
{
  "default": "ollama",
  "routing": {
    "planner": "anthropic"
  },
  "permissions": {
    "deny": ["bash(docker *)"]
  },
  "review": {
    "approvalThreshold": 10
  }
}
```

The project file is merged with the global config — unspecified fields fall through to global values.

## Generating Configuration Schema

The `wm schema` command generates a JSON Schema for `~/.workermill/cli.json` based on the runtime Zod schema definition. This provides programmatic validation and editor support for your configuration files.

### Usage

```bash
# Print schema to stdout
wm schema

# Write schema to a file
wm schema --out .workermill.schema.json

# Combine with jq for schema inspection
wm schema | jq '.properties.ticketSystem.enum'
```

### Schema Metadata

The generated schema includes stable metadata for versioning and identification:

```json
{
  "$id": "https://workermill.com/schema/cli-config-v1.json",
  "version": "1.0.0",
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

- **`$id`**: Unique identifier that tooling can use to cache or reference the schema
- **`version`**: Schema version for compatibility tracking
- **Output is deterministic**: Running the command multiple times produces identical output, enabling snapshot testing in CI

### Editor Validation (VS Code)

To enable IntelliSense and validation in VS Code:

1. Generate the schema:
   ```bash
   wm schema > ~/.workermill/schema/cli-config.schema.json
   ```

2. Add a `.vscode/settings.json` to your project or global VS Code settings:
   ```json
   {
     "json.schemas": [
       {
         "fileMatch": ["~/.workermill/cli.json", ".workermill/config.json"],
         "url": "file://~/.workermill/schema/cli-config.schema.json"
       }
     ]
   }
   ```

3. Reload VS Code. You now get autocomplete, type validation, and hover documentation when editing config files.

### CI Validation

Validate your config files before committing:

```bash
# Using ajv (npm install ajv ajv-cli)
wm schema | ajv validate --spec draft7 --stdin-code -- ajv-cli stdin:config.json

# Or with node
node -e "
  const Ajv = require('ajv');
  const ajv = new Ajv();
  const schema = $(wm schema);
  const config = $(cat ~/.workermill/cli.json);
  const validate = ajv.compile(schema);
  const valid = validate(config);
  if (!valid) {
    console.error(validate.errors);
    process.exit(1);
  }
"
```

### Use Cases

- **Editor validation** — Get autocomplete and type checking when editing `cli.json`
- **CI validation** — Catch malformed configs before they break your workflow
- **Schema evolution** — Pin to `cli-config-v1.json` in automation scripts to detect breaking changes
- **Tooling integration** — Feed the schema to config editors, linters, or migration tools

### What the Schema Covers

The schema describes the **global CLI config** (`~/.workermill/cli.json`):

- All top-level properties (`providers`, `default`, `routing`, `review`, etc.)
- Required vs optional fields
- Enum constraints (e.g., `ticketSystem` values: `"github"`, `"jira"`, `"linear"`, `"none"`)
- Nested object structures
- Type constraints (strings, booleans, arrays, objects)

**Note:** The schema is generated from the Zod runtime definition, so it always matches the current CLI implementation. It does not cover project-local `.workermill/config.json` specific fields beyond what's already in the global schema.

## Where to find your config

```bash
cat ~/.workermill/cli.json              # Global config
cat .workermill/config.json             # Project overrides (if present)
ls ~/.workermill/                       # All CLI state (config, logs, sessions, memories)
```
