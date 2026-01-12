# Multi-Provider AI Support Implementation Plan

**Status**: Planning
**Created**: 2026-01-11
**Updated**: 2026-01-12
**Estimated Effort**: ~45 hours (full implementation) / ~8 hours (agent-mode providers only)

## Overview

Enable WorkerMill to support multiple AI providers beyond the current Anthropic/Claude-only integration. This allows organizations to use OpenAI, Google Gemini, or local Ollama models while maintaining Claude as the default.

### Key Insight: It's Simpler Than It Looks

**If a provider supports agent mode (file editing, bash execution, multi-turn), the changes are minimal:**

| Change | Location | Effort |
|--------|----------|--------|
| Install different CLI | `worker/Dockerfile` | 1 line |
| Different invoke command | `worker/entrypoint.sh` | ~5 lines |
| Different API key env var | `entrypoint.sh` + orchestrator | 2 lines |
| Log parsing (for token tracking) | `worker/scripts/log-parser.cjs` | Optional |

The directives, execution scripts, and output markers are **already provider-agnostic**.

### What's Already Provider-Agnostic

| Component | Why It's Portable |
|-----------|-------------------|
| **Directives** (`worker/directives/`) | Plain markdown - any LLM can read them |
| **AGENTS.md** | Plain markdown instructions |
| **Execution scripts** (`worker/execution/`) | Node.js scripts for git, Jira, deploy - no AI dependency |
| **Output markers** (`::result::`, `::pr_url::`) | Convention we define - any agent can output them |
| **Git workflow** | Standard git operations |

### No Universal Standard for Agent Instructions

Each AI coding tool invented its own convention:

| Tool | Instruction File |
|------|------------------|
| Claude Code | `CLAUDE.md` |
| Cursor | `.cursorrules` or `.cursor/rules/` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Aider | `.aider.conf.yml` |
| Windsurf/Codeium | Custom settings |

WorkerMill uses `AGENTS.md` + `directives/` which any LLM can understand since they're plain markdown.

### Design Principles

1. **No breaking changes** - Anthropic/Claude remains the default provider
2. **Per-organization API keys** - Each org brings their own keys (BYOK)
3. **Per-task provider selection** - Jira labels control which provider runs each task
4. **Unified cost tracking** - All providers feed into the same cost tracking system

---

## Current State

| Component | Current Implementation |
|-----------|----------------------|
| Worker Execution | `claude --print --model sonnet` CLI |
| API Keys | Single `ANTHROPIC_API_KEY` in AWS Secrets Manager |
| Pricing | Hardcoded Claude rates in `api/src/config/pricing.ts` |
| Model Selection | Jira labels: `haiku`, `sonnet`, `opus` |
| Database | `workerModel` column stores Claude model ID only |

---

## UI-First Implementation Approach

Start by exposing provider settings in the UI, then connect to the backend. This allows validating the UX before building the full infrastructure.

### Step 1: Settings UI Changes (`frontend/src/pages/Settings.tsx`)

Add a new "AI Provider" section:

```
┌─────────────────────────────────────────────────────────────┐
│ 🤖 AI Provider                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Provider:     [Claude ▼] [OpenAI ▼] [Gemini ▼]  (tabs)     │
│                                                             │
│ API Key:      [••••••••••••••••••] 👁 [Test] [Save]        │
│               ✓ Connected                                   │
│                                                             │
│ Default Model: [claude-sonnet-4 ▼]  <- changes per provider │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Frontend data structure:**

```typescript
interface Settings {
  // ... existing fields

  // AI Provider Settings (NEW)
  aiProvider: 'claude' | 'openai' | 'gemini';
  defaultWorkerModel: string;  // values change per provider
}

const PROVIDER_MODELS = {
  claude: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "o1", label: "o1" },
  ],
  gemini: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
};
```

### Step 2: Backend Schema (`api/src/models/Organization.ts`)

Add `aiProvider` column to store selected provider.

### Step 3: Settings API (`api/src/routes/settings.ts`)

- Add provider to GET/PUT endpoints
- Add `/integrations/{provider}` endpoints for API key management

### Step 4: Migration

Create migration to add `ai_provider` column with default `'claude'`.

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Jira Webhook                                 │
│         Labels: workermill, provider:openai, gpt-4o             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   API: webhooks.ts                               │
│     Parse provider label → Set task.workerProvider = 'openai'   │
│     Parse model label → Set task.workerModel = 'gpt-4o'         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               ECS Task Runner                                    │
│     Fetch org's OpenAI API key from Secrets Manager             │
│     Pass WORKER_PROVIDER=openai, OPENAI_API_KEY=sk-...          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               Worker Container (entrypoint.sh)                   │
│                                                                  │
│     case "$WORKER_PROVIDER" in                                  │
│       anthropic) claude --print --model "$MODEL" "$PROMPT" ;;   │
│       openai)    node /app/agents/openai-agent.js ;;            │
│       google)    node /app/agents/google-agent.js ;;            │
│       ollama)    node /app/agents/ollama-agent.js ;;            │
│     esac                                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               Provider Agent (e.g., openai-agent.ts)            │
│                                                                  │
│     - Initialize SDK with API key                               │
│     - Execute with function calling (tools)                     │
│     - Report tokens via standard markers                        │
│     - Output: ::result::, ::pr_url::, ::input_tokens::          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               Cost Calculation                                   │
│                                                                  │
│     getPricingEngine(task.workerProvider)                       │
│       .calculateTotalCost(tokens, model, duration)              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files to Modify

### API Layer

| File | Changes | Effort |
|------|---------|--------|
| `api/src/config/pricing.ts` | Refactor to use provider-based pricing engines | 4h |
| `api/src/config/index.ts` | Add `getProviderCredentials()` for multi-provider secrets | 2h |
| `api/src/models/Organization.ts` | Add `primaryProvider`, `providerSettings` columns | 1h |
| `api/src/models/WorkerTask.ts` | Add `workerProvider` column, update `calculateCost()` | 2h |
| `api/src/routes/webhooks.ts` | Parse `provider:*` labels from Jira | 2h |
| `api/src/routes/settings.ts` | Add provider configuration endpoints | 3h |
| `api/src/services/ecs-task-runner.ts` | Pass provider + credentials to worker | 2h |

### New API Files

| File | Purpose | Effort |
|------|---------|--------|
| `api/src/providers/types.ts` | Provider interfaces and types | 1h |
| `api/src/providers/index.ts` | Provider registry and factory | 1h |
| `api/src/providers/anthropic/pricing.ts` | Claude pricing engine | 1h |
| `api/src/providers/openai/pricing.ts` | OpenAI pricing engine | 1h |
| `api/src/providers/google/pricing.ts` | Google pricing engine | 1h |
| `api/src/providers/ollama/pricing.ts` | Ollama pricing (compute-only) | 0.5h |

### Worker Layer

| File | Changes | Effort |
|------|---------|--------|
| `worker/entrypoint.sh` | Add provider dispatch logic | 2h |
| `worker/Dockerfile` | Install openai, @google/generative-ai packages | 0.5h |
| `worker/package.json` | Add SDK dependencies | 0.5h |

### New Worker Files

| File | Purpose | Effort |
|------|---------|--------|
| `worker/src/agents/base-agent.ts` | Common agent interface and utilities | 2h |
| `worker/src/agents/openai-agent.ts` | OpenAI SDK with function calling | 6h |
| `worker/src/agents/google-agent.ts` | Google Generative AI SDK agent | 4h |
| `worker/src/agents/ollama-agent.ts` | Ollama HTTP API agent | 3h |
| `worker/src/agents/tools/*.ts` | Shared tool implementations (git, github, jira) | 4h |

### Frontend

| File | Changes | Effort |
|------|---------|--------|
| `frontend/src/pages/Settings.tsx` | Provider selection UI, API key entry | 4h |
| `frontend/src/pages/Dashboard.tsx` | Show provider icon on tasks | 1h |

### Database Migrations

| Migration | Changes |
|-----------|---------|
| `AddProviderSupport.ts` | Add columns to organizations and worker_tasks |

---

## Implementation Phases

### Phase 1: Abstraction Layer (4 hours)

Create provider interfaces without changing current behavior.

**Files to create:**

```typescript
// api/src/providers/types.ts
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  tier: 'budget' | 'balanced' | 'powerful';
  inputRate: number;      // cost per 1K tokens
  outputRate: number;
  contextWindow: number;
  supportsStreaming: boolean;
  supportsCaching: boolean;
}

export interface ProviderPricingEngine {
  provider: string;
  getModels(): ModelInfo[];
  getModelInfo(modelId: string): ModelInfo | undefined;
  calculateTokenCost(tokens: TokenUsage, model: string): number;
  calculateTotalCost(tokens: TokenUsage, model: string, durationSeconds: number): number;
  validateModel(model: string): boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  pricingEngine: ProviderPricingEngine;
  defaultModel: string;
  requiresApiKey: boolean;
}
```

```typescript
// api/src/providers/index.ts
import { AnthropicPricingEngine } from './anthropic/pricing';
import { OpenAIPricingEngine } from './openai/pricing';
import { GooglePricingEngine } from './google/pricing';
import { OllamaPricingEngine } from './ollama/pricing';

const providers: Record<string, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    pricingEngine: new AnthropicPricingEngine(),
    defaultModel: 'claude-sonnet-4-20250514',
    requiresApiKey: true,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    pricingEngine: new OpenAIPricingEngine(),
    defaultModel: 'gpt-4o',
    requiresApiKey: true,
  },
  google: {
    id: 'google',
    name: 'Google',
    pricingEngine: new GooglePricingEngine(),
    defaultModel: 'gemini-2.0-flash',
    requiresApiKey: true,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    pricingEngine: new OllamaPricingEngine(),
    defaultModel: 'llama3.1:8b',
    requiresApiKey: false,
  },
};

export function getProvider(providerId: string): ProviderConfig {
  return providers[providerId] ?? providers.anthropic;
}

export function getPricingEngine(providerId: string): ProviderPricingEngine {
  return getProvider(providerId).pricingEngine;
}

export function listProviders(): ProviderConfig[] {
  return Object.values(providers);
}
```

### Phase 2: Database Schema (2 hours)

```typescript
// api/src/db/migrations/1704067200006-AddProviderSupport.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProviderSupport1704067200006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add provider column to worker_tasks
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN worker_provider VARCHAR(50) NOT NULL DEFAULT 'anthropic'
    `);

    // Add provider settings to organizations
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN primary_provider VARCHAR(50) NOT NULL DEFAULT 'anthropic',
      ADD COLUMN provider_settings JSONB NOT NULL DEFAULT '{}'
    `);

    // Create index for provider queries
    await queryRunner.query(`
      CREATE INDEX idx_worker_tasks_provider ON worker_tasks(worker_provider)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_worker_tasks_provider`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN provider_settings`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN primary_provider`);
    await queryRunner.query(`ALTER TABLE worker_tasks DROP COLUMN worker_provider`);
  }
}
```

**Model updates:**

```typescript
// api/src/models/Organization.ts - Add columns
@Column({ type: 'varchar', length: 50, default: 'anthropic' })
primaryProvider: string;

@Column({ type: 'jsonb', default: {} })
providerSettings: Record<string, any>;
// Structure: { openai: { configured: true }, google: { configured: false } }
```

```typescript
// api/src/models/WorkerTask.ts - Add column and update cost calc
@Column({ type: 'varchar', length: 50, default: 'anthropic' })
workerProvider: string;

calculateCost(): number {
  const engine = getPricingEngine(this.workerProvider);
  const tokens: TokenUsage = {
    inputTokens: this.inputTokens || 0,
    outputTokens: this.outputTokens || 0,
    cacheCreationTokens: this.cacheCreationTokens || 0,
    cacheReadTokens: this.cacheReadTokens || 0,
  };
  const durationSeconds = this.ecsTaskSeconds || this.getDurationSeconds() || 0;
  return engine.calculateTotalCost(tokens, this.workerModel, durationSeconds);
}
```

### Phase 3: Configuration & Secrets (4 hours)

**AWS Secrets Manager structure:**

```
workermill/dev/providers/anthropic  → { "apiKey": "sk-ant-..." }
workermill/dev/providers/openai     → { "apiKey": "sk-..." }
workermill/dev/providers/google     → { "apiKey": "...", "projectId": "..." }
```

**Config update:**

```typescript
// api/src/config/index.ts - Add function
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({ region: config.aws.region });
const credentialsCache = new Map<string, { value: any; expires: number }>();

export async function getProviderCredentials(
  orgId: string,
  provider: string
): Promise<Record<string, string>> {
  const cacheKey = `${orgId}:${provider}`;
  const cached = credentialsCache.get(cacheKey);

  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  // Try org-specific secret first
  const orgSecretId = `workermill/${config.environment}/orgs/${orgId}/providers/${provider}`;

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: orgSecretId })
    );
    const credentials = JSON.parse(response.SecretString || '{}');
    credentialsCache.set(cacheKey, { value: credentials, expires: Date.now() + 300000 });
    return credentials;
  } catch (err) {
    // Fall back to platform default (for anthropic only)
    if (provider === 'anthropic') {
      return { apiKey: config.secrets.anthropicApiKey };
    }
    throw new Error(`No credentials configured for provider: ${provider}`);
  }
}
```

### Phase 4: Jira Label System (3 hours)

```typescript
// api/src/routes/webhooks.ts - Update label parsing

const PROVIDER_LABELS: Record<string, string> = {
  'provider:openai': 'openai',
  'provider:google': 'google',
  'provider:ollama': 'ollama',
  'provider:anthropic': 'anthropic',
};

const MODEL_LABELS: Record<string, { provider: string; model: string }> = {
  // Anthropic (default provider)
  'haiku': { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  'sonnet': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'opus': { provider: 'anthropic', model: 'claude-opus-4-5-20251101' },

  // OpenAI
  'gpt-4o': { provider: 'openai', model: 'gpt-4o' },
  'gpt-4-turbo': { provider: 'openai', model: 'gpt-4-turbo' },
  'o1': { provider: 'openai', model: 'o1' },
  'o1-mini': { provider: 'openai', model: 'o1-mini' },

  // Google
  'gemini-flash': { provider: 'google', model: 'gemini-2.0-flash' },
  'gemini-pro': { provider: 'google', model: 'gemini-1.5-pro' },

  // Ollama
  'llama': { provider: 'ollama', model: 'llama3.1:8b' },
  'codellama': { provider: 'ollama', model: 'codellama:13b' },
};

function parseProviderAndModel(labels: string[]): { provider: string; model: string } {
  let provider = 'anthropic';  // Default
  let model = 'claude-sonnet-4-20250514';  // Default

  // Check for explicit provider label
  for (const label of labels) {
    if (PROVIDER_LABELS[label]) {
      provider = PROVIDER_LABELS[label];
      break;
    }
  }

  // Check for model label (may also set provider)
  for (const label of labels) {
    if (MODEL_LABELS[label]) {
      const modelInfo = MODEL_LABELS[label];
      model = modelInfo.model;
      // Model label can override provider if no explicit provider label
      if (!labels.some(l => PROVIDER_LABELS[l])) {
        provider = modelInfo.provider;
      }
      break;
    }
  }

  // If provider was set but no matching model, use provider's default
  if (provider !== 'anthropic' && model.startsWith('claude')) {
    const providerConfig = getProvider(provider);
    model = providerConfig.defaultModel;
  }

  return { provider, model };
}
```

### Phase 5: Worker Execution (20 hours)

**entrypoint.sh update:**

```bash
# worker/entrypoint.sh - Add provider dispatch

PROVIDER="${WORKER_PROVIDER:-anthropic}"
MODEL="${WORKER_MODEL:-sonnet}"

echo "[worker] Provider: ${PROVIDER}"
echo "[worker] Model: ${MODEL}"

case "$PROVIDER" in
  anthropic)
    # Existing Claude Code CLI path
    claude --print --model "${MODEL}" --dangerously-skip-permissions "${PROMPT}" 2>&1 | tee "${OUTPUT_FILE}"
    EXIT_CODE=$?
    ;;

  openai)
    export OPENAI_API_KEY="${OPENAI_API_KEY}"
    node /app/agents/openai-agent.js 2>&1 | tee "${OUTPUT_FILE}"
    EXIT_CODE=$?
    ;;

  google)
    export GOOGLE_API_KEY="${GOOGLE_API_KEY}"
    node /app/agents/google-agent.js 2>&1 | tee "${OUTPUT_FILE}"
    EXIT_CODE=$?
    ;;

  ollama)
    export OLLAMA_HOST="${OLLAMA_HOST:-http://host.docker.internal:11434}"
    node /app/agents/ollama-agent.js 2>&1 | tee "${OUTPUT_FILE}"
    EXIT_CODE=$?
    ;;

  *)
    echo "[worker] ERROR: Unknown provider: ${PROVIDER}"
    echo "::result::error_unknown_provider"
    exit 1
    ;;
esac
```

**OpenAI Agent implementation:**

```typescript
// worker/src/agents/openai-agent.ts
import OpenAI from 'openai';
import { tools, executeTool } from './tools';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  const prompt = process.env.PROMPT || '';
  const model = process.env.WORKER_MODEL || 'gpt-4o';

  let messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'user', content: prompt }
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let result = 'completed';
  let prUrl = '';
  let prNumber = '';

  while (true) {
    const response = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 4096,
    });

    totalInputTokens += response.usage?.prompt_tokens || 0;
    totalOutputTokens += response.usage?.completion_tokens || 0;

    const message = response.choices[0].message;
    messages.push(message);

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        console.log(`[agent] Executing tool: ${toolCall.function.name}`);
        const toolResult = await executeTool(
          toolCall.function.name,
          JSON.parse(toolCall.function.arguments)
        );

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });

        // Check for PR creation
        if (toolCall.function.name === 'create_pull_request' && toolResult.success) {
          prUrl = toolResult.prUrl;
          prNumber = toolResult.prNumber;
          result = 'review_requested';
        }
      }
    } else {
      // No more tool calls, we're done
      console.log(`[agent] Final response: ${message.content}`);
      break;
    }

    if (response.choices[0].finish_reason === 'stop') {
      break;
    }
  }

  // Output standard markers
  console.log(`::result::${result}`);
  if (prUrl) console.log(`::pr_url::${prUrl}`);
  if (prNumber) console.log(`::pr_number::${prNumber}`);
  console.log(`::input_tokens::${totalInputTokens}`);
  console.log(`::output_tokens::${totalOutputTokens}`);
}

main().catch(err => {
  console.error(`[agent] Error: ${err.message}`);
  console.log('::result::failed');
  process.exit(1);
});
```

**Shared tools:**

```typescript
// worker/src/agents/tools/index.ts
import { readFile, writeFile, listFiles } from './filesystem';
import { gitCommit, gitPush, createBranch } from './git';
import { createPullRequest, getPrStatus } from './github';
import { runCommand } from './shell';

export const tools: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to repo root' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to repo root' },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: 'Stage and commit changes',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
          files: { type: 'array', items: { type: 'string' }, description: 'Files to stage (optional, defaults to all)' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_pull_request',
      description: 'Create a GitHub pull request',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'PR title' },
          body: { type: 'string', description: 'PR description' },
          base: { type: 'string', description: 'Base branch (default: main)' },
        },
        required: ['title', 'body'],
      },
    },
  },
];

export async function executeTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'read_file':
      return readFile(args.path);
    case 'write_file':
      return writeFile(args.path, args.content);
    case 'run_command':
      return runCommand(args.command);
    case 'git_commit':
      return gitCommit(args.message, args.files);
    case 'create_pull_request':
      return createPullRequest(args.title, args.body, args.base);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
```

### Phase 6: Pricing Engines (4 hours)

```typescript
// api/src/providers/openai/pricing.ts
import { ProviderPricingEngine, TokenUsage, ModelInfo } from '../types';
import { ECS_FARGATE_SPOT_RATE_PER_HOUR } from '../../config/pricing';

const OPENAI_MODELS: Record<string, ModelInfo> = {
  'gpt-4o': {
    id: 'gpt-4o',
    displayName: 'GPT-4O',
    tier: 'powerful',
    inputRate: 0.0025,   // $2.50 per 1M = $0.0025 per 1K
    outputRate: 0.01,    // $10 per 1M = $0.01 per 1K
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  'gpt-4-turbo': {
    id: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    tier: 'balanced',
    inputRate: 0.01,     // $10 per 1M
    outputRate: 0.03,    // $30 per 1M
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  'o1': {
    id: 'o1',
    displayName: 'O1',
    tier: 'powerful',
    inputRate: 0.015,    // $15 per 1M
    outputRate: 0.06,    // $60 per 1M
    contextWindow: 200000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  'o1-mini': {
    id: 'o1-mini',
    displayName: 'O1 Mini',
    tier: 'budget',
    inputRate: 0.003,    // $3 per 1M
    outputRate: 0.012,   // $12 per 1M
    contextWindow: 128000,
    supportsStreaming: false,
    supportsCaching: true,
  },
};

export class OpenAIPricingEngine implements ProviderPricingEngine {
  provider = 'openai';

  getModels(): ModelInfo[] {
    return Object.values(OPENAI_MODELS);
  }

  getModelInfo(modelId: string): ModelInfo | undefined {
    return OPENAI_MODELS[modelId];
  }

  validateModel(model: string): boolean {
    return model in OPENAI_MODELS;
  }

  calculateTokenCost(tokens: TokenUsage, model: string): number {
    const modelInfo = OPENAI_MODELS[model];
    if (!modelInfo) return 0;

    const inputCost = (tokens.inputTokens / 1000) * modelInfo.inputRate;
    const outputCost = (tokens.outputTokens / 1000) * modelInfo.outputRate;

    return inputCost + outputCost;
  }

  calculateTotalCost(tokens: TokenUsage, model: string, durationSeconds: number): number {
    const tokenCost = this.calculateTokenCost(tokens, model);
    const computeCost = (durationSeconds / 3600) * ECS_FARGATE_SPOT_RATE_PER_HOUR;
    return tokenCost + computeCost;
  }
}
```

```typescript
// api/src/providers/google/pricing.ts
const GOOGLE_MODELS: Record<string, ModelInfo> = {
  'gemini-2.0-flash': {
    id: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    tier: 'balanced',
    inputRate: 0.000075,   // $0.075 per 1M
    outputRate: 0.0003,    // $0.30 per 1M
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  'gemini-1.5-pro': {
    id: 'gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    tier: 'powerful',
    inputRate: 0.00125,    // $1.25 per 1M
    outputRate: 0.005,     // $5 per 1M
    contextWindow: 2000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
};
```

### Phase 7: Settings UI (8 hours)

```typescript
// frontend/src/pages/Settings.tsx - Add provider section

// New state
const [providers, setProviders] = useState<ProviderStatus[]>([]);
const [selectedProvider, setSelectedProvider] = useState<string>('anthropic');
const [apiKeyInput, setApiKeyInput] = useState('');
const [testingConnection, setTestingConnection] = useState(false);

// Fetch provider status
useEffect(() => {
  fetch('/api/providers', { headers: authHeaders })
    .then(res => res.json())
    .then(data => setProviders(data.providers));
}, []);

// Provider configuration UI
<div className="space-y-6">
  <h2 className="text-xl font-semibold">AI Providers</h2>

  <div className="grid grid-cols-2 gap-4">
    {providers.map(provider => (
      <div
        key={provider.id}
        className={`p-4 border rounded-lg cursor-pointer ${
          selectedProvider === provider.id ? 'border-primary' : 'border-border'
        }`}
        onClick={() => setSelectedProvider(provider.id)}
      >
        <div className="flex items-center justify-between">
          <span className="font-medium">{provider.name}</span>
          {provider.configured ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : (
            <Circle className="w-5 h-5 text-muted" />
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {provider.configured ? 'Configured' : 'Not configured'}
        </p>
      </div>
    ))}
  </div>

  {selectedProvider && selectedProvider !== 'anthropic' && (
    <div className="space-y-4 p-4 border rounded-lg">
      <h3 className="font-medium">Configure {selectedProvider}</h3>
      <div>
        <label className="block text-sm mb-1">API Key</label>
        <input
          type="password"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          className="w-full p-2 border rounded"
          placeholder="Enter API key..."
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSaveCredentials}
          className="px-4 py-2 bg-primary text-white rounded"
        >
          Save
        </button>
        <button
          onClick={handleTestConnection}
          disabled={testingConnection}
          className="px-4 py-2 border rounded"
        >
          {testingConnection ? 'Testing...' : 'Test Connection'}
        </button>
      </div>
    </div>
  )}
</div>
```

---

## Jira Labels Reference

| Label | Provider | Model |
|-------|----------|-------|
| `haiku` | anthropic | claude-haiku-4-5-20251001 |
| `sonnet` | anthropic | claude-sonnet-4-20250514 |
| `opus` | anthropic | claude-opus-4-5-20251101 |
| `provider:openai` | openai | (use with model label) |
| `gpt-4o` | openai | gpt-4o |
| `gpt-4-turbo` | openai | gpt-4-turbo |
| `o1` | openai | o1 |
| `provider:google` | google | (use with model label) |
| `gemini-flash` | google | gemini-2.0-flash |
| `gemini-pro` | google | gemini-1.5-pro |
| `provider:ollama` | ollama | (use with model label) |
| `llama` | ollama | llama3.1:8b |

**Default (no labels)**: `anthropic` + `claude-sonnet-4-20250514`

---

## Verification Checklist

### Unit Tests
- [ ] Pricing engine calculations for each provider
- [ ] Label parsing for provider/model detection
- [ ] Provider registry lookup
- [ ] Credential fetching with caching

### Integration Tests
- [ ] Create task with OpenAI provider label
- [ ] Verify correct API key passed to ECS task
- [ ] Verify cost calculation uses correct pricing engine
- [ ] Verify provider shown in dashboard

### End-to-End Tests
- [ ] Create Jira ticket: `workermill`, `provider:openai`, `gpt-4o`
- [ ] Verify task created with `workerProvider: 'openai'`
- [ ] Verify worker receives `OPENAI_API_KEY` env var
- [ ] Verify OpenAI agent executes and reports tokens
- [ ] Verify cost calculated with OpenAI pricing

### Manual Verification
- [ ] Settings UI: Configure OpenAI API key
- [ ] Settings UI: Test connection works
- [ ] Dashboard: Provider icon shown on tasks
- [ ] Dashboard: Cumulative cost includes all providers

---

## Estimated Timeline

| Phase | Hours | Dependencies |
|-------|-------|--------------|
| Phase 1: Abstraction Layer | 4 | None |
| Phase 2: Database Schema | 2 | Phase 1 |
| Phase 3: Configuration & Secrets | 4 | Phase 2 |
| Phase 4: Jira Label System | 3 | Phase 2 |
| Phase 5: Worker Execution | 20 | Phases 1-4 |
| Phase 6: Pricing Engines | 4 | Phase 1 |
| Phase 7: Settings UI | 8 | Phases 1-4 |
| **Total** | **45** | |

---

## Risk Mitigation

1. **Breaking existing workflows**: All changes maintain backward compatibility. Anthropic remains default.

2. **API key security**: Keys stored in AWS Secrets Manager with per-org isolation.

3. **Cost accuracy**: Each provider has dedicated pricing engine with current rates.

4. **Agent capability parity**: OpenAI/Google agents may have different capabilities than Claude Code CLI. Document limitations.

5. **Rate limiting**: Implement per-provider rate limiting to prevent API abuse.
