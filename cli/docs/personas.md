# Personas

Personas are named expert roles. Each persona is a markdown file with a system prompt and tool allowlist. The CLI uses them in two places:

- **`/build`** — the planner assigns stories to personas; workers run with the persona's system prompt
- **`/as <persona> <task>`** — you directly invoke a persona for a one-off task

## Built-in personas

Shipped with the CLI in `cli/personas/`:

| Slug | Role |
|---|---|
| `architect` | System design, architecture patterns, tech decisions |
| `backend_developer` | Node.js, databases, REST APIs, auth |
| `data_ml_engineer` | Data pipelines, model training, feature engineering |
| `devops_engineer` | CI/CD, infrastructure, deployment, monitoring |
| `frontend_developer` | React, UI, client-side state, CSS |
| `mobile_developer` | iOS, Android, React Native |
| `qa_engineer` | Test strategy, integration tests, test automation |
| `security_engineer` | Auth flows, OWASP, encryption, secure coding |
| `tech_writer` | Documentation, code comments, READMEs |

Plus two used internally by `/build`:

- **`planner`** — decomposes tasks into scoped stories
- **`tech_lead`** — reviews code against requirements

## Loading order

Personas are loaded from three locations in precedence order:

1. **Project** — `.workermill/personas/*.md` in the working directory
2. **User** — `~/.workermill/personas/*.md` in your home directory
3. **Built-in** — `cli/personas/*.md` bundled with the CLI

A project-level persona with the same slug as a built-in overrides the built-in for that repo only. Use this to customize expert behavior per project without affecting others.

## File format

Each persona is a single `.md` file with YAML frontmatter and a system prompt body.

```markdown
---
name: Backend Developer
slug: backend_developer
description: Backend development specialist - Node.js, Express, PostgreSQL
tools: [bash, read_file, write_file, edit_file, patch, glob, grep, ls, fetch, git, web_search, todo, verify, sub_agent, lsp]
---

You are a senior backend developer in a multi-expert collaboration.

Your specialties:
- Node.js with Express/TypeScript
- PostgreSQL with TypeORM
- REST API design
- Authentication and authorization

Collaboration Rules:
1. Check sibling decisions before starting
2. Post decisions for API contracts
3. Answer frontend questions about API endpoints

(...rest of system prompt...)
```

### Frontmatter fields

| Field | Required | Purpose |
|---|---|---|
| `name` | yes | Display name shown in the CLI output |
| `slug` | yes | Identifier used in `/as <slug>` and `routing` config — must be lowercase with underscores, no spaces |
| `description` | yes | One-line summary shown in `/personas` and persona lists |
| `tools` | no | Array of tool names the persona is allowed to use. Omit to allow all tools. |

### Body

Everything after the closing `---` is the system prompt. Write it like you're instructing a senior engineer on a team — specialties, collaboration rules, work style, critical constraints.

## Writing a custom persona

### 1. Create the file

For a project-specific persona:

```bash
mkdir -p .workermill/personas
touch .workermill/personas/platform_engineer.md
```

For a user-level persona that works in every project:

```bash
mkdir -p ~/.workermill/personas
touch ~/.workermill/personas/platform_engineer.md
```

### 2. Write the frontmatter

```markdown
---
name: Platform Engineer
slug: platform_engineer
description: Kubernetes, Helm, service mesh, observability
tools: [bash, read_file, write_file, edit_file, glob, grep, ls, fetch, web_search, verify, sub_agent]
---
```

Pick a slug that matches how you want to invoke it: `/as platform_engineer scale the api deployment`.

### 3. Write the system prompt

Start with the role and specialties, then layer on rules. Look at `cli/personas/backend_developer.md` for a good template. Key elements to include:

- **Role statement** — "You are a senior X in a multi-expert collaboration"
- **Specialties** — bulleted list of areas the persona owns
- **Collaboration rules** — when to post decisions, when to answer questions from siblings, when to escalate
- **Work style** — how the persona approaches tasks (test-first, incremental, security-conscious, etc.)
- **Critical constraints** — things the persona must never do (e.g. "never compromise on security for speed")

### 4. Test it

```
/personas                                      # Verify your persona shows up
/as platform_engineer help me scale this pod
```

If it doesn't appear, check the frontmatter syntax — missing `---` delimiters or malformed YAML are the usual culprits.

## Tool restrictions

The `tools` array in frontmatter limits what tools the persona can call during a task. Use this to enforce boundaries:

```yaml
tools: [read_file, glob, grep, ls, fetch, web_search, todo]   # Read-only auditor
```

```yaml
tools: [bash, read_file, write_file, edit_file, patch, verify]   # Focused developer, no web
```

The full list of built-in tools: `bash`, `read_file`, `write_file`, `edit_file`, `patch`, `glob`, `grep`, `ls`, `fetch`, `web_search`, `todo`, `verify`, `lsp`, `sub_agent`, `browser_*` (browser tools).

Omit the `tools` field to grant access to everything.

## Routing personas to specific models

Use `/settings route <slug> <provider>` to send a persona's calls to a specific provider:

```
/settings route security_engineer anthropic
/settings route frontend_developer ollama
/settings route backend_developer xai
```

Combined with a good provider set, this lets you run cheap local models for bulk work and route critical personas (security, architect, tech_lead) to stronger cloud models.

## Customizing built-in personas per project

You don't have to replace a built-in persona entirely. Copy the file, edit it, and drop it in `.workermill/personas/` — the project version takes precedence for that repo only.

```bash
cp node_modules/workermill/personas/backend_developer.md .workermill/personas/
# Edit .workermill/personas/backend_developer.md with your project's conventions
```

Common customizations:

- Add project-specific tech stack details (e.g. "this project uses Drizzle, not Prisma")
- Add repo-specific conventions (e.g. "all endpoints are versioned under `/api/v2`")
- Tighten the tool allowlist to enforce project-specific restrictions

## Examples

See `cli/personas/` in the WorkerMill repo for the full set of built-in personas. Each one is a working example you can copy and adapt.
