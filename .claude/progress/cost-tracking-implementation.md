# Cost Tracking Implementation Progress

**Started**: 2026-01-11
**Status**: IMPLEMENTATION COMPLETE - Ready for Deploy
**Agent**: Claude Opus 4.5
**Reference Plan**: `docs/cost-tracking-fix-plan.md`

---

## Problem Summary

Cost tracking shows `$0.00` for all tasks because:
1. Worker uses Claude Code CLI which doesn't emit token markers
2. Worker greps for `::input_tokens::` markers that don't exist
3. All token values default to 0

## Solution Approach

Implementing **Phase 2: SDK Wrapper/Proxy** from the plan - create a local HTTP proxy that:
1. Intercepts Claude Code CLI's API calls to Anthropic
2. Captures token usage from API responses
3. Writes usage to a file that the worker script reads

---

## Implementation Checklist

### Phase 1: Investigation (SKIPPED)
- [x] Decision: Skip CLI investigation, go straight to proxy solution
- Reason: Claude Code CLI doesn't have `--output-format json` for token data

### Phase 2: Proxy Implementation

#### 2.1 Worker Package Setup
- [x] Add `package.json` to worker directory - Added express, http-proxy-middleware
- [x] Add dependencies: `express`, `http-proxy-middleware`
- [x] Configure TypeScript compilation - Created `src/proxy/tsconfig.json`

#### 2.2 Proxy Server Implementation
- [x] Create `worker/src/proxy/anthropic-proxy.ts`
- [x] Implement token capture from API responses (JSON)
- [x] Handle streaming responses (SSE) - Parses message_start and message_delta events
- [x] Write cumulative usage to `/tmp/claude_usage.json`

#### 2.3 Worker Script Updates
- [x] Update `worker/entrypoint.sh` to start proxy (lines 204-218)
- [x] Set `ANTHROPIC_BASE_URL` environment variable
- [x] Read token usage from proxy's output file (lines 389-427)
- [x] Update API call with captured tokens (existing code uses the variables)

#### 2.4 Docker Updates
- [x] Update `worker/Dockerfile` to install Node.js dependencies
- [x] Copy proxy code to container
- [x] Compile proxy TypeScript to `/app/proxy-compiled/`

#### 2.5 Testing & Verification
- [ ] Deploy to ECS
- [ ] Verify tokens captured in task records
- [ ] Verify cost calculation in dashboard

---

## Files Modified

| File | Status | Changes |
|------|--------|---------|
| `worker/package.json` | DONE | Added express, http-proxy-middleware, @types/express |
| `worker/src/proxy/tsconfig.json` | NEW | TypeScript config for proxy compilation |
| `worker/src/proxy/anthropic-proxy.ts` | NEW | Proxy server that captures token usage |
| `worker/entrypoint.sh` | DONE | Start proxy before Claude, read usage after |
| `worker/Dockerfile` | DONE | Build proxy, copy to /app/proxy-compiled/ |

---

## How It Works

1. **Proxy Startup** (entrypoint.sh lines 204-218):
   - Starts `node /app/proxy-compiled/anthropic-proxy.js` in background
   - Sets `ANTHROPIC_BASE_URL=http://localhost:8080`
   - Claude Code CLI will route API calls through proxy

2. **Token Capture** (anthropic-proxy.ts):
   - Intercepts all `/v1/messages` requests
   - For JSON responses: Extracts `response.usage.input_tokens`, `output_tokens`
   - For SSE streams: Parses `message_start` (input) and `message_delta` (output) events
   - Writes cumulative totals to `/tmp/claude_usage.json`

3. **Token Retrieval** (entrypoint.sh lines 389-427):
   - Stops the proxy after Claude completes
   - Reads `/tmp/claude_usage.json` with jq
   - Falls back to marker parsing if proxy file missing
   - Reports tokens to API via existing `/api/tasks/{id}/worker-complete` endpoint

---

## Next Steps

1. **Deploy**: Run `./deploy.sh --api` to build and push worker image
2. **Test**: Create a test Jira ticket with `workermill` label
3. **Verify**: Check task in database for non-zero token counts
4. **Dashboard**: Verify cumulative cost shows real values

---

## Coordination Notes

**For other agents**:
- Implementation is COMPLETE
- Files in `worker/` are now stable
- Safe to modify: `api/`, `frontend/`, `infrastructure/`
- DO NOT modify without coordination: `worker/entrypoint.sh`, `worker/Dockerfile`, `worker/src/proxy/`

**Blocking Issues**: None

---

## Log

### 2026-01-11 - Session Start
- Created progress tracking file
- Beginning Phase 2 implementation

### 2026-01-11 - Implementation Complete
- Added express and http-proxy-middleware to package.json
- Created anthropic-proxy.ts with JSON and SSE response parsing
- Updated entrypoint.sh to start proxy and read usage file
- Updated Dockerfile to build and include proxy
- Ready for deployment and testing
