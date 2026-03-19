# SCM Platform Changes — 2026

Last updated: 2026-03-18

## Bitbucket (CRITICAL — breaking changes imminent)

### App Password Deprecation
- **Sep 9, 2025** (already in effect): No new app passwords can be created
- **Jun 9, 2026**: ALL existing app passwords stop working permanently
- **Replacement**: API Tokens with Scopes (created at Atlassian account level)
- Git clone auth: `x-bitbucket-api-token-auth:{token}` (WorkerMill already uses this)
- REST API auth: Basic auth with `email:token` (WorkerMill already uses this)
- Required scopes: Repositories (R/W), Pull Requests (R/W), Webhooks (R/W) minimum

### Cross-Workspace API End of Life
- **Mar 23–30, 2026**: Brownouts (30 min to 3 hours)
- **Mar 31, 2026**: Cross-workspace REST API endpoints permanently removed (return 404)
- **Jul 1, 2026**: Cross-workspace forks no longer supported
- All deprecated endpoints have workspace-scoped equivalents
- **Action needed**: Audit WorkerMill's Bitbucket API calls for cross-workspace usage

### OAuth Changes
- **Feb 27, 2026**: OAuth 1.0 and implicit grant flows permanently removed
- **May 4, 2026**: `client_credentials` grants no longer issue refresh tokens; workspace-scoped only

### Issues & Wikis Sunset
- **Apr 2026**: Can no longer enable Issues/Wikis on new repos
- **Aug 2026**: Full removal
- No impact on WorkerMill (we don't use Bitbucket Issues)

### Webhook Changes
- **Feb 24, 2026**: Webhooks may be sent from different IP ranges — firewall rules may need updating
- New event: "Request Changes" on PRs (created/removed)

### Infrastructure
- Bitbucket Server: EOL Feb 15, 2024 (dead)
- Bitbucket Data Center: NOT being killed (excluded from 2029 Atlassian DC EOL)
- Hybrid license (mid-2026): Run both DC and Cloud at no extra cost
- EU Data Residency: Dec 2026; India: Jun 2027

---

## GitLab

### GitLab 18.0 (May 2025 — already released)
- Shell executors on GitLab-hosted runners removed
- PostgreSQL 14 no longer supported (must be 16.5+)
- Ruby-based GitLab Runner deprecated

### API Deprecations (working in v4, removed in v5 — no hard date yet)
- **`merge_status`** → use `detailed_merge_status` (WorkerMill uses `merge_status` in gitlab-provider.ts)
- **`merged_by`** → use `merge_user`
- **`default_branch_protection`** → use `default_branch_protection_defaults`
- Single MR changes endpoint → use list MR diffs endpoint
- Pull mirroring → new `/mirror/pull` endpoint

### Authentication
- PAT max lifetime extended to 400 days
- Token rotation creates token families with automatic revocation
- ROPC grant now requires client authentication (enforced Apr 8, 2025)

### No Impact Areas
- Commit status API: fully supported, no deprecation
- Compare API: fully supported

---

## GitHub

### New REST API Version: 2026-03-10 (released Mar 12, 2026)
- Old version `2022-11-28` supported for 24+ months (until ~Mar 2028)
- WorkerMill currently pins `2022-11-28` — no rush to migrate

Key breaking changes in new version:
- `merge_commit_sha` removed from PR payloads
- Singular `assignee` field removed (use `assignees` array)
- `use_squash_pr_title_as_default` removed (use `squash_merge_commit_title`)
- `has_downloads` removed from repository objects
- Workflow dispatch returns `200` with run details instead of `204`

### GitHub Actions
- Check run modification restriction (Mar 31, 2025): workflows can't modify other workflows' check runs via GITHUB_TOKEN — no impact on WorkerMill (we read, don't modify)
- Node 20 deprecation on runners: Node 24 default Jun 2, 2026; removal fall 2026

### No Impact Areas
- Check runs API: fully supported, no deprecation
- Commit status API: fully supported, no deprecation
- Classic PATs: no announced deprecation date
- Both APIs WorkerMill uses remain stable

---

## WorkerMill Action Items

### Immediate (by Mar 31, 2026)
- [ ] Audit Bitbucket provider for cross-workspace API calls

### Before Jun 9, 2026
- [ ] Update docs/UI references from "App Password" to "API Token with Scopes"
- [ ] Document required Bitbucket token scopes for customers
- [ ] Test end-to-end with new Bitbucket API tokens

### Medium Term
- [ ] Migrate GitLab `merge_status` → `detailed_merge_status` before v5
- [ ] Plan GitHub API version migration to `2026-03-10` before 2028

### Market Context
- GitHub: ~56–78% share, 180M+ developers, growing
- GitLab: ~33–38% regular usage, growing
- Bitbucket: ~30–32% regular usage, declining (~3% YoY)
