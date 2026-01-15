# BYOK (Bring Your Own Key) Guide

WorkerMill supports a **BYOK model** that allows you to use your own AI provider API keys with complete cost transparency and zero markup.

## What is BYOK?

BYOK (Bring Your Own Key) means you provide your own API keys from AI providers like Anthropic, OpenAI, or Google. WorkerMill uses these keys directly without adding any markup to the token costs.

### Benefits

| Benefit | Description |
|---------|-------------|
| **Zero Markup** | Pay only what the provider charges - no 15-20% platform fees |
| **Direct Relationship** | Access new models immediately when released |
| **Existing Contracts** | Leverage your enterprise AI agreements |
| **Volume Discounts** | Keep your negotiated rates |
| **Cost Transparency** | See exact token costs per task |
| **Data Sovereignty** | Your API key, your data policies |

### Comparison

| Aspect | BYOK Model | Bundled Model (Competitors) |
|--------|------------|----------------------------|
| Token Cost | Provider rate | Provider rate + 15-20% |
| New Model Access | Immediate | When vendor adds support |
| Enterprise Contracts | Fully usable | Often not compatible |
| Cost Visibility | Full breakdown | Often opaque |
| Example: $1000/mo AI spend | **$1000** | $1150-1200 |

## Supported Providers

### Anthropic (Claude)

The primary provider for WorkerMill workers.

**Available Models:**
- `claude-sonnet-4-20250514` (Recommended for most tasks)
- `claude-opus-4-20250514` (Complex reasoning, architecture)
- `claude-haiku-4-20250514` (Fast, simple tasks)

**Getting an API Key:**
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account or sign in
3. Navigate to API Keys
4. Create a new key with appropriate permissions

**Cost Reference (as of 2026):**
| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| Sonnet | $3.00 | $15.00 |
| Opus | $15.00 | $75.00 |
| Haiku | $0.25 | $1.25 |

---

### OpenAI (GPT-4)

For teams with existing OpenAI infrastructure.

**Available Models:**
- `gpt-4o` (Latest, multimodal)
- `gpt-4-turbo` (Fast, capable)
- `gpt-4` (Original, reliable)

**Getting an API Key:**
1. Go to [platform.openai.com](https://platform.openai.com)
2. Navigate to API Keys
3. Create a new secret key

---

### Google (Gemini)

Google's AI models for diverse workloads.

**Available Models:**
- `gemini-1.5-pro` (Advanced reasoning)
- `gemini-1.5-flash` (Fast, efficient)

**Getting an API Key:**
1. Go to [makersuite.google.com](https://makersuite.google.com)
2. Create or select a project
3. Generate an API key

---

### Ollama (Self-Hosted)

Run models locally for complete data control.

**Available Models:**
- Any Ollama-supported model (Llama, Mistral, CodeLlama, etc.)

**Setup:**
1. Install Ollama: `curl -fsSL https://ollama.ai/install.sh | sh`
2. Pull a model: `ollama pull codellama:34b`
3. Configure WorkerMill with Ollama endpoint

---

## Configuration

### Setting Up BYOK Keys

1. **Navigate to Settings** in the WorkerMill dashboard
2. **Go to AI Providers** section
3. **Enter your API key** for each provider you want to use
4. **Test the connection** using the "Validate" button
5. **Set a default provider** for your organization

### Environment Variables (Self-Hosted)

For self-hosted deployments, configure via environment variables:

```bash
# Anthropic (Primary)
ANTHROPIC_API_KEY=sk-ant-api03-...

# OpenAI (Optional)
OPENAI_API_KEY=sk-...

# Google (Optional)
GOOGLE_API_KEY=AIza...

# Ollama (Optional)
OLLAMA_HOST=http://localhost:11434
```

### AWS Secrets Manager (Recommended)

Store keys securely in AWS Secrets Manager:

```
workermill/dev/anthropic-api-key
workermill/dev/openai-api-key
workermill/dev/google-api-key
```

---

## Provider Selection

### Automatic Selection

WorkerMill automatically selects providers based on:

1. **Task labels** - `anthropic`, `openai`, `gemini`, `ollama`
2. **Model labels** - `haiku`, `sonnet`, `opus` → Anthropic
3. **Organization default** - Fallback if no label specified
4. **First configured provider** - If no default set

### Selection Priority

```
Task Label (e.g., "openai")
         │
         ▼
Model Label (e.g., "sonnet" → Anthropic)
         │
         ▼
Organization Default Provider
         │
         ▼
First Configured Provider
```

### Manual Selection

Force a specific provider by adding labels to your ticket:

| Label | Provider |
|-------|----------|
| `anthropic` | Anthropic Claude |
| `openai` | OpenAI GPT-4 |
| `gemini` | Google Gemini |
| `ollama` | Local Ollama |

---

## Cost Tracking

### Per-Task Costs

Every task tracks AI costs with full transparency:

```json
{
  "taskId": "abc123",
  "aiCosts": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "inputTokens": 45000,
    "outputTokens": 12000,
    "inputCost": 0.135,
    "outputCost": 0.180,
    "totalAiCost": 0.315
  },
  "computeCosts": {
    "ecsDuration": 720,
    "ecsCost": 0.012
  },
  "totalCost": 0.327
}
```

### Dashboard Metrics

The Analytics dashboard shows:

- **Daily/Monthly AI Spend** - Aggregated across all tasks
- **Cost by Provider** - Breakdown per AI provider
- **Cost by Persona** - Which worker types cost most
- **Cost by Project** - Jira project cost allocation
- **Trend Analysis** - Spend over time

### Cost Alerts

Set up alerts when spending exceeds thresholds:

1. Go to Settings → Notifications
2. Enable "Cost Alert"
3. Set threshold (e.g., $100/day or $500/month)
4. Configure notification channel (Slack, email)

---

## Best Practices

### Key Management

1. **Rotate keys regularly** - At least quarterly
2. **Use separate keys** for production vs development
3. **Monitor key usage** in provider dashboards
4. **Set spending limits** at the provider level
5. **Store securely** - Use AWS Secrets Manager, not .env files

### Cost Optimization

1. **Use appropriate models**:
   - Haiku for simple tasks (bug fixes, small features)
   - Sonnet for standard development work
   - Opus only for complex architecture decisions

2. **Leverage caching** - WorkerMill caches common operations
3. **Review task logs** - Identify wasteful token usage
4. **Set concurrency limits** - Prevent runaway costs

### Provider Strategy

1. **Start with Anthropic** - Best coding performance
2. **Add OpenAI** for diversity - Different strengths
3. **Consider Ollama** for sensitive code - Full data control
4. **Use Google Gemini** for specific use cases - Large context windows

---

## Troubleshooting

### Invalid API Key

**Symptoms:** Tasks fail immediately with authentication error

**Solutions:**
1. Verify key is correct (no extra spaces)
2. Check key hasn't expired or been revoked
3. Ensure key has required permissions
4. Test key directly with provider's API

### Rate Limiting

**Symptoms:** Tasks fail with rate limit errors

**Solutions:**
1. Check provider dashboard for current usage
2. Reduce concurrent workers
3. Upgrade provider plan for higher limits
4. Add retry logic with exponential backoff

### Unexpected Costs

**Symptoms:** Higher than expected bills

**Solutions:**
1. Review task logs for excessive token usage
2. Check for stuck or infinite loop tasks
3. Set spending limits at provider level
4. Use cost alerts for early warning
5. Consider Haiku for simpler tasks

---

## Security Considerations

### Key Storage

- **Never commit keys** to version control
- **Use secrets management** (AWS Secrets Manager, HashiCorp Vault)
- **Encrypt at rest** - Keys are encrypted in WorkerMill database
- **Limit access** - Only admins can view/edit provider keys

### Network Security

- **All API calls use HTTPS** - Encrypted in transit
- **Keys never exposed** - Only used server-side
- **Audit logging** - All key access is logged

### Compliance

- **SOC2 ready** - Key management follows best practices
- **GDPR compliant** - Keys stored in your specified region
- **Data residency** - Use Ollama for on-premises requirements
