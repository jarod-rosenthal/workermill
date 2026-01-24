# Multi-Persona Single Container Test Harness

This test harness proves out the core concept of executing multiple personas sequentially in a single container with fresh context windows and structured handoff.

## What It Tests

1. **Sequential subtask execution** - Multiple personas run one after another
2. **Fresh context per subtask** - Each `claude --print` invocation starts clean
3. **Context handoff** - File-based mock of WorkerContext API
4. **Git commits per subtask** - Each persona's work is committed separately

## Prerequisites

- **Claude Code CLI**: `npm install -g @anthropic-ai/claude-code`
- **jq**: `apt install jq` or `brew install jq`
- **ANTHROPIC_API_KEY**: Set in environment

## Usage

```bash
cd test-multi-persona

# Dry run - shows prompts without executing Claude (free, good for testing setup)
./run-test.sh --dry-run

# Full run - executes Claude for each subtask (costs API credits)
./run-test.sh
```

## Files

| File | Purpose |
|------|---------|
| `run-test.sh` | Main orchestration script |
| `helpers.sh` | Context store functions (mock WorkerContext API) |
| `subtasks.json` | Test scenario definition |
| `context-store.json` | Generated - stores inter-persona messages |
| `test-repo/` | Generated - disposable git repo for test |
| `prompt-*.txt` | Generated - prompts sent to Claude |
| `output-*.txt` | Generated - Claude's responses |

## Test Scenario

The default `subtasks.json` defines a simple 3-step workflow:

1. **Backend Developer** - Create greeting API endpoint
2. **Frontend Developer** - Create UI component using the API
3. **QA Engineer** - Add validation and tests

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│ run-test.sh                                                 │
│                                                             │
│  1. Init test-repo/ with git                                │
│  2. Reset context-store.json                                │
│  3. Post initial "constraints" context                      │
│                                                             │
│  for each subtask:                                          │
│    ┌─────────────────────────────────────────────────────┐  │
│    │ a. fetch_context() - read previous persona messages │  │
│    │ b. Load persona directive from worker/directives/   │  │
│    │ c. Build prompt with context + directive            │  │
│    │ d. claude --print < prompt.txt                      │  │
│    │ e. git commit -m "[persona] subtask title"          │  │
│    │ f. Claude calls post_context() during execution     │  │
│    └─────────────────────────────────────────────────────┘  │
│                                                             │
│  4. Show final context store and git log                    │
└─────────────────────────────────────────────────────────────┘
```

## Context Handoff

Claude outputs context markers as plain text, which the shell script parses and posts to the context store. This matches production behavior where the orchestrator parses output, not Claude calling bash functions.

**Claude outputs markers like:**
```
::context::decision::Using Express.js for the API
::context::file_created::src/api.js - greeting endpoint
::context::completion::API ready at GET /api/greet/:name
```

**The shell script:**
1. Parses these markers from Claude's output
2. Calls `post_context()` for each marker found
3. Validates that at least one `::context::completion::` marker exists

The next persona sees these messages in their prompt under "Previous Developer Context".

## Customizing the Test

Edit `subtasks.json` to test different scenarios:

```json
{
  "taskId": "test-002",
  "title": "Your custom task",
  "subtasks": [
    {
      "index": 0,
      "title": "First step",
      "description": "What the first persona should do",
      "persona": "backend_developer"
    },
    {
      "index": 1,
      "title": "Second step",
      "description": "What the second persona should do",
      "persona": "frontend_developer"
    }
  ]
}
```

## Expected Output

After a successful run:

```
test-multi-persona/
├── context-store.json     # Full conversation between personas
├── test-repo/
│   ├── .git/
│   ├── package.json
│   ├── README.md
│   └── src/
│       ├── api.js         # Created by backend_developer
│       ├── Greeting.jsx   # Created by frontend_developer
│       └── api.test.js    # Created by qa_engineer
├── prompt-0-backend_developer.txt
├── prompt-1-frontend_developer.txt
├── prompt-2-qa_engineer.txt
├── output-0-backend_developer.txt
├── output-1-frontend_developer.txt
└── output-2-qa_engineer.txt
```

## Cleanup

```bash
# Remove all generated files
rm -rf test-repo context-store.json prompt-*.txt output-*.txt
```

## Differences from Production

| Aspect | Test Harness | Production |
|--------|--------------|------------|
| Context storage | JSON file | PostgreSQL via WorkerContext API |
| Observability | Log files | SSE streaming to dashboard |
| Container | Local shell | ECS Fargate |
| Directives | Symlinked from worker/ | Baked into Docker image |

The core execution loop is identical - proving it works here means it will work in production.
