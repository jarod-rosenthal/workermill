# Recipes

Concrete workflows that combine WorkerMill features to solve real problems. Use these as starting points — copy, adapt, commit to your repo.

---

## Mixed-provider team for production PRs

**Goal:** High-quality output for planning and review (Anthropic), cheap high-volume execution (xAI or local Ollama), independent reviewer (OpenAI).

```
/settings key anthropic sk-ant-...
/settings key xai xai-...
/settings key openai sk-...

/model xai/grok-code-fast-1
/settings route planner anthropic
/settings route tech_lead openai

/model planner anthropic/claude-opus-4-6
/model reviewer openai/gpt-5.4
```

Now `/build` uses Opus to plan, Grok Code Fast for workers, and GPT-5.4 for review. Workers run on the cheapest code-tuned model while judgment calls route to stronger models.

**Why it works:** Different model families have different strengths and blind spots. Running review on a different family than execution catches a real class of mistakes.

---

## Fully local setup (zero API cost)

**Goal:** No API keys, no cost, no network dependency.

```bash
# Install Ollama, pull a coding model
ollama pull qwen3-coder:30b
```

```
/settings key ollama ""
/model ollama/qwen3-coder:30b 131072
/settings route planner ollama
/settings route tech_lead ollama
```

The `131072` sets Ollama's context window to 128K. For quality, use the largest model your hardware can run — `qwen3-coder:30b` or larger if you have the VRAM. LM Studio works the same way with `/model lmstudio/<model>`.

**Caveats:** Local models are slower and weaker at planning than flagship cloud models. Use `/as` for focused tasks where you can direct the work yourself, rather than `/build` for fully autonomous runs.

---

## Enforce project-specific quality gates

**Goal:** Every file write passes typecheck and lint before moving on. If they fail, the agent sees the error and fixes it.

Edit `~/.workermill/cli.json`:

```json
{
  "hooks": {
    "post": [
      {
        "command": "npx tsc --noEmit",
        "tools": ["write_file", "edit_file", "patch"]
      },
      {
        "command": "npx eslint $WORKERMILL_TOOL_INPUT",
        "tools": ["write_file", "edit_file"]
      }
    ]
  }
}
```

Or for a Python project:

```json
{
  "hooks": {
    "post": [
      { "command": "uv run ruff check $WORKERMILL_TOOL_INPUT", "tools": ["write_file", "edit_file"] },
      { "command": "uv run mypy .", "tools": ["write_file", "edit_file", "patch"] }
    ]
  }
}
```

**Why it works:** Post-hooks run *after* each write. When a hook exits non-zero, the error goes back to the agent, and the model sees it in the next turn. The agent self-corrects without human intervention.

---

## Plan-before-execute for high-risk changes

**Goal:** Don't let the agent write code until a plan has been reviewed and approved by a critic.

```
/settings review.critic true
/settings review.criticThreshold 8
```

Now every `/build` runs the planner critic between planning and execution. It scores the plan 1-10 on completeness, feasibility, dependencies, scope, and risk. A score below 8 triggers a refinement pass against the critic's specific issues, up to 3 scoring rounds. Workers only start once the plan passes.

Route the critic to a stronger model than your workers — it reads a plan, not a codebase, so it's cheap:

```
/settings route critic anthropic
```

If the plan still doesn't pass after 3 rounds, the remaining issues are printed and you get the usual "Execute this plan?" prompt. To make that a hard stop instead, add strict mode:

```
/settings review.strict true
```

**When to use:** Refactors, schema migrations, security-sensitive work, anything where a bad plan costs more than a few critic calls.

**When to skip:** Trivial tasks, quick fixes, exploration. The critic adds latency and tokens to every `/build`.

See [Quality Gates](quality-gates.md#planner-critic) for the full scoring rubric.

---

## Custom `/deploy` command for your team

**Goal:** Everyone on the team gets the same `/deploy` command with the same guardrails, committed to the repo.

Create `.workermill/commands/deploy.md`:

```markdown
---
name: deploy
description: Deploy to production via the approved pipeline
allowedTools: [bash, read_file, grep]
args: environment (staging|production)
---

Deploy the current branch to the specified environment.

1. Verify we're on a clean branch: `git status`
2. Run `./scripts/pre-deploy-check.sh <environment>` — abort if it fails
3. Push the branch: `git push origin $(git branch --show-current)`
4. Run `./scripts/deploy.sh <environment>`
5. Tail deploy logs for 60 seconds or until "deployment complete"
6. Run `./scripts/smoke-test.sh <environment>` — report any failures
7. Post a summary of what was deployed and the result
```

Commit `.workermill/commands/deploy.md` to the repo. Now every team member has `/deploy staging` and `/deploy production` available with identical behavior.

**Why it works:** Custom commands live in the repo, so everyone on the team gets the same automation without installing anything extra. The `allowedTools` array keeps the command scoped to read-only analysis and `bash` — no surprise file edits.

---

## Project-specific backend persona

**Goal:** The backend developer persona should know your project's stack, conventions, and gotchas.

Copy the built-in persona and customize it:

```bash
mkdir -p .workermill/personas
```

Create `.workermill/personas/backend_developer.md`:

```markdown
---
name: Backend Developer
slug: backend_developer
description: Backend development specialist for this project
tools: [bash, read_file, write_file, edit_file, patch, glob, grep, ls, fetch, verify, sub_agent, lsp]
---

You are a senior backend developer working on [Your Project Name].

Stack:
- Python 3.13 with FastAPI
- PostgreSQL with SQLAlchemy 2.0
- uv for dependency management, ruff for linting, mypy for types
- pytest with real databases (no mocks)

Conventions:
- All endpoints live under /api/v1/
- Pydantic V2 schemas in src/schemas/
- SQLAlchemy models in src/models/ — declarative style with UUID primary keys
- Alembic migrations in alembic/versions/ — never edit past migrations
- Tests in tests/, separate test database per test via transaction rollback

Critical rules:
- Use `datetime.now(timezone.utc)` — never `utcnow()`
- 120 character line length
- Absolute imports only (`from src.models import ...`)
- Run `uv run ruff check src/ tests/` and `uv run mypy src/` before finishing any story

(...rest of the persona...)
```

This override only applies in the project where the file exists. Other projects still use the built-in `backend_developer`. No risk of cross-project contamination.

---

## Slack notification on build complete

**Goal:** Ping a Slack channel when `/build` finishes, so you can review without watching the terminal.

Create a Slack incoming webhook, then add to `~/.workermill/cli.json`:

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

The CLI POSTs the session context to the webhook as JSON. Slack's webhook won't render it as a nice message by itself — add a relay service in between if you want formatting.

For a native macOS notification instead:

```json
{
  "hooks": {
    "on": {
      "ship_complete": [
        { "command": "osascript -e 'display notification \"build finished\" with title \"WorkerMill\"'" }
      ]
    }
  }
}
```

---

## Review someone else's PR before merging

**Goal:** Run an independent review of a PR before you approve it.

```
/review #42
```

This fetches the PR's diff, runs the tech lead persona against it, and scores the code. If it finds issues, the CLI offers to create a GitHub issue from the findings and immediately kick off `/build` to fix them.

**Tip:** Set the reviewer to a different model family than the PR author's toolchain. If the PR was written with Claude, review with GPT-5.4 or Gemini — you'll catch issues a same-family reviewer might rationalize away.

```
/settings route tech_lead openai
/model reviewer openai/gpt-5.4
/review #42
```

---

## Resume a `/build` that hit a blocker

**Goal:** Your `/build` crashed halfway through (network, rate limit, review rejection). Continue from where it left off instead of starting over.

```
/retry
```

The CLI loads the existing plan from disk, skips planning entirely, and picks up from the first incomplete story. Workers see their own prior commits via `git log`, so they don't redo finished work.

**State location:** `~/.workermill/ship-state/<repo-id>.json`. If you need to discard a stuck run:

```bash
rm ~/.workermill/ship-state/<repo-id>.json
```

---

## Run a persona without tools for a pure analysis

**Goal:** Get a security audit that only *reads* — no writes, no bash, no risk.

Customize the persona with a tool allowlist:

`.workermill/personas/security_auditor.md`:

```markdown
---
name: Security Auditor
slug: security_auditor
description: Read-only security auditor
tools: [read_file, glob, grep, ls, fetch, web_search, todo]
---

You are a read-only security auditor. You analyze code for vulnerabilities but you do NOT modify files or run commands.

Your process:
1. Read the codebase to understand the architecture
2. Identify every entry point (API endpoints, CLI commands, webhooks, file upload handlers)
3. Trace user input through the system — where does untrusted data enter, where does it get used
4. Check for: injection (SQL, command, template, XSS), broken auth, insecure deserialization, secret leakage, missing rate limits, insecure defaults
5. Score findings by severity and impact
6. Output a report with file:line references and specific fixes
```

Then:

```
/as security_auditor audit this repository
```

The tool allowlist prevents the persona from ever writing a file or running a command, even if the model tries to. Safe to run on production code you don't want touched.

---

## Cost-conscious iteration loop

**Goal:** Work fast on local models during development, switch to cloud only for the final PR.

Set your local Ollama as default:

```
/model ollama/qwen3-coder:30b 131072
```

Work iteratively with `/as` — fast, cheap, no cloud cost:

```
/as backend_developer add a new /api/v1/tags endpoint
/as qa_engineer write tests for the tags endpoint
/as frontend_developer add a tags filter to the products page
```

When you're ready for a full review and PR:

```
/model anthropic/claude-sonnet-4-6
/review branch
```

Review the findings, fix anything flagged, then ship to a PR. You paid cloud costs only for the final review pass, not the iterative development.

**Alternative:** Use the plan critic as a cheap quality check before any code is written:

```
/settings review.critic true
/build polish the tags feature
```

With no `routing.critic` entry, the critic runs on your default provider — so in a fully local setup it scores and refines the plan locally too, at no API cost. Only the final review touches cloud, and only if you routed the reviewer there.

---

## Debug a slow session

**Goal:** Figure out why the CLI is slow.

1. **Check context usage:** `/status` — if context is over 75%, run `/compact`
2. **Check costs:** `/cost` — see which role is burning the most tokens
3. **Check logs:** `tail -100 ~/.workermill/logs/<session-id>/cli.log` — look for rate limit retries, tool timeouts, or repeated failed calls
4. **Check the model:** `/model` — local models can be slow on weak hardware, cloud models vary by load

Common causes:
- Context window nearly full → `/compact`
- Tool call loop detected → the model is stuck repeating itself, restart with `/clear`
- Rate limited → visible as retry countdown; switch model or wait
- Local model overloaded → check `ollama ps` and system resources

---

## Keep project instructions in sync

**Goal:** The agent always reads your project's conventions, stack, and constraints.

Run once to generate:

```
/init
```

This creates `AGENT.md` in the repo root — a codebase analysis the agent loads on every turn. Commit it.

Update it when the project changes significantly (new stack, new conventions). Or use `/remember` to add specific facts:

```
/remember We just migrated from TypeORM to Drizzle — all new code uses Drizzle
/remember The staging URL is https://staging.example.com
/remember CI runs on self-hosted runners, so `ubuntu-latest` won't work
```

Memories persist per project in `~/.workermill/projects/<project-id>/memories/` and load automatically with every session.

**The agent also reads** common standards, first match wins. Files are checked before directories:

1. `AGENT.md`, `AGENTS.md`, `.workermill/instructions.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.clinerules.md`, `.github/copilot-instructions.md`
2. `.cursor/rules/*.mdc|.md`, then `.windsurf/rules/*.mdc|.md`

---

## Scheduled recurring task (experimental)

**Goal:** Run `/build` on a schedule (e.g. "every weekday at 9am, triage new GitHub issues").

```
/schedule "0 9 * * 1-5" /build #oldest-open-issue
```

This uses cron syntax. Scheduled tasks run via the CLI's scheduling system and log to `~/.workermill/schedules/`. The feature is marked experimental — expect edge cases.
