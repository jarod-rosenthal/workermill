# Executor Migration: universal-agent.js → Provider-Native Executors

**Started**: 2025-01-16
**Status**: In Progress
**Goal**: Replace custom universal-agent.js with provider-native agent implementations

## Background

The universal-agent.js was a custom agent loop supporting multiple LLM providers. However, it became a maintenance burden with issues like:
- Test deduplication (running same tests 3x)
- Glob pattern bugs (searching wrong directories)
- Task understanding confusion
- Rate limit handling
- No structured ReAct loop

Each fix added technical debt. The better approach is to use provider-native agent implementations.

## Architecture

```
entrypoint.sh
    │
    ├── provider=anthropic → Claude Code CLI (existing, works well)
    │
    ├── provider=openai → OpenAI Responses API executor (NEW)
    │
    └── provider=ollama → LangGraph ReAct executor (NEW)
```

## Implementation Plan

### Phase 1: OpenAI Responses API Executor
- [x] Create `worker/agents/openai-executor.js`
- [x] Implement tool definitions for Responses API format
- [x] Add conversation/state management
- [ ] Test with gpt-4o and gpt-5.1-codex
- [x] Update entrypoint.sh to route to new executor

### Phase 2: LangGraph Ollama Executor
- [x] Create `worker/agents/langgraph-executor.py`
- [x] Install langgraph + langchain-ollama in Dockerfile
- [x] Implement ReAct agent with same tool set
- [x] Add proper state tracking (avoid test re-runs)
- [ ] Test with llama3.1:8b (best tool calling) and qwen2.5-coder
- [x] Update entrypoint.sh to route to new executor

### Phase 3: Cleanup
- [ ] Deprecate universal-agent.js (keep for reference)
- [ ] Update documentation
- [x] Deploy and validate all three paths (in progress)

## File Inventory

### New Files to Create
- `worker/agents/openai-executor.js` - OpenAI Responses API executor
- `worker/agents/langgraph-executor.py` - LangGraph ReAct executor
- `worker/agents/tools.py` - Shared tool definitions for LangGraph

### Files to Modify
- `worker/entrypoint.sh` - Route to correct executor based on provider
- `worker/Dockerfile` - Add Python dependencies for LangGraph

### Files to Eventually Deprecate
- `worker/agents/universal-agent.js` - Current custom agent loop

## Progress Log

### 2025-01-16 - Session 1

**Completed:**
- [x] Created this progress tracking file
- [x] Analyzed architecture and decided on approach
- [x] Created OpenAI Responses API executor (`openai-executor.js`)
- [x] Created LangGraph ReAct executor (`langgraph-executor.py`)
- [x] Added Python dependencies to Dockerfile (langgraph, langchain-ollama, langchain-core)
- [x] Updated entrypoint.sh routing:
  - `openai` → openai-executor.js
  - `ollama` → langgraph-executor.py
  - `gemini|groq|mistral|azure` → universal-agent.js (fallback)

### 2025-01-16 - Session 2

**Issue Found:**
- LangGraph executor failed with `state_modifier` parameter error
- The LangGraph API changed in v1.0 - `state_modifier` and `state_schema` no longer supported

**Fixed:**
- [x] Updated `create_react_agent` call to use `messages_modifier` instead of deprecated `state_modifier`
- [x] Simplified state to just `{"messages": [...]}` for LangGraph v1.0+
- [x] Changed default to use manual ReAct loop (more control, better error handling)
- [x] Updated Dockerfile to install latest LangGraph versions:
  - langgraph 1.0.6
  - langchain-core 1.2.7
  - langchain-ollama 1.0.1
  - langchain 1.2.6
- [x] Deployed worker:75

**Testing:**
- Created OCS-351 to test fixed executor with qwen3-coder:30b

**Results: OCS-351 SUCCESS ✅**
- LangGraph executor started and routed correctly
- Model (qwen3-coder:30b) loaded and responded
- Tool calls executed successfully (bash, read_file, write_file)
- 34 iterations of ReAct loop completed
- Created 3 files in oncallshift repo:
  - `langgraph-react-executor.ts` (implementation)
  - `langgraph-react-executor.md` (documentation)
  - `langgraph-react-executor.test.ts` (tests)
- Pushed branch ai/OCS-351 and created PR
- Added Jira comment and transitioned to Done
- Cost: $0.0016

**Next Steps:**
- Test OpenAI executor with gpt-4o
- Verify all three executor paths work end-to-end

### 2025-01-17 - Session 3

**Testing OCS-352 with Improved System Prompt:**
- Enhanced DEFAULT_SYSTEM_PROMPT with explicit JIRA WORKFLOW section
- Increased context window to 82K tokens
- Added warning about not reading directories (use glob first)

**Results: OCS-352 PARTIAL SUCCESS ⚠️**
- ✅ LangGraph executor started correctly
- ✅ Model (qwen3-coder:30b) made correct code changes:
  - Created `backend/src/api/routes/health.ts` with health check endpoint
  - Modified `backend/src/api/app.ts` to register the route
  - Build passed (`npm run build`)
- ✅ Created branch ai/OCS-352, committed, pushed
- ✅ Created PR #225: https://github.com/jarod-rosenthal/pagerduty-lite/pull/225
- ❌ **Did NOT add Jira comments** (used echo instead of add_comment.js)
- ❌ **Did NOT transition ticket to Done**
- ⚠️ **Scope creep**: Rewrote entire README.md (unnecessary)
- ⚠️ **Wasted iterations**: Used echo commands for status reporting (iterations 34-40)

**Root Cause Analysis:**
The qwen3-coder:30b model has poor instruction following for:
1. Calling execution scripts (uses echo instead of actual scripts)
2. Following explicit workflow steps in system prompt
3. Staying within task scope (added unnecessary README changes)

**Comparison with Other Executors:**
| Executor | Tool Calling | Jira Updates | Scope Control |
|----------|--------------|--------------|---------------|
| Claude Code CLI | ✅ Excellent | ✅ Excellent | ✅ Excellent |
| OpenAI (gpt-5.1-codex) | ✅ Good | ✅ Good | ✅ Good |
| LangGraph + qwen3-coder | ✅ Works | ❌ Fails | ❌ Poor |

**Recommendation:**
Based on testing, the local qwen3-coder model is not suitable for production use:
1. Does not follow Jira workflow instructions
2. Has scope creep issues
3. Wastes iterations on echo commands

**Recommended Next Step:**
Switch to **OpenAI GPT-4o** for reliable tool calling:
- Already implemented in openai-executor.js
- Proven reliable with gpt-5.1-codex
- Pay-per-use (~$0.01-0.05 per task)
- No local infrastructure needed

**Alternative: Llama 3.1 8B**
Research shows Llama 3.1 8B-Instruct has the best tool calling of Ollama models:
- Much smaller (6GB VRAM vs 20GB for qwen3-coder:30b)
- Specifically optimized by Meta for function calling
- Could test as a quick alternative before switching to OpenAI

---

## Technical Notes

### OpenAI Responses API
- Endpoint: `POST /v1/responses`
- Supports: `gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini`, `gpt-5.1-codex`
- Built-in tools: `code_interpreter`, `file_search`, `web_search`, `computer_use`
- Custom tools: Function definitions similar to chat completions
- Key difference: Manages conversation state server-side

### LangGraph ReAct
- `create_react_agent()` provides structured Thought → Action → Observation loop
- Explicit state management prevents repeated actions
- Checkpointing allows resume on failure
- Works with any LangChain-compatible model

### Tool Parity Required
Both executors need these tools:
1. `bash` - Execute shell commands
2. `read_file` - Read file contents
3. `write_file` - Write file contents
4. `edit_file` - Search/replace in files
5. `glob` - Find files by pattern
6. `grep` - Search file contents

---

### 2025-01-17 - Session 4

**Research: Best Local LLM for Tool Calling**

Web research on Berkeley Function Calling Leaderboard (BFCL) found:
- Docker's practical evaluation (3,570 test cases) shows:
  - **qwen3:14b** achieves **0.971 F1 score** (nearly matches GPT-4)
  - **qwen3:8b** achieves **0.933 F1 score**
- Key insight: Use `qwen3` (general), NOT `qwen3-coder` for tool calling
- `qwen3-coder` is optimized for code generation, not function calling

**Switch to qwen3:30b**

User downloaded qwen3:30b (general model) instead of qwen3-coder:30b.

**OCS-353 Test with qwen3:30b**

Created ticket: "Security audit for rate limiting"

**Results: MUCH BETTER ⚠️**
- ✅ Worker completed in ~1 minute, 7 iterations
- ✅ Created `backend/security/audit/api-rate-limiting.md` (61 lines)
- ✅ Actually READ the rate-limiter.ts file before writing report
- ⚠️ First glob call had wrong parameters (passed Jira comment text)
- ❌ No Jira analysis comment at START

**System Prompt Rewrite**

Rewrote DEFAULT_SYSTEM_PROMPT in langgraph-executor.py with:
1. **CRITICAL: YOUR FIRST ACTION** section at very top - explicit Jira comment requirement
2. **Explicit tool parameter examples** - showing correct usage
3. **WRONG examples** - `glob(TICKET_KEY=...) - glob does NOT take TICKET_KEY!`
4. Clear workflow steps
5. Deployed worker:78

**OCS-354 Test with Improved System Prompt**

Created ticket: "Add request logging middleware to track API usage"

**Results: SUCCESS ✅**

| Metric | Result |
|--------|--------|
| **Jira Comment at START** | ✅ Yes - "🔍 **Analysis**: I will add request logging middleware..." |
| **Tool Parameters** | ✅ All correct (glob, write_file, edit_file, read_file) |
| **Code Quality** | ✅ Clean middleware with structured logging |
| **PR Created** | ✅ https://github.com/jarod-rosenthal/pagerduty-lite/pull/227 |
| **Jira Updated** | ✅ PR link added as comment |
| **Iterations** | 8 |
| **Cost** | $0.0007 |

**Detailed Workflow:**
1. ✅ Iteration 1: Added Jira analysis comment FIRST
2. ✅ Iteration 2: Glob with correct pattern `**/middleware/*.ts`
3. ✅ Iteration 3: Created `request-logger.ts` (629 bytes)
4. ⚠️ Iteration 4-7: Tried to edit existing files but old_string didn't match
5. ✅ Iteration 8: Gave up after edit failures
6. ✅ Validation script rescued: auto-committed, pushed, created PR
7. ✅ Jira comment with PR link added

**Key Improvements Achieved:**
- ✅ Jira comments now added at START (system prompt fix worked!)
- ✅ Correct tool parameters (explicit examples prevented confusion)
- ✅ No scope creep (stayed focused on task)
- ⚠️ Model gives up after 2 edit_file failures (could be improved)

**Comparison: qwen3:30b vs qwen3-coder:30b**

| Aspect | qwen3-coder:30b | qwen3:30b |
|--------|-----------------|-----------|
| Jira Comments | ❌ Used echo instead | ✅ Correct script |
| Tool Parameters | ⚠️ Confused | ✅ Correct |
| Scope Control | ❌ Added README | ✅ Focused |
| Speed | ~2 min | ~1 min |
| F1 Score (BFCL) | Unknown | ~0.97 |

**Conclusion:**
qwen3:30b with improved system prompt is now working as expected:
1. Adds Jira comment at start ✅
2. Uses correct tool parameters ✅
3. Creates code changes ✅
4. Creates PR ✅
5. Updates Jira with PR link ✅

**Remaining Issue:**
Model gives up after 2 edit_file failures. Could add retry logic or examples of reading file first before editing.

**Next Steps:**
1. Test more complex tasks to verify reliability
2. Consider adding "read file before edit" guidance
3. Test OpenAI executor for comparison

---

### 2025-01-17 - Session 5

**Research on Best Practices**

Researched LangGraph error handling and found key improvements from:
- [LangGraph Retry Policies](https://dev.to/aiengineering/a-beginners-guide-to-handling-errors-in-langgraph-with-retry-policies-h22)
- [Cursor Agent System Prompt](https://gist.github.com/sshh12/25ad2e40529b269a88b80e7cf1c38084)
- [LLM Function Calling Best Practices](https://github.com/bluma05/llm-function-calling-system-prompts-paper)

**Gaps Identified:**

| Gap | Source | Fix |
|-----|--------|-----|
| No "read before edit" rule | Cursor Prompt | Added CRITICAL EDITING RULES section |
| No retry guidance for edit failures | LangGraph docs | StateManager tracks failures, injects guidance |
| No fallback to write_file | Best practices | System prompt suggests write_file after 2 failures |
| Token counting broken | Our logs | Added usage_metadata extraction from ChatOllama |
| Backticks in comments cause bash errors | OCS-355 test | Added warning about avoiding backticks |
| Model retries same failed command in loop | OCS-355 test | Added check_bash_loop() detection |

**Improvements Implemented:**

1. **System Prompt Updates:**
   - Added `CRITICAL EDITING RULES` section emphasizing read before edit
   - Added warning about backticks in Jira comments (bash interprets as command substitution)
   - Added "Maximum 3 edit attempts per file, then use write_file"

2. **StateManager Enhancements:**
   - `record_edit_failure()` / `clear_edit_failures()` - track failures per file
   - `get_edit_guidance()` - returns escalating guidance (read first → try write_file → move on)
   - `check_bash_loop()` - detects when same command repeated 3+ times
   - `_commands_similar()` - identifies similar commands (e.g., all add_comment.js calls)

3. **Manual Loop Improvements:**
   - Inject guidance after edit_file failures
   - Detect and break out of command loops
   - Track token usage from `response.usage_metadata`

**OCS-355 Test Results (Before Loop Fix):**

| Iteration | Action | Result |
|-----------|--------|--------|
| 1 | Add Jira analysis comment | ✅ Success |
| 2 | glob for server files | ✅ Found 3 files |
| 3 | read_file server.ts | ✅ Success |
| 4 | read_file app.ts | ✅ Success |
| 5 | read_file request-id.ts | ✅ Found existing middleware! |
| 6-10 | Try to add completion comment | ⚠️ Loop - backticks caused bash error |

The model correctly identified that `request-id.ts` already implements correlation ID middleware!
But it got stuck in a loop because backticks in the Jira comment triggered bash command substitution errors.

**Deployed:**
- worker:79 with read-before-edit and retry guidance
- worker:80 with loop detection and backtick warning

**Status:**
LangGraph executor now has comprehensive error handling:
- ✅ Guides model to read before edit
- ✅ Provides escalating fallback strategy (retry → write_file → move on)
- ✅ Detects and breaks command loops
- ✅ Tracks token usage
- ✅ Warns about bash escaping issues

---

### 2025-01-17 - Session 6

**OCS-356 Test Results: SUCCESS (with bugfix needed) ✅**

| Metric | Result |
|--------|--------|
| **Jira Comment at START** | ✅ Yes |
| **Read Before Edit** | ✅ Yes - read app.ts before editing |
| **Edit Success** | ✅ First try (because of read-before-edit) |
| **Completion Comment** | ✅ Added |
| **Iterations** | 7 (very efficient!) |
| **Duration** | ~1.5 minutes |
| **Token Usage** | 188,961 input, 8,206 output |

**Bug Found: Fake PR URL Trusted**

The model output `::pr_url::https://github.com/oncallshift/api/pull/123` - a fake URL for the wrong repo!
The entrypoint blindly trusted the `::pr_url::` marker and set `PR_CREATED=true`, which prevented the validation section from creating the real PR.

**Fix Applied (worker:81):**

Updated `entrypoint.sh` to validate PR URLs before trusting them:

```bash
if grep -q "::pr_url::" "${OUTPUT_FILE}"; then
    # Extract the URL from the marker and validate it's for the correct repo
    DETECTED_PR_URL=$(grep '::pr_url::' "${OUTPUT_FILE}" | head -1 | sed 's/.*::pr_url:://')
    if echo "${DETECTED_PR_URL}" | grep -qE "github\.com/${GITHUB_REPO}/pull/[0-9]+"; then
        PR_CREATED=true
        PR_URL="${DETECTED_PR_URL}"
        # ...
    else
        post_log "system" "[warning] Agent output invalid PR URL (wrong repo): ${DETECTED_PR_URL}"
        post_log "system" "[warning] Expected repo: ${GITHUB_REPO}"
    fi
fi
```

Now the validation section will:
1. Detect the fake PR URL
2. Log a warning
3. Leave `PR_CREATED=false`
4. Create the real PR via `gh pr create`

**Next: Test with OCS-357 to verify the fix**
