# Personas

WorkerMill uses specialist personas — each with its own system prompt, tool set, and domain expertise. During `/build`, the planner assigns stories to the most appropriate persona. During `/as`, you choose the persona directly.

## Built-in Personas

| Slug | Role | Tools |
|------|------|-------|
| `planner` | Reads the codebase and decomposes tasks into scoped stories | read-only (read_file, glob, grep, ls, fetch, web_search, lsp) |
| `tech_lead` | Reviews code against specs, scores quality, rejects or approves | read-only (read_file, glob, grep, ls, fetch, web_search, lsp, git) |
| `architect` | System design, architecture decisions, decomposition | read-only (read_file, glob, grep, ls, fetch, web_search, sub_agent, lsp) |
| `backend_developer` | APIs, databases, server-side logic | full (all file, bash, git, web, lsp tools) |
| `frontend_developer` | UI components, state management, styling | full (all file, bash, git, web, lsp tools) |
| `mobile_developer` | React Native, iOS, Android | full (all file, bash, git, web, lsp tools) |
| `devops_engineer` | CI/CD, Docker, infrastructure, deployment | full (all file, bash, git, web, lsp tools) |
| `security_engineer` | Vulnerability audits, auth, injection, OWASP | full (all file, bash, git, web, lsp tools) |
| `qa_engineer` | Test strategy, integration tests, coverage | full (all file, bash, git, web, lsp tools) |
| `data_ml_engineer` | Data pipelines, ML models, analytics | full (all file, bash, git, web, lsp tools) |
| `tech_writer` | Documentation, API docs, READMEs | full (all file, bash, git, web, lsp tools) |

## Persona Precedence

Personas are loaded in order of precedence — the first match wins:

1. **`.workermill/personas/*.md`** — project-level overrides (committed to the repo)
2. **`~/.workermill/personas/*.md`** — user-level overrides (personal across all projects)
3. **Built-in `personas/*.md`** — bundled with the CLI

To override a built-in persona, create a file with the same slug (filename without `.md`) in your project or user directory. The entire persona is replaced — there is no partial merge.

## Writing a Custom Persona

A persona file is a Markdown file with YAML frontmatter:

```markdown
---
name: Platform Engineer
slug: platform_engineer
description: Kubernetes, Terraform, and cloud infrastructure specialist
tools: [read_file, write_file, edit_file, multi_edit_file, patch, glob, grep, ls, bash, bash_background, bash_output, bash_kill, git, fetch, web_search, download_file, lsp, verify, sub_agent, todo, view_image]
---

You are a Platform Engineer. You specialize in cloud infrastructure, Kubernetes, and Terraform.

Your specialties:
- Kubernetes manifest authoring and Helm charts
- Terraform modules and state management
- CI/CD pipeline design (GitHub Actions, GitLab CI)
- Container security and image optimization
- Observability (Prometheus, Grafana, OpenTelemetry)

Rules:
1. Always use infrastructure-as-code — no manual changes
2. Follow the principle of least privilege for IAM and RBAC
3. Prefer declarative configuration over imperative scripts
```

### Frontmatter fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Display name shown in `/personas` and build logs |
| `slug` | yes | Identifier used in `/as <slug>` and planner story assignments |
| `description` | yes | One-line summary shown in `/personas` listing |
| `tools` | yes | Array of tool names this persona can use (see [Tools](#tool-names)) |

### System prompt (body)

The Markdown body after the frontmatter becomes the persona's system prompt. Write it in second person ("You are a ..."). Include:

- **Role and specialties** — what the persona is good at
- **Rules** — constraints on behavior (e.g. "always write tests", "never use `any` types")
- **Collaboration notes** — how this persona interacts with others in a `/build` team

### Tool names

Available tools for the `tools` frontmatter array:

**File:** `read_file`, `write_file`, `edit_file`, `multi_edit_file`, `patch`, `glob`, `grep`, `ls`, `view_image`, `download_file`

**Shell:** `bash`, `bash_background`, `bash_output`, `bash_kill`

**Git:** `git`

**Code:** `lsp`, `verify`

**Web:** `fetch`, `web_search`

**Agentic:** `sub_agent`, `todo`, `memory`

**Tickets:** `ticket`

The `memory` tool is available to all personas — it provides persistent cross-session memory stored as markdown files. Read-only personas (like `planner` and `tech_lead`) restrict their other tools to read operations. Worker personas typically get the full set.

## Routing Personas to Providers

Each persona can run on a different AI provider via the `routing` config:

```json
{
  "routing": {
    "planner": "anthropic",
    "tech_lead": "openai",
    "backend_developer": "ollama",
    "frontend_developer": "ollama",
    "platform_engineer": "ollama"
  }
}
```

Alongside persona slugs, routing accepts three orchestration roles: `planner`, `tech_lead` (the reviewer), and `critic` (the optional [plan critic](quality-gates.md#planner-critic)).

Custom persona slugs work in routing just like built-in ones. Set routing from the CLI:

```
/settings route platform_engineer ollama
```

## Listing Personas

```
/personas
```

Shows all active personas with their source (project, user, or built-in), slug, and description.

## Using a Persona Directly

```
/as platform_engineer set up a Helm chart for the API service
```

Runs the persona with full tool access, no planning step, no review loop.
