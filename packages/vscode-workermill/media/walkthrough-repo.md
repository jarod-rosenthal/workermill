# Connect Your Repository

Workers need access to your codebase to read files, create branches, and open pull requests.

### Option 1 — GitHub App (recommended)

Install the WorkerMill GitHub App on your repository. This grants only the permissions needed (code read/write, pull requests, issues) with no personal token to manage.

1. Open **Settings** from the WorkerMill sidebar
2. Go to **Integrations**
3. Click **Install GitHub App**
4. Select your organization and repositories

### Option 2 — Personal Access Token

For GitHub, GitLab, or Bitbucket — paste a token with repository access.

| Provider | Required scopes |
|----------|----------------|
| **GitHub** | `repo` (full repository access) |
| **GitLab** | `api` (read/write) |
| **Bitbucket** | `repository:write`, `pullrequest:write` |

1. Open **Settings** > **Integrations**
2. Select your SCM provider
3. Paste your token

### Verify

After connecting, open the sidebar — you should see your repository name. Workers will clone this repo when executing tasks.
