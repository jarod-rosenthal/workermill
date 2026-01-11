# Cost Tracking Fix Implementation Plan

**Status**: Planning
**Created**: 2026-01-11
**Priority**: High
**Estimated Effort**: ~8-12 hours

## Problem Statement

Cost tracking in WorkerMill shows `$0.00` for all tasks because token usage data never reaches the API. The worker container attempts to parse token markers from Claude Code CLI output, but the CLI doesn't emit these markers.

## Current State Analysis

### How OnCallShift Does It (Working)

OnCallShift uses the **Anthropic SDK directly**, which returns token usage in the API response:

```typescript
const response = await anthropic.messages.create({...});
// response.usage.input_tokens = 1500
// response.usage.output_tokens = 800
```

The worker then reports these real values to the API.

### How WorkerMill Does It (Broken)

WorkerMill uses **Claude Code CLI**, which is a black box:

```bash
# worker/entrypoint.sh line 250
claude --print --model "${CLAUDE_MODEL:-sonnet}" --dangerously-skip-permissions "${PROMPT}"
```

The worker then tries to grep for markers that don't exist:

```bash
# worker/entrypoint.sh lines 373-376
INPUT_TOKENS=$(grep '::input_tokens::' "${OUTPUT_FILE}" | ... || echo "0")
OUTPUT_TOKENS=$(grep '::output_tokens::' "${OUTPUT_FILE}" | ... || echo "0")
```

**Result**: All token values are `0`, cost calculation returns `$0.00`.

### Data Flow Comparison

```
OnCallShift (Working):
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Anthropic   │───▶│ SDK returns │───▶│ Real tokens │
│ SDK Call    │    │ usage data  │    │ reported    │
└─────────────┘    └─────────────┘    └─────────────┘

WorkerMill (Broken):
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Claude CLI  │───▶│ No token    │───▶│ Grep finds  │
│ Invocation  │    │ output      │    │ nothing → 0 │
└─────────────┘    └─────────────┘    └─────────────┘
```

## Solution Options

### Option 1: Claude Code CLI JSON Output (Recommended)

**Approach**: Use Claude Code's `--output-format json` flag if available, which may include usage metadata.

**Pros**:
- Minimal code changes
- Keeps using Claude Code CLI
- Native solution

**Cons**:
- Depends on Claude Code CLI supporting this feature
- May not include all token types (cache tokens)

**Investigation needed**: Check if `claude --help` shows JSON output options.

### Option 2: Parse Claude Code Logs

**Approach**: Claude Code may log token usage to stderr or a log file. Capture and parse these logs.

**Pros**:
- No architecture change
- May already have data available

**Cons**:
- Fragile - depends on log format
- May not be officially supported

### Option 3: Wrap Claude Code with SDK Proxy

**Approach**: Create a wrapper that:
1. Intercepts Claude Code's API calls
2. Captures token usage from responses
3. Outputs markers after execution

**Pros**:
- Works with existing CLI
- Captures real data

**Cons**:
- Complex implementation
- May break with Claude Code updates

### Option 4: Replace CLI with Direct SDK (Most Reliable)

**Approach**: Replace Claude Code CLI with a custom agent using Anthropic SDK directly, similar to OnCallShift.

**Pros**:
- Full control over token capture
- Matches OnCallShift's proven approach
- Enables cache token tracking

**Cons**:
- Significant refactor
- Lose Claude Code's built-in features
- More code to maintain

### Option 5: Estimate Tokens from Output Length

**Approach**: Estimate token count based on character/word count of input and output.

**Pros**:
- Simple implementation
- Works immediately

**Cons**:
- Inaccurate (could be 20-50% off)
- Doesn't capture cache tokens
- Not suitable for billing

## Recommended Approach

**Phase 1**: Investigate Claude Code CLI capabilities (Option 1)
**Phase 2**: If Option 1 fails, implement SDK wrapper (Option 3)
**Phase 3**: Long-term, migrate to direct SDK (Option 4) as part of multi-provider support

---

## Phase 1: Investigate Claude Code CLI

### Step 1.1: Check CLI Capabilities

```bash
# In worker container or local environment
claude --help
claude --help | grep -i output
claude --help | grep -i json
claude --help | grep -i token
claude --help | grep -i usage
```

### Step 1.2: Test JSON Output

```bash
# Test if JSON output includes usage
claude --output-format json --print --model sonnet "Say hello"
```

### Step 1.3: Check for Environment Variables

```bash
# Some CLIs expose usage via env vars
env | grep -i claude
env | grep -i token
```

### Step 1.4: Check Stderr/Logs

```bash
# Capture stderr separately
claude --print --model sonnet "Hello" 2> /tmp/claude_stderr.txt
cat /tmp/claude_stderr.txt | grep -i token
```

---

## Phase 2: SDK Wrapper Implementation

If Claude Code CLI doesn't expose tokens, implement an HTTP proxy that captures them.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Worker Container                             │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Claude Code  │───▶│ Local Proxy  │───▶│ Anthropic    │      │
│  │ CLI          │    │ (captures    │    │ API          │      │
│  │              │    │  tokens)     │    │              │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                             │                                    │
│                             ▼                                    │
│                      ┌──────────────┐                           │
│                      │ Token file   │                           │
│                      │ /tmp/usage   │                           │
│                      └──────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation

**New file: `worker/src/proxy/anthropic-proxy.ts`**

```typescript
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'fs';

const app = express();
const USAGE_FILE = '/tmp/claude_usage.json';

// Initialize usage tracking
let totalUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

// Proxy all requests to Anthropic API
app.use('/v1/messages', createProxyMiddleware({
  target: 'https://api.anthropic.com',
  changeOrigin: true,
  selfHandleResponse: true,
  onProxyRes: async (proxyRes, req, res) => {
    let body = '';

    proxyRes.on('data', (chunk) => {
      body += chunk.toString();
      res.write(chunk);
    });

    proxyRes.on('end', () => {
      try {
        const response = JSON.parse(body);
        if (response.usage) {
          totalUsage.inputTokens += response.usage.input_tokens || 0;
          totalUsage.outputTokens += response.usage.output_tokens || 0;

          if (response.usage.cache_creation_input_tokens) {
            totalUsage.cacheCreationTokens += response.usage.cache_creation_input_tokens;
          }
          if (response.usage.cache_read_input_tokens) {
            totalUsage.cacheReadTokens += response.usage.cache_read_input_tokens;
          }

          // Write cumulative usage to file
          fs.writeFileSync(USAGE_FILE, JSON.stringify(totalUsage));
          console.log(`[proxy] Token usage: ${JSON.stringify(totalUsage)}`);
        }
      } catch (e) {
        // Non-JSON response (streaming), ignore
      }
      res.end();
    });
  },
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', usage: totalUsage });
});

// Start proxy server
const PORT = 8080;
app.listen(PORT, () => {
  console.log(`[proxy] Anthropic proxy listening on port ${PORT}`);
  // Initialize empty usage file
  fs.writeFileSync(USAGE_FILE, JSON.stringify(totalUsage));
});
```

**Update `worker/entrypoint.sh`**:

```bash
# Start proxy in background
echo "[worker] Starting Anthropic API proxy..."
node /app/proxy/anthropic-proxy.js &
PROXY_PID=$!
sleep 2

# Point Claude Code CLI to proxy
export ANTHROPIC_API_URL="http://localhost:8080"

# Run Claude Code as normal
claude --print --model "${CLAUDE_MODEL:-sonnet}" --dangerously-skip-permissions "${PROMPT}" 2>&1 | tee "${OUTPUT_FILE}"
EXIT_CODE=$?

# Stop proxy
kill $PROXY_PID 2>/dev/null || true

# Read captured token usage
if [ -f /tmp/claude_usage.json ]; then
    USAGE=$(cat /tmp/claude_usage.json)
    INPUT_TOKENS=$(echo "$USAGE" | jq -r '.inputTokens // 0')
    OUTPUT_TOKENS=$(echo "$USAGE" | jq -r '.outputTokens // 0')
    CACHE_CREATION_TOKENS=$(echo "$USAGE" | jq -r '.cacheCreationTokens // 0')
    CACHE_READ_TOKENS=$(echo "$USAGE" | jq -r '.cacheReadTokens // 0')

    echo "[worker] Captured token usage from proxy:"
    echo "[worker]   Input: ${INPUT_TOKENS}"
    echo "[worker]   Output: ${OUTPUT_TOKENS}"
    echo "[worker]   Cache Creation: ${CACHE_CREATION_TOKENS}"
    echo "[worker]   Cache Read: ${CACHE_READ_TOKENS}"
else
    echo "[worker] WARNING: No token usage captured"
    INPUT_TOKENS=0
    OUTPUT_TOKENS=0
    CACHE_CREATION_TOKENS=0
    CACHE_READ_TOKENS=0
fi
```

**Update `worker/Dockerfile`**:

```dockerfile
# Add proxy dependencies
RUN npm install express http-proxy-middleware

# Copy proxy code
COPY src/proxy /app/proxy
```

---

## Phase 3: Direct SDK Migration (Long-term)

For the most reliable solution, replace Claude Code CLI with a custom agent implementation. This aligns with the multi-provider support plan.

### Benefits

1. **Full token visibility** - Direct access to `response.usage`
2. **Cache token tracking** - Anthropic SDK exposes `cache_creation_input_tokens`
3. **Multi-provider ready** - Same architecture works for OpenAI, Google
4. **Better error handling** - Programmatic control over retries, timeouts

### Implementation Reference

See `docs/multi-provider-implementation-plan.md` Phase 5 for the agent implementation pattern. The Anthropic agent would look similar to the OpenAI agent but using `@anthropic-ai/sdk`.

---

## Files to Modify

### Phase 1 (Investigation)

| File | Change |
|------|--------|
| `worker/entrypoint.sh` | Add CLI capability checks |

### Phase 2 (Proxy)

| File | Change |
|------|--------|
| `worker/src/proxy/anthropic-proxy.ts` | **NEW** - Proxy server |
| `worker/entrypoint.sh` | Start proxy, read usage file |
| `worker/Dockerfile` | Add proxy dependencies |
| `worker/package.json` | Add express, http-proxy-middleware |

### Phase 3 (SDK Migration)

See `docs/multi-provider-implementation-plan.md` for full file list.

---

## Verification Plan

### Test 1: Verify Token Capture

1. Deploy updated worker container
2. Create test Jira ticket with `workermill` label
3. Wait for task to complete
4. Check task in database: `SELECT input_tokens, output_tokens, estimated_cost_usd FROM worker_tasks WHERE ...`
5. Verify tokens > 0 and cost > 0

### Test 2: Verify Cost Accuracy

1. Run a task with known prompt size
2. Check Anthropic dashboard for actual usage
3. Compare with WorkerMill's recorded usage
4. Variance should be < 5%

### Test 3: Verify Dashboard Display

1. Open WorkerMill dashboard
2. Check "Cumulative Cost" stat card
3. Verify it shows non-zero value
4. Check individual task costs in task list

### Test 4: Verify Cache Token Tracking

1. Run two similar tasks in sequence
2. Second task should show cache_read_tokens > 0
3. Cost should be lower due to cache hits

---

## Rollback Plan

If the proxy approach causes issues:

1. Remove `ANTHROPIC_API_URL` environment variable
2. Claude Code CLI will revert to direct API calls
3. Token tracking returns to `0` (current behavior)
4. No data loss, just missing cost data

---

## Success Criteria

- [ ] Tasks show non-zero `inputTokens` and `outputTokens`
- [ ] `estimatedCostUsd` calculated correctly (matches manual calculation)
- [ ] Dashboard "Cumulative Cost" displays real value
- [ ] Cache tokens tracked for prompt caching optimization
- [ ] No increase in task execution time (< 5% overhead)
- [ ] No increase in task failure rate

---

## Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Investigation | 2 hours | None |
| Phase 2: Proxy Implementation | 6-8 hours | Phase 1 results |
| Phase 3: SDK Migration | 12-16 hours | Multi-provider plan |

**Recommended**: Complete Phases 1-2 first for immediate fix, then Phase 3 as part of multi-provider work.

---

## Appendix: Current Code References

### Token Extraction (Broken)

**File**: `worker/entrypoint.sh` (lines 372-390)

```bash
# Extract token counts from output if available
INPUT_TOKENS=$(grep '::input_tokens::' "${OUTPUT_FILE}" 2>/dev/null | head -1 | sed 's/.*::input_tokens:://' || echo "0")
OUTPUT_TOKENS=$(grep '::output_tokens::' "${OUTPUT_FILE}" 2>/dev/null | head -1 | sed 's/.*::output_tokens:://' || echo "0")
CACHE_CREATION_TOKENS=$(grep '::cache_creation_tokens::' "${OUTPUT_FILE}" 2>/dev/null | head -1 | sed 's/.*::cache_creation_tokens:://' || echo "0")
CACHE_READ_TOKENS=$(grep '::cache_read_tokens::' "${OUTPUT_FILE}" 2>/dev/null | head -1 | sed 's/.*::cache_read_tokens:://' || echo "0")

# Clean up token values (remove any non-numeric characters)
INPUT_TOKENS=$(echo "$INPUT_TOKENS" | tr -cd '0-9' || echo "0")
OUTPUT_TOKENS=$(echo "$OUTPUT_TOKENS" | tr -cd '0-9' || echo "0")
CACHE_CREATION_TOKENS=$(echo "$CACHE_CREATION_TOKENS" | tr -cd '0-9' || echo "0")
CACHE_READ_TOKENS=$(echo "$CACHE_READ_TOKENS" | tr -cd '0-9' || echo "0")

# Default to 0 if empty
[ -z "$INPUT_TOKENS" ] && INPUT_TOKENS=0
[ -z "$OUTPUT_TOKENS" ] && OUTPUT_TOKENS=0
[ -z "$CACHE_CREATION_TOKENS" ] && CACHE_CREATION_TOKENS=0
[ -z "$CACHE_READ_TOKENS" ] && CACHE_READ_TOKENS=0

echo "[worker] Token usage: input=${INPUT_TOKENS}, output=${OUTPUT_TOKENS}, cache_creation=${CACHE_CREATION_TOKENS}, cache_read=${CACHE_READ_TOKENS}"
```

### Cost Calculation (Working, but Fed Zeros)

**File**: `api/src/models/WorkerTask.ts`

```typescript
calculateCost(): number {
  const tokens: TokenUsage = {
    inputTokens: this.inputTokens || 0,
    outputTokens: this.outputTokens || 0,
    cacheCreationTokens: this.cacheCreationTokens || 0,
    cacheReadTokens: this.cacheReadTokens || 0,
  };
  const durationSeconds = this.ecsTaskSeconds || this.getDurationSeconds() || 0;
  return calculateTotalCost(tokens, this.workerModel || "sonnet", durationSeconds);
}
```

### Pricing Configuration (Working)

**File**: `api/src/config/pricing.ts`

```typescript
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": {
    input: 0.001,    // $1.00 per 1M tokens
    output: 0.005,   // $5.00 per 1M tokens
    cacheWrite: 0.00125,
    cacheRead: 0.0001,
  },
  // ... other models
};

export function calculateTotalCost(
  tokens: TokenUsage,
  model: string,
  durationSeconds: number
): number {
  const claudeCost = calculateClaudeCost(tokens, model);
  const ecsCost = calculateEcsCost(durationSeconds);
  return claudeCost + ecsCost;
}
```

### API Endpoint (Working, but Receives Zeros)

**File**: `api/src/routes/tasks.ts` (lines 396-416)

```typescript
// Update token counts
task.inputTokens = (task.inputTokens || 0) + (inputTokens || 0);
task.outputTokens = (task.outputTokens || 0) + (outputTokens || 0);
task.cacheCreationTokens = (task.cacheCreationTokens || 0) + (cacheCreationTokens || 0);
task.cacheReadTokens = (task.cacheReadTokens || 0) + (cacheReadTokens || 0);

// Calculate ECS duration
if (task.startedAt) {
  task.ecsTaskSeconds = Math.floor((Date.now() - task.startedAt.getTime()) / 1000);
}

// Calculate cost
task.estimatedCostUsd = task.calculateCost();
```
