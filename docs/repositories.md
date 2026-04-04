# Repositories

Connect multiple repositories across GitHub, GitLab, and Bitbucket. Workers automatically clone the right repo for each task and create pull requests back.

## Supported SCM Providers

### GitHub 🐙
- **Auth:** Personal Access Token or GitHub App
- **URL format:** `owner/repo`

### GitLab 🦊
- **Auth:** Private Token (`PRIVATE-TOKEN` header)
- **URL format:** `group/project`

### Bitbucket 🪣
- **Auth:** Repository Access Token (Bearer)
- **URL format:** `workspace/repo`

## Adding Repositories

### Step 1 — Add SCM Credentials

Go to **Settings → Integrations** and add your token for each SCM provider you use. Each provider requires its own credentials.

### Step 2 — Set Default Repository

Set a default repository for each provider in **Settings → Repositories**. This is the repo workers will target when no specific repo is specified on a task.

### Step 3 — Add Additional Repositories

Add more repositories from the same page. Workers can target any repository in your list — you can specify the target repo when creating tasks from the dashboard.

## How Repository Selection Works

Workers determine which repository to clone based on these rules, in order:

1. **Task-level repo override** — If a specific repo is set on the task (via dashboard or API), that repo is used.
2. **Issue tracker repo mapping** — If the task came from Jira/Linear/GitHub Issues and the project has a mapped repo, that repo is used.
3. **Organization default repo** — Falls back to the default repository for the SCM provider configured on the organization.

## Cross-Repository Tasks

When a task requires changes across multiple repositories (e.g., a backend API change that requires a frontend update), WorkerMill creates **separate pull requests per repository**. Each story in the plan can target a different repo.

**How it works:**
- Planning Agent identifies affected repos
- Stories are assigned to their target repo
- Each repo gets its own feature branch
- Separate PRs are created per repo

**Requirements:**
- All target repos must be in your repo list
- SCM credentials must have access to all repos
- Each repo must be on the same SCM provider

## Bitbucket Authentication

> **Note:** Bitbucket uses **Repository Access Tokens**, not app passwords (which are deprecated).

**Correct:**
- REST API: `Authorization: Bearer <token>`
- Git: `https://x-bitbucket-api-token-auth:<token>@bitbucket.org/...`

**Deprecated (do not use):**
- Basic auth with `username:app_password`
