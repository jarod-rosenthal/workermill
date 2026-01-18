# Multi-Provider Architecture: Backwards Compatibility Analysis

**Date:** January 2026
**Commit:** 5baad09 (feat: Add multi-provider executor architecture with LangGraph)

## Summary

The multi-provider architecture introduces support for Anthropic, OpenAI, Google, and Ollama providers. **Changes are backwards compatible** with proper defaults for existing organizations.

## Database Schema Changes

All migrations include defaults for existing data:

| Migration | Column | Default | Status |
|-----------|--------|---------|--------|
| `AddProviderSupport.ts` | `worker_tasks.worker_provider` | `'anthropic'` | ✅ Safe |
| | `organizations.primary_provider` | `'anthropic'` | ✅ Safe |
| | `organizations.provider_settings` | `{}` | ✅ Safe |
| `AddManagerProvider.ts` | `organizations.manager_provider` | `'openai'` | ✅ Safe |
| `AddVllmBaseUrl.ts` | `organizations.vllm_base_url` | `NULL` | ✅ Safe |
| `AddOllamaContextWindow.ts` | `organizations.ollama_context_window` | `65536` | ✅ Safe |

## Organization Model Defaults

```typescript
// Worker Settings - defaults to Anthropic (existing behavior)
primaryProvider: "anthropic"
provider_settings: {}

// Manager Settings - defaults to OpenAI
managerProvider: "openai"
managerModelId: "gpt-5.1-codex"

// Ollama Configuration - optional
ollamaBaseUrl: null
ollamaContextWindow: 65536

// vLLM Configuration - optional
vllmBaseUrl: null

// Provider Routing - optional
providerRouting: {}
```

## API Compatibility

### Settings Endpoints

- `GET /api/settings` - Returns all new fields with fallback defaults
- `PUT /api/settings` - All new fields are optional; existing clients work unchanged

### Task Creation Flow

Provider/model selection follows this hierarchy:

1. Explicit Jira labels (`haiku`, `ollama`, `opus`, etc.)
2. Organization provider routing rules (persona-specific)
3. Organization `primary_provider` + `defaultWorkerModel`
4. Provider-specific defaults:
   - Anthropic: `claude-haiku-4-5-20251001`
   - OpenAI: `gpt-4o`
   - Google: `gemini-2.0-flash`
   - Ollama: `qwen2.5-coder:32b`

## Known Issues

### 1. Manager Provider Requires OpenAI Key

The `manager_provider` defaults to `openai`, requiring `OPENAI_API_KEY` in Secrets Manager.

**Impact:** Manager review tasks fail if OpenAI key is not configured.

**Solution:** Add `workermill/dev/openai-api-key` to AWS Secrets Manager, or disable manager reviews.

### 2. Model Validation Whitelist

Model validation in `settings.ts` uses a hardcoded whitelist. New models must be added manually.

**Mitigation:** Ollama models with `:` format (e.g., `qwen2.5-coder:32b`) are automatically accepted.

**TODO:** Make model list dynamic by querying providers (see Dynamic Model Discovery section).

### 3. Provider Routing Complexity

The cascading logic for provider selection is not fully documented in CLAUDE.md.

## Environment Variables

### Worker Container

| Variable | Required For | Default |
|----------|--------------|---------|
| `WORKER_PROVIDER` | All | `anthropic` |
| `WORKER_MODEL` | All | Provider-specific default |
| `ANTHROPIC_API_KEY` | Anthropic | - |
| `OPENAI_API_KEY` | OpenAI | - |
| `GOOGLE_API_KEY` | Google | - |
| `OLLAMA_HOST` | Ollama | `http://localhost:11434` |
| `OLLAMA_CONTEXT_WINDOW` | Ollama | `65536` |
| `VLLM_BASE_URL` | vLLM GPU inference | - |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Missing API keys | Medium | High | Clear error messages at runtime |
| Manager reviews fail | Medium | Medium | Check OpenAI key in Secrets Manager |
| Old API clients break | Low | Low | API is backwards compatible |
| Database migration fails | Low | High | `IF NOT EXISTS` guards |
| Model validation too strict | Medium | Low | Dynamic model discovery (TODO) |

## Verification Checklist

- [ ] OpenAI key exists in Secrets Manager (`workermill/dev/openai-api-key`)
- [ ] Existing org tasks run with Anthropic provider
- [ ] Ollama host is reachable (`https://ollama.therealjarod.com`)
- [ ] New orgs get correct defaults
- [ ] Settings UI displays all provider options

## Dynamic Model Discovery

**Current State:** Models are hardcoded in `api/src/routes/settings.ts`.

**Proposed Solution:** Query available models from each provider at runtime:

- **Ollama:** `GET /api/tags` returns all downloaded models
- **OpenAI:** Use models endpoint or maintain curated list
- **Anthropic:** Curated list (no public models endpoint)

See implementation plan in `docs/dynamic-model-discovery.md`.
