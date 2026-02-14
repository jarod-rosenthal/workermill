# Agent IP Hardening Plan

Analysis of intellectual property exposure in the published `@workermill/agent` npm package and hardening measures.

## Current Exposure (Pre-Hardening)

Anyone who runs `npm install @workermill/agent` gets readable, unminified JavaScript containing:

| Category | Exposed Details |
|----------|----------------|
| **API Protocol** | All `/api/agent/*` endpoints, auth header format, request/response shapes |
| **AWS Account** | Account ID `AWS_ACCOUNT_ID`, ECR registry path, region |
| **Planning Logic** | Critic prompt, threshold (85/100), file caps (15), story caps, iteration limits |
| **Spawner Architecture** | Full Docker command construction, env var injection pattern, all credential names |
| **Orchestration Flow** | Poll intervals, heartbeat timing, task state machine, fallback logic |

## Existing Protections

- No hardcoded credentials — all injected at runtime
- Config file has `0o600` permissions (owner-only)
- Private ECR (requires AWS credentials to pull worker images)
- Source `.ts` files excluded from npm (only compiled JS published)
- Claude OAuth token mounted into containers, not passed as env var

## Hardening Roadmap

### P0 — Critical (Immediate)

#### 1. Minify/Bundle Agent Dist with esbuild

**Status:** Done

Build pipeline: `tsc` compiles TypeScript, then `build.mjs` runs esbuild to produce minified, tree-shaken single-file bundles. Output is two files (`dist/cli.js` and `dist/index.js`) with mangled identifiers, no comments, no type definitions, no source maps.

**Files changed:**
- `agent/package.json` — build script now runs `tsc; node build.mjs`
- `agent/build.mjs` — esbuild bundler (new)

#### 2. Move Critic Prompt Server-Side

**Status:** Done

The critic prompt (~50 lines of scoring rubric, penalty rules, and evaluation criteria) is now served from `GET /api/agent/critic-prompt`. The agent fetches it at runtime and caches it per session. The approval threshold and file cap limits are also returned from the server.

**Files changed:**
- `api/src/routes/remote-agent.ts` — new `GET /critic-prompt` endpoint
- `agent/src/plan-validator.ts` — replaced embedded `CRITIC_PROMPT` with `getCriticConfig()` fetcher

#### 3. Move ECR Registry URL to Server Config

**Status:** Done (moved from P1 to P0)

The ECR registry URL and worker image URL are now returned from `GET /api/agent/config`. The agent reads them at startup and uses them dynamically. No AWS account IDs in the published package.

**Files changed:**
- `api/src/routes/remote-agent.ts` — `/config` now returns `workerImageUrl` and `ecrRegistry`
- `agent/src/index.ts` — overrides `config.workerImage` from server response
- `agent/src/spawner.ts` — extracts ECR registry from image URL dynamically
- `agent/src/config.ts` — removed hardcoded ECR defaults
- `agent/src/commands/setup.ts` — uses server-provided ECR info

### P1 — High Priority

#### 4. Image Digest Pinning

**Status:** Not started

Currently pulls `:latest` tag. An attacker with ECR write access could push a malicious image. Using SHA256 digests (returned by the API after each deploy) would prevent tag-based substitution.

### P2 — Medium Priority

#### 5. Rate Limiting on Agent API Endpoints

**Status:** Not started

If someone reverse-engineers the API protocol and obtains an API key, they could abuse the endpoints. Per-key rate limiting on `/api/agent/*` routes would mitigate this.

#### 6. Credential Scoping Per Task

**Status:** Not started

Worker containers currently receive all configured credentials (GitHub, Bitbucket, GitLab, Jira, AWS, AI providers) even if the task only needs one SCM provider. Passing only the relevant credentials per task reduces blast radius if a container is compromised.

## Verification

After building (`cd agent && npm run build`), verify no sensitive strings in the bundle:

```bash
grep -c "AWS_ACCOUNT_ID" dist/cli.js          # Should be 0 (no AWS account ID)
grep -c "Senior Architect" dist/cli.js      # Should be 0 (no critic prompt)
grep -c "Requirement Rewriting" dist/cli.js # Should be 0 (no evaluation criteria)
```
