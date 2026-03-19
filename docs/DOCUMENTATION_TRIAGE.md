# Documentation Triage & Correction Plan

**Date:** 2026-03-18
**Scope:** All public-facing and internal documentation across the WorkerMill repository
**Method:** Automated inventory of 106 markdown files + code-level verification against current codebase

---

## Executive Summary

A comprehensive audit of WorkerMill's documentation found 34 issues across public-facing pages, internal developer docs, and the README. The most critical problems were wrong model versions on the homepage, phantom pricing tiers with no backend enforcement, and agent docs referencing non-existent CLI commands and removed config interfaces.

**As of this commit, all P0 and most P1 issues are resolved.** The remaining items are lower-priority gaps and a few pages that need minor attention.

### Resolution Status

| Priority | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| P0 (factually wrong) | 14 | 14 | 0 |
| P1 (outdated) | 11 | 9 | 2 |
| P2 (missing content) | 9 | 3 | 6 |
| **Total** | **34** | **26** | **8** |

---

## What Was Fixed

### P0 — Factually Wrong (All Resolved)

| ID | Issue | Resolution |
|----|-------|------------|
| P0-1 | Homepage model versions wrong ("Opus 4.5, Sonnet 4.5") | Fixed to "Opus 4.6, Sonnet 4.6, Haiku 4.5" in `Home/Integrations.tsx` |
| P0-2 | Stale model IDs throughout frontend | Fixed in `Dashboard/helpers.ts` (Opus 4.5->4.6), `Dashboard/types.ts` (removed old `claude-sonnet-4-5-20250929` entry), `CostIntelligence.tsx` (Sonnet 4.5->4.6), `api/routes/analytics/costs.ts` (added `claude-sonnet-4-6` pricing) |
| P0-3 | README says "12 worker personas" | Fixed to 13 (14 dirs minus `common/`), added missing Manager persona to table, Getting Started clarified |
| P0-4 | Pricing tiers displayed but not implemented | `Pricing.tsx` removed from repo (safe copy in gitignored `_drafts/`), all pricing nav links removed |
| P0-5 | Contradictory expert limits in pricing | Removed with pricing page |
| P0-6 | FAQ claims 90-day free trial | FAQ rewritten: "open source, free to run locally, cloud coming soon" |
| P0-7 | agent-and-vscode.md references non-existent CLI commands | Full rewrite: removed `init --standalone`, `run --task`, `prd --file`; documented actual commands: `setup`, `start`, `stop`, `status`, `logs`, `pull`, `update` |
| P0-8 | agent-and-vscode.md references removed config interface | Replaced `StandaloneConfig` with `AgentConfig`, removed `isStandaloneReady()`, removed per-role config, removed standalone mode entirely |
| P0-9 | architecture.md claims 22 task statuses (includes non-existent "running") | Removed "running", added correct 21-state list with `escalated` description |
| P0-10 | Critic threshold documented as 85 | Fixed to 90 (matches production default in seed-local-startup.ts) |
| P0-11 | integrations.md documents removed webhook endpoints | Updated to org-scoped format (`/api/webhooks/:orgSlug/{provider}`), added table of all 6 endpoints |
| P0-12 | Homepage shows unexplained $14.50/mo price | Removed with pricing/features rewrite. SubscriptionVisual now shows Self-Hosted (Free) / Cloud (Coming Soon) / Enterprise (Coming Soon) |
| P0-13 | VS Code walkthrough claims Google sign-in | Verified: Google sign-in IS implemented in extension.ts but command was missing from package.json. Added `workermill.signInWithGoogle` to contributes.commands. Removed undocumented "email" option from README. |
| P0-14 | Docs Integrations page mentions "Sonnet 5" | Removed. Now shows "Opus 4.6, Sonnet 4.6, Haiku 4.5" |

### P1 — Outdated (9 of 11 Resolved)

| ID | Issue | Resolution |
|----|-------|------------|
| P1-1 | architecture.md missing workflow modes | Added section documenting all 6 workflow modes with descriptions and label triggers |
| P1-3 | infrastructure.md too minimal | Added Docker images (3 GHCR images), CI/CD workflows (5 workflows), and agent binary distribution sections |
| P1-5 | troubleshooting.md references wrong CLI commands | Fixed: renamed "Standalone Mode" to "Local Agent", replaced SQLite references, updated all command names |
| P1-6 | agent/README.md needs review | Fixed: updated CLI commands, replaced ECR with GHCR, removed AWS credential requirements, added `logs`/`pull`/`update` |
| P1-7 | README Getting Started misleading | Clarified that `local-workermill start` handles everything (DB + API + frontend) |
| P1-8 | CostIntelligence has stale model names | Fixed Sonnet 4.5 -> 4.6 display |
| P1-10 | Dashboard types has old model ID | Removed stale `claude-sonnet-4-5-20250929` entry |
| P1-11 | Settings types may have stale model list | Verified: already correct (Opus 4.6, Sonnet 4.6, Haiku 4.5) |
| — | FAQ plan-tier gating in multiple answers | Removed all "Pro plan" / "Max and Enterprise" gating language from FAQ answers |

### P2 — Missing Content (3 of 9 Resolved)

| ID | Issue | Resolution |
|----|-------|------------|
| P2-6 | Docs site pages not audited | Audited all 24 pages — 23/24 accurate, 1 had the Sonnet 5 issue (now fixed) |
| P2-7 | VS Code extension README may be stale | Audited: commands verified, removed email sign-in claim, Google sign-in command added to package.json |
| P2-8 | No documentation for org-scoped webhook setup | Documented in integrations.md with full endpoint table |

---

## What Remains

### P1 — Still Open (2 items)

#### ~~P1-2: local-dev.md has confusing database port info~~ ✅ RESOLVED
Local dev now uses standard port 5432. Bastion tunnel uses 5433. All docs updated.

#### P1-4: testing.md missing configuration details
**Location:** `docs/agent/testing.md`
**Problem:** No mention of vitest config, test timeouts, parallelism strategy, Playwright configuration, test fixtures, or coverage reporting.
**Fix:** Add sections on vitest config, Playwright setup, and debugging tests.
**Effort:** 30 min

### P2 — Still Open (6 items)

#### P2-1: No self-hosted deployment guide
**Gap:** Users who want to self-host have no end-to-end guide. `infrastructure.md` now covers Docker images and CI/CD but not step-by-step deployment.
**Effort:** 2 hr

#### P2-2: No API reference documentation
**Gap:** `api/docs/API_DOCUMENTATION.md` exists but hasn't been audited for completeness. 68 route handlers exist.
**Effort:** 2 hr

#### P2-3: Worker execution flow undocumented for users
**Gap:** The coordinator flow (stories, inline review, quality gates, auto-fix, CI polling) is in CLAUDE.md but not in user-facing docs.
**Effort:** 1 hr

#### P2-4: No changelog or release notes
**Gap:** No CHANGELOG.md. Users have no way to know what changed between versions.
**Effort:** 1 hr

#### P2-5: MCP server docs incomplete
**Gap:** `packages/workermill-mcp/TODO.md` is a checklist, not documentation. No user-facing guide.
**Effort:** 1 hr

#### P2-9: CONTRIBUTING.md not audited
**Gap:** May reference outdated commands or workflows.
**Effort:** 15 min

### Internal App Pages (Not Public-Facing)

These are behind authentication and lower priority, but contain stale pricing references:

- `frontend/src/pages/Billing.tsx` — has "$19/mo" subscribe buttons and Stripe checkout
- `frontend/src/components/TrialBanner.tsx` — shows "$19/mo" subscribe CTA
- `frontend/src/pages/SignupDeposit.tsx` — links to `/#pricing`
- `frontend/src/pages/settings/AIWorkersSection.tsx` — "Upgrade to Max" links (5 occurrences)
- `frontend/src/pages/settings/QualitySection.tsx` — "Upgrade" link
- `frontend/src/pages/settings/IntegrationsSection.tsx` — "Upgrade" link
- `frontend/src/pages/Dashboard/MainDashboard.tsx` — pricing links (5 occurrences)
- `frontend/src/pages/PersonaStudio.tsx` — pricing link

These are part of the billing/subscription system and would need a product decision about what to show authenticated users before they can be updated.

### P1-9: AdvancedFeatures page has hardcoded model pricing
**Location:** `frontend/src/pages/Docs/AdvancedFeatures.tsx:205-207`
**Problem:** Hardcoded per-token prices for Claude models. These may drift as Anthropic updates pricing. Not urgent but should be flagged for periodic review.

---

## Files Changed in This Commit

### Tracked (in git)
```
.gitignore                                — resolved merge conflict, removed stale docs/ ignore
README.md                                 — persona count 12→13, Getting Started clarified
agent/README.md                           — CLI commands, GHCR refs, removed AWS/ECR
api/src/routes/analytics/costs.ts         — added claude-sonnet-4-6 pricing entry
frontend/.gitignore                       — added _drafts/ ignore pattern
frontend/src/App.tsx                      — removed /pricing route
frontend/src/components/Footer.tsx        — removed pricing link
frontend/src/components/Navbar.tsx        — removed pricing link
frontend/src/pages/CostIntelligence.tsx   — Sonnet 4.5→4.6
frontend/src/pages/Dashboard/helpers.ts   — Opus 4.5→4.6
frontend/src/pages/Dashboard/types.ts     — removed stale claude-sonnet-4-5 entry
frontend/src/pages/Docs/Integrations.tsx  — removed Sonnet 5, fixed model versions
frontend/src/pages/Home/FAQ.tsx           — rewrote pricing answer, removed plan gating
frontend/src/pages/Home/Features.tsx      — rewrote subscription section (open source, coming soon)
frontend/src/pages/Home/Home.tsx          — removed Pricing section, rewrote CTA
frontend/src/pages/Home/Integrations.tsx  — Opus 4.5→4.6, Sonnet 4.5→4.6
frontend/src/pages/Home/Pricing.tsx       — DELETED (copy in _drafts/)
frontend/src/pages/Home/index.ts          — removed Pricing export
packages/vscode-workermill/README.md      — removed email sign-in, kept GitHub + Google
packages/vscode-workermill/package.json   — added signInWithGoogle command
```

### Untracked (local docs/agent/ — not in git history)
```
docs/agent/architecture.md               — removed "running" status, fixed critic 85→90, added workflow modes
docs/agent/agent-and-vscode.md            — full rewrite: standalone mode removed, CLI fixed, config fixed
docs/agent/integrations.md               — webhook endpoints updated to org-scoped
docs/agent/infrastructure.md             — added Docker images, CI/CD workflows, agent binary sections
docs/agent/troubleshooting.md            — fixed CLI commands, removed SQLite references
docs/DOCUMENTATION_TRIAGE.md             — this file
```
