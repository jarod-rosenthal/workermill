# Dynamic Model Discovery

**Status:** Proposed
**Problem:** Hardcoded model lists in `api/src/routes/settings.ts` require code changes to add new models.

## Current State

Models are validated against hardcoded arrays:

```typescript
// settings.ts:182-207 - Worker models
const validModels = [
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-5-20250929",
  // ... more hardcoded models
];

// settings.ts:345-368 - Manager models
const validManagerModels = [
  "claude-opus-4-5-20251101",
  // ... more hardcoded models
];
```

**Issues:**
- New Ollama models require code deployment to be selectable
- No visibility into what models are actually available
- Frontend model dropdowns are out of sync with backend validation

## Proposed Solution

### New Endpoint: `GET /api/settings/models`

Returns all available models from all configured providers.

```typescript
interface ModelInfo {
  id: string;           // Model identifier (e.g., "qwen2.5-coder:32b")
  displayName: string;  // Human-readable name
  provider: string;     // "anthropic" | "openai" | "google" | "ollama"
  tier?: string;        // "economy" | "standard" | "premium"
  contextWindow?: number;
  source: "curated" | "discovered";  // Whether from static list or dynamically found
}

// Response
{
  models: ModelInfo[];
  ollamaStatus: "connected" | "disconnected" | "not_configured";
}
```

### Model Sources by Provider

| Provider | Source | Method |
|----------|--------|--------|
| Anthropic | Curated list | Static - no public models endpoint |
| OpenAI | Curated list | Could use `/v1/models` but returns many irrelevant models |
| Google | Curated list | Could use models endpoint but complex |
| Ollama | **Dynamic** | `GET {OLLAMA_HOST}/api/tags` returns all downloaded models |

### Ollama Dynamic Discovery

Ollama provides a `/api/tags` endpoint that lists all downloaded models:

```bash
curl http://localhost:11434/api/tags
```

Response:
```json
{
  "models": [
    {
      "name": "qwen2.5-coder:32b",
      "model": "qwen2.5-coder:32b",
      "modified_at": "2025-01-15T10:30:00Z",
      "size": 18000000000,
      "digest": "sha256:abc123...",
      "details": {
        "parameter_size": "32B",
        "quantization_level": "Q4_K_M"
      }
    }
  ]
}
```

### Validation Logic Change

Replace hardcoded validation with:

```typescript
// Before
const validModels = ["claude-haiku-4-5-20251001", ...];
if (!validModels.includes(model)) {
  return error;
}

// After
const availableModels = await getAvailableModels(org);
const isValid = availableModels.some(m => m.id === model) || model.includes(":");
if (!isValid) {
  return error;
}
```

The `model.includes(":")` fallback ensures any Ollama model format is accepted even if the Ollama server is temporarily unreachable.

## Implementation Steps

1. **Add models endpoint** (`GET /api/settings/models`)
   - Query Ollama `/api/tags` for downloaded models
   - Merge with curated lists for other providers
   - Cache results for 60 seconds to avoid hammering Ollama

2. **Update validation** in `PUT /api/settings`
   - Fetch available models dynamically
   - Fall back to accepting Ollama format (`model:tag`) if discovery fails

3. **Update frontend** Settings page
   - Fetch models from new endpoint
   - Populate dropdowns dynamically
   - Show which provider each model belongs to

## Caching Strategy

```typescript
const modelCache = new Map<string, { models: ModelInfo[]; timestamp: number }>();
const CACHE_TTL_MS = 60000; // 1 minute

async function getAvailableModels(org: Organization): Promise<ModelInfo[]> {
  const cacheKey = `models-${org.id}`;
  const cached = modelCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.models;
  }

  const models = await discoverModels(org);
  modelCache.set(cacheKey, { models, timestamp: Date.now() });
  return models;
}
```

## API Response Example

```json
{
  "models": [
    {
      "id": "claude-haiku-4-5-20251001",
      "displayName": "Claude Haiku 4.5",
      "provider": "anthropic",
      "tier": "economy",
      "contextWindow": 200000,
      "source": "curated"
    },
    {
      "id": "qwen2.5-coder:32b",
      "displayName": "Qwen 2.5 Coder 32B",
      "provider": "ollama",
      "contextWindow": 32768,
      "source": "discovered"
    },
    {
      "id": "deepseek-r1:70b",
      "displayName": "DeepSeek R1 70B",
      "provider": "ollama",
      "source": "discovered"
    }
  ],
  "ollamaStatus": "connected"
}
```

## Migration Path

1. Deploy new endpoint
2. Frontend can start using it immediately
3. Backend validation remains permissive (accepts `:` format)
4. Gradually tighten validation as dynamic discovery proves reliable
