# OCS-24 Post-Mortem: First Successful Local Agent Run

Analysis of OCS-24's first successful run on the local WorkerMill client (remote agent on Dell).

## Issues

### Issue 1: Self-Review Toggle (New Feature)
**Status:** Fixed
**Description:** Need a dashboard toggle to enable/disable self-review per-task at runtime, plus a `self-review` Jira label.
**Fix:** Added `PATCH /api/control-center/tasks/:taskId/self-review` endpoint, dashboard toggle button (FileSearch icon), worker command handler for `toggle_self_review`, and `self-review` label support across all 6 webhook handlers.

### Issue 2: PR Lifecycle — Handle Closed PRs
**Status:** Fixed
**Description:** `gh pr view` only checked for URL, not PR state. A closed PR would be "reused" instead of creating a new one.
**Fix:** Changed `gh pr view` to include `--json url,state`. If `state === "CLOSED"`, falls through to create a new PR. If `state === "MERGED"`, logs warning and skips PR creation.

### Issue 3: PR Creation Phase Logging (Black Hole Fix)
**Status:** Fixed
**Description:** After stories complete, the coordinator enters a ~60-second phase (quality gate, WORKERMILL.md, PR creation) with zero dashboard visibility. Users see silence and assume the worker is stuck.
**Fix:** Added `axios.post` log calls at milestones: quality gate validation, WORKERMILL.md update, story persistence, PR creation start/success/failure. Added `postLog` callback to `GitOps` for sub-step visibility during branch merge, push, and PR API calls.

### Issue 4: Token Tracking — Report 0 for Local Mode
**Status:** Fixed
**Description:** Local/remote agent mode uses Claude Max subscription, not API tokens. Dashboard showed stale partial data instead of $0.00.
**Fix:** When `EXECUTION_MODE === "local"`, coordinator posts `{ inputTokens: 0, outputTokens: 0, estimatedCost: 0 }` to the usage endpoint at task completion.

### Issue 5: Error Classifier False Positives
**Status:** Fixed
**Description:** Two problems: (1) Manager/review output classified as errors when it contains error keywords in its analysis text. (2) Git pattern `msg.includes("git")` matches any message containing the word "git" (e.g., "digital", "legitimate").
**Fix:** (1) Added early return for `logType === "manager"`. (2) Changed Git pattern to `/\bgit\s+(push|pull|merge|checkout|clone|fetch|rebase|reset)\b/i` — matches actual Git commands, not incidental "git" substrings. Kept `CONFLICT` and `fatal:` checks unchanged.

### Issue 6: GITHUB_REVIEWER_TOKEN Needed for PR Approvals
**Status:** Documented (not fixable)
**Description:** GitHub blocks same-user self-approval. When the tech lead reviewer uses the same GitHub token as the worker, formal PR approval fails. The reviewer falls back to comment-only review.
**Workaround:** Create a separate GitHub account (e.g., "workermill-reviewer") with write access to the repo. Set `GITHUB_REVIEWER_TOKEN` env var for containers. This is a GitHub platform limitation.

### Issue 7: Redundant npm Install per Story
**Status:** Deferred (future optimization)
**Description:** Each story worktree runs a full `npm install`, even though `node_modules` could be shared from the main repo checkout.
**Why deferred:** Worktree isolation is important for correctness — stories can modify `package.json`. Sharing `node_modules` requires careful invalidation logic. The cost (~30-60s per story) is acceptable for now.
**Future approach:** Copy `node_modules` from main checkout as baseline, then run `npm install` only if `package.json` differs.
