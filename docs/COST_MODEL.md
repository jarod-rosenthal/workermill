# WorkerMill Cost Model

**Last Updated:** 2026-02-16
**Purpose:** Validate pricing tiers against actual AI and compute costs
**Data Source:** Production database (63 tasks with token tracking)

---

## Executive Summary

WorkerMill is a **BYOK (Bring Your Own Key)** platform. Customers pay their AI provider directly for tokens. WorkerMill's revenue comes from:
1. **Platform subscription** (orchestration, monitoring, workflow automation)
2. **Cloud execution** (Pro/Enterprise tiers provide managed worker containers)

The 3-tier model (Free/Pro/Enterprise) is designed so that Free has zero marginal cost (runs locally), Pro covers cloud infrastructure with healthy margins, and Enterprise is custom-priced for dedicated environments.

---

## 1. ACTUAL Task Costs from Production Data

**Source:** 63 tasks with token tracking from production database

| Model | Tasks | Avg Duration | Avg Input Tokens | Avg Output Tokens | **Avg Cost/Task** |
|-------|-------|--------------|------------------|-------------------|-------------------|
| **Claude Haiku 4.5** | 52 | 4.2 min | 2,988 | 9,033 | **$0.31** |
| **Claude Sonnet 4.5** | 5 | 5.9 min | 5,018 | 11,890 | **$1.17** |
| **Claude 3.5 Haiku** | 4 | 1.3 min | 31,390 | 7,264 | **$0.19** |
| **GPT-5.1 Codex** | 1 | 2.1 min | 582,600 | 2,117 | **$1.77** |

**Total spend tracked:** $24.45 across 63 tasks

---

## 2. Estimated Opus Costs (No Production Data Yet)

Based on Opus pricing ($0.005/1K input, $0.025/1K output) and token patterns from other models:

| Task Complexity | Input Tokens | Output Tokens | **Opus Cost** |
|-----------------|--------------|---------------|---------------|
| Medium (feature) | 50K | 25K | **$0.88** |
| Complex (architecture) | 100K | 40K | **$1.50** |
| Heavy context | 500K | 20K | **$3.00** |

**Estimated average Opus task: ~$2.00**

---

## 3. Pricing Tier Cost Analysis

### Free Tier ($0/mo)

| Cost Component | Amount | Notes |
|----------------|--------|-------|
| **AI tokens** | $0 to WorkerMill | User pays their AI provider directly (BYOK) |
| **Compute** | $0 to WorkerMill | Workers run on user's local machine (Docker) |
| **API overhead** | Negligible | Shared API infrastructure, minimal per-user cost |
| **Total marginal cost** | **~$0** | Pure customer acquisition — zero cost to serve |

The Free tier (1 user, 1 worker, 3 experts/task, 14-day logs) runs entirely on user hardware. WorkerMill only serves API requests for task coordination and log streaming.

### Pro Tier ($29/mo, launch price $14.50/mo)

| Cost Component | Amount | Notes |
|----------------|--------|-------|
| **AI tokens** | $0 to WorkerMill | User still pays their AI provider (BYOK) |
| **Compute (cloud workers)** | ~$0.025/task | ECS Fargate Spot containers |
| **Warm pool standby** | ~$2-5/mo | Pre-warmed containers for fast start |
| **Log storage (90 days)** | ~$1-2/mo | PostgreSQL storage for extended retention |
| **Total per-customer cost** | **~$5-10/mo** | At moderate usage (200 tasks/mo) |

**Margin at $29/mo:** ~66-83%
**Margin at launch $14.50/mo:** ~31-65%

### Enterprise Tier (Custom pricing)

Custom-priced to cover dedicated infrastructure with target 70%+ margins. Includes:
- Dedicated worker infrastructure
- Unlimited log retention
- SSO/SAML integration costs
- Dedicated CSM time
- Compliance overhead (SOC 2, HIPAA BAA)

---

## 4. AI Model Pricing (Per 1K Tokens)

### Anthropic Claude Models

| Model | Input | Output | Cache Write | Cache Read | Best For |
|-------|-------|--------|-------------|------------|----------|
| **Haiku 4.5** | $0.0008 | $0.004 | $0.001 | $0.00008 | Bug fixes, docs, simple tasks |
| **Sonnet 4.5** | $0.003 | $0.015 | $0.00375 | $0.0003 | Features, refactoring, analysis |
| **Opus 4.5** | $0.005 | $0.025 | $0.00625 | $0.0005 | Architecture, complex reasoning |

### OpenAI GPT-5.x Models

| Model | Input | Output | Cache Read | Best For |
|-------|-------|--------|------------|----------|
| **GPT-5** | $0.00125 | $0.01 | $0.000125 | General coding, 128K context |
| **GPT-5-mini** | $0.00025 | $0.002 | $0.000025 | Budget tasks, high volume |
| **GPT-5-nano** | $0.00005 | $0.0004 | $0.000005 | Ultra-budget, simple tasks |
| **GPT-5.1 Codex** | $0.00125 | $0.01 | $0.000125 | Code generation, 128K context |
| **GPT-5.1 Codex Max** | $0.00125 | $0.01 | $0.000125 | Code generation, 200K context |
| **GPT-5.2 Codex** | $0.00175 | $0.014 | $0.000175 | Latest codex capabilities |

### OpenAI Reasoning Models (o1 Series)

| Model | Input | Output | Cache Read | Notes |
|-------|-------|--------|------------|-------|
| **o1** | $0.015 | $0.06 | $0.0075 | Deep reasoning |
| **o1-mini** | $0.003 | $0.012 | $0.0015 | Balanced reasoning |
| **o1-pro** | $0.15 | $0.60 | N/A | Maximum reasoning power |

---

## 5. Compute Costs

### ECS Fargate Spot (Pro/Enterprise Cloud Workers)

| Resource | Configuration | Cost |
|----------|---------------|------|
| **vCPU** | 2 vCPU | Included |
| **Memory** | 4 GB | Included |
| **Hourly Rate** | Spot pricing (us-east-1) | **$0.015/hour** |

**Key insight:** Compute is negligible compared to AI tokens. A 10-minute task costs only $0.0025 in compute. AI tokens are 99%+ of task cost — and those are paid by the customer (BYOK).

---

## 6. Monthly Usage Projections by Tier

### Free Tier User (Solo Dev)
- **Workers:** 1 concurrent
- **Experts/task:** Up to 3
- **Tasks/month:** Unlimited (typically 20-50)
- **Cost to WorkerMill:** ~$0 (runs locally)
- **Cost to user:** AI tokens only (~$5-50/mo depending on model mix)

### Pro Tier User (Small Team)
- **Workers:** Up to 5 concurrent
- **Experts/task:** Unlimited
- **Tasks/month:** Unlimited (typically 100-500)
- **Cost to WorkerMill:** ~$5-10/mo compute
- **Revenue:** $29/mo ($14.50 at launch)
- **Cost to user:** $29/mo platform + AI tokens (~$50-300/mo depending on volume)

### Enterprise User (Large Org)
- **Workers:** Unlimited concurrent
- **Tasks/month:** Unlimited (typically 500-5000)
- **Cost to WorkerMill:** Custom infrastructure
- **Revenue:** Custom (typically $500-5000/mo)
- **Cost to user:** Custom platform + AI tokens

---

## 7. Competitive Analysis

### vs. Hiring Engineers

| Metric | Junior Engineer | WorkerMill Pro |
|--------|-----------------|----------------|
| Monthly cost | $8,000-10,000 fully loaded | $29 platform + ~$50-300 AI |
| Tasks/month | ~20-30 tickets | Unlimited (5 concurrent) |
| Availability | 8 hours/day, 5 days/week | 24/7 |
| Ramp time | 3-6 months | Immediate |
| **Cost per task** | **$300-500** | **$0.50-3.00** (AI tokens only) |

### vs. Cursor/Copilot

| Metric | Copilot ($19/seat) | WorkerMill Pro ($29/mo) |
|--------|--------------------|-----------------------------|
| What it does | Autocomplete | End-to-end task execution |
| Integration | IDE only | Jira → PR → Deploy |
| Visibility | None | Full logs, cost tracking |
| Team size | Per seat | 5 users included |

### vs. Devin ($500/mo)

| Metric | Devin | WorkerMill Pro ($29/mo) |
|--------|-------|----------------------------|
| Model | Fixed, opaque | BYOK, your choice |
| Cost transparency | None | Per-token tracking |
| Personas | 1 generic | 7+ specialists |
| Workflow | Slack→PR | Jira/Linear→Deploy |
| **Price** | **$500/mo** | **$29/mo + BYOK tokens** |

---

## 8. Pricing Summary

### Platform Tiers

| Tier | Price | Users | Workers | Experts | Log Retention |
|------|-------|-------|---------|---------|---------------|
| **Free** | $0/mo | 1 | 1 | 3/task | 14 days |
| **Pro** | $29/mo (launch: $14.50) | 5 | 5 | Unlimited | 90 days |
| **Enterprise** | Custom | Unlimited | Unlimited | Unlimited | Unlimited |

### Total Customer Cost (Platform + AI)

With blended model usage (40% Haiku, 30% Sonnet, 20% Opus, 10% GPT-5.1):

| Usage Level | Tasks/mo | AI Cost (~$1.05/task) | Platform | **Total** |
|-------------|----------|----------------------|----------|-----------|
| Solo (Free) | 30 | ~$32 | $0 | **~$32/mo** |
| Small Team (Pro) | 200 | ~$210 | $29 | **~$239/mo** |
| Mid-Market (Enterprise) | 1000 | ~$1,050 | Custom | **Custom** |

### Value Proposition

At $239/mo total (Pro + AI) for 200 tasks/month vs hiring:
- **Junior engineer (with AI tools):** $10,000/mo for ~25 tasks
- **WorkerMill Pro:** $239/mo for 200 tasks = **$1.20/task**
- **Savings:** ~97% cost reduction per task

---

## 9. Data Gaps & Next Steps

### Critical Gap: Token Tracking

Currently, workers don't report actual token usage back to the platform. The `inputTokens`, `outputTokens` fields show $0.00 because Claude Code CLI doesn't expose this data.

**Fix needed:** Parse Claude Code's cost output or use Anthropic's usage API to capture actual token consumption.

### Needed for GA

1. **Token usage capture** - Essential for accurate cost tracking and BYOK model
2. **Cost alerts** - Already in settings, needs implementation
3. **Usage analytics** - Show customers their actual AI costs
4. **Model comparison** - Help customers choose optimal model mix

---

## Sources

- [OpenAI Pricing](https://openai.com/api/pricing/)
- [OpenAI API Pricing Documentation](https://platform.openai.com/docs/pricing)
- [GPT-5.1 Pricing Guide](https://chatlyai.app/blog/gpt-5-1-pricing-explained)
- Anthropic pricing from internal configuration (January 2026)
- ECS Fargate Spot pricing from AWS (us-east-1)
