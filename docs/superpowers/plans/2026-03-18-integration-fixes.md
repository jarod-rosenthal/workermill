# Integration Fixes — 2026-03-18 Audit

**Goal:** Fix integration bugs identified in the 2026-03-18 audit across webhooks, SCM providers, and worker decisions.

---

## Completed

- [x] **GitLab `branchContainsCommit`** — `commits.length >= 0` always returned true. Fixed by reversing compare direction (`from=branch&to=commit`) and checking `commits.length === 0`. (`gitlab-provider.ts`)
- [x] **Bitbucket `branchContainsCommit`** — prefix-only hash check replaced with paginated commit walk via `/commits/{branch}` endpoint, up to 500 commits. (`bitbucket-provider.ts`)
- [x] **Sonnet model name** in org-scoped webhooks — changed `claude-sonnet-4-5-20250929` → `claude-sonnet-4-6` to match legacy endpoints. (`linear.ts:531`, `github-issues.ts:531`)
- [x] **Worker decision defaults** — corrected fallback defaults to match production: `maxReviewRevisions: 3→4`, `maxPerStoryRevisions: 2→0`. (`worker-decision-engine.ts`, `.js`, `.test.ts`)
- [x] **Action enum type mismatch** — service returns `"auto_retry"` but client typed `"retry"`. Fixed client type to `"auto_retry" | "escalate" | "skip"`. (`decision-client.ts`)
- [x] **`syncIssueRelationships` await** — added `await` to all 3 fire-and-forget call sites. Function has internal try-catch so webhook won't break. (`jira.ts`, `linear.ts` ×2)
- [x] **GitLab atomic update checks** — added `affected === 0` guard to 4 atomic updates matching GitHub's pattern. (`gitlab.ts`)
- [x] **Bitbucket atomic update checks** — added `affected === 0` guard to 4 atomic updates matching GitHub's pattern. (`bitbucket.ts`)
- [x] **GitHub CI dual-fetch** — removed `if (statuses.length === 0)` gate. Now always fetches both Check Runs API and Commit Status API, deduplicates by name (check runs win). (`github-provider.ts`)
- [x] **Platform changes documentation** — created `docs/agent/platform-changes-2026.md` with Bitbucket/GitLab/GitHub changes and action items.

---

## Remaining — Needs Discussion

### Bitbucket `mergeable` always returns `true`
- **File:** `api/src/scm-providers/bitbucket-provider.ts:523`
- **Issue:** `mergeable: true` is hardcoded. Cannot detect merge conflicts for Bitbucket PRs. Callers skip conflict resolution when `mergeable !== false`.
- **Blocker:** Couldn't confirm what fields Bitbucket's PR API actually exposes for merge conflict detection. Need to test against a real Bitbucket instance or find complete API docs.
- **Impact:** Merge attempts on conflicted Bitbucket PRs fail instead of triggering retry/update-branch logic.

### Bitbucket cross-workspace API audit (deadline: March 31, 2026)
- **File:** `api/src/routes/settings/integrations.ts:680`
- **Issue:** Only 1 cross-workspace call found: `GET /2.0/user` for connection testing. This is user-scoped (not workspace-listing), so likely safe.
- **Action needed:** Confirm `/2.0/user` survives the March 31 deprecation. If not, replace with a workspace-scoped test call.

### Linear status sync (new feature)
- **Files:** `worker/execution/ticket/transition_issue.ts`, `worker/epic/ticket-ops.ts:90-93`
- **Issue:** Linear has NO transition_issue implementation. Completed/failed tickets stay "in-progress" forever.
- **Complexity:** Moderate — requires 3 GraphQL calls (resolve identifier → get team states → update issue state). Pattern exists in `add_comment.ts`.

### Credential `process.env` fallbacks in local-epic-spawner
- **File:** `api/src/services/local-epic-spawner.ts:724-809`
- **Issue:** Credentials fall back to `process.env.*` which breaks multi-tenant isolation. ECS spawner correctly omits these fallbacks.
- **Risk:** Removing fallbacks could break local dev setups that rely on env vars instead of org_credentials table.

### GitLab `merge_status` → `detailed_merge_status` migration
- **File:** `api/src/scm-providers/gitlab-provider.ts`
- **Issue:** `merge_status` field is deprecated in GitLab API v4 (removed in v5). No hard date for v5 yet.
- **Action:** Replace `merge_status === "can_be_merged"` with `detailed_merge_status` check before GitLab v5 ships.
