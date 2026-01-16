# WorkerMill Cost Model

**Last Updated:** 2026-01-16
**Purpose:** Validate pricing tiers against actual AI and compute costs
**Data Source:** Production database (63 tasks with token tracking)

---

## Executive Summary

WorkerMill is a **BYOK (Bring Your Own Key)** platform. Customers pay their AI provider directly for tokens. WorkerMill's revenue comes from:
1. **Platform subscription** (orchestration, monitoring, workflow automation)
2. **Compute markup** (optional, if WorkerMill provides ECS containers)

This cost model validates pricing against actual task costs to ensure economic viability.

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

## 3. What $299/month Buys (AI Costs)

### By Model (single model usage)

| Model | Avg Cost | Tasks for $299 | Tasks/Day |
|-------|----------|----------------|-----------|
| **Claude Haiku 4.5** | $0.31 | ~965 tasks | ~32/day |
| **Claude Sonnet 4.5** | $1.17 | ~255 tasks | ~8/day |
| **Claude Opus 4.5** | $2.00 | ~150 tasks | ~5/day |
| **GPT-5.1 Codex** | $1.77 | ~169 tasks | ~5/day |

### Realistic Blended Usage (with Opus for complex work)

| Model | % of Tasks | Avg Cost | Weighted Cost |
|-------|------------|----------|---------------|
| Haiku (simple bugs, docs) | 40% | $0.31 | $0.12 |
| Sonnet (features, refactoring) | 30% | $1.17 | $0.35 |
| **Opus (architecture, complex)** | 20% | $2.00 | $0.40 |
| GPT-5.1 (alternative) | 10% | $1.77 | $0.18 |
| **Blended average** | 100% | | **$1.05/task** |

**$299/month with Opus in the mix:**
- ~285 tasks/month
- ~9-10 tasks/day

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

### ECS Fargate Spot (WorkerMill Standard)

| Resource | Configuration | Cost |
|----------|---------------|------|
| **vCPU** | 2 vCPU | Included |
| **Memory** | 4 GB | Included |
| **Hourly Rate** | Spot pricing (us-east-1) | **$0.015/hour** |

**Key insight:** Compute is negligible compared to AI tokens. A 10-minute task costs only $0.0025 in compute. AI tokens are 99%+ of task cost.

---

## 6. Monthly Usage Projections

### Scenario: Small Team (1-3 engineers)
- **Tasks/month:** 50 (mix of simple and medium)
- **Task mix:** 70% simple (Haiku), 30% medium (Sonnet)

| Model Strategy | Monthly AI Cost | Monthly Compute | **Total** |
|----------------|-----------------|-----------------|-----------|
| All Haiku | 50 × $0.027 = $1.35 | $0.50 | **$1.85** |
| Mixed (70/30) | 35×$0.027 + 15×$0.32 = $5.75 | $0.50 | **$6.25** |
| All GPT-5-mini | 50 × $0.012 = $0.60 | $0.50 | **$1.10** |

### Scenario: Growth Team (5-10 engineers)
- **Tasks/month:** 200 (mix of all complexity levels)
- **Task mix:** 50% simple, 35% medium, 15% complex

| Model Strategy | Monthly AI Cost | Monthly Compute | **Total** |
|----------------|-----------------|-----------------|-----------|
| Budget (Haiku + GPT-5-mini) | $8.50 | $2.50 | **$11** |
| Balanced (Haiku/Sonnet mix) | $35 | $3.00 | **$38** |
| Premium (Sonnet + Opus) | $95 | $4.00 | **$99** |

### Scenario: Mid-Market (20-50 engineers)
- **Tasks/month:** 1,000 (high volume)
- **Task mix:** 40% simple, 40% medium, 20% complex

| Model Strategy | Monthly AI Cost | Monthly Compute | **Total** |
|----------------|-----------------|-----------------|-----------|
| Budget | $40 | $15 | **$55** |
| Balanced | $180 | $18 | **$198** |
| Premium | $550 | $25 | **$575** |

---

## 7. Pricing Tier Validation

### What Customers Actually Pay

With BYOK, customers pay AI providers directly. WorkerMill charges for:
1. **Platform access** (orchestration, dashboards, workflows)
2. **Compute** (if using WorkerMill-managed containers)

### Validated Pricing Tiers

| Tier | Price | Value Proposition | Margin Analysis |
|------|-------|-------------------|-----------------|
| **Free** | $0/mo | 10 tasks, 1 worker | Customer acquisition |
| **Starter** | $49/mo | 100 tasks, 1 worker, basic dashboards | 100 tasks × $0.05 compute = $5 COGS |
| **Pro** | $149/mo | 500 tasks, 3 workers, analytics | 500 tasks × $0.05 = $25 COGS |
| **Scale** | $399/mo | 2000 tasks, 10 workers, priority, SLA | 2000 tasks × $0.05 = $100 COGS |
| **Enterprise** | Custom | Unlimited, dedicated, SSO, audit | Volume discounts |

**Key insight:** Platform costs are ~$0.05/task in compute. At $149/mo for 500 tasks, that's $0.30/task effective price = **83% margin**.

### Alternative: Usage-Based Pricing

| Metric | Price | Rationale |
|--------|-------|-----------|
| Per task completed | $0.25-$0.50 | Simple, predictable |
| Per hour of worker time | $5-$10 | Aligns with actual costs |
| Per successful PR | $1-$5 | Outcome-based |

---

## 8. Competitive Analysis

### vs. Hiring Engineers

| Metric | Junior Engineer | WorkerMill (Scale tier) |
|--------|-----------------|-------------------------|
| Monthly cost | $8,000-10,000 fully loaded | $399 platform + ~$200 AI |
| Tasks/month | ~20-30 tickets | 2,000 tasks |
| Availability | 8 hours/day, 5 days/week | 24/7 |
| Ramp time | 3-6 months | Immediate |
| **Cost per task** | **$300-500** | **$0.30** |

### vs. Cursor/Copilot

| Metric | Copilot ($19/seat) | WorkerMill Pro ($149/mo) |
|--------|--------------------|-----------------------------|
| What it does | Autocomplete | End-to-end task execution |
| Integration | IDE only | Jira → PR → Deploy |
| Visibility | None | Full logs, cost tracking |
| Team size | Per seat | Per org |

### vs. Devin ($500/mo)

| Metric | Devin | WorkerMill Scale ($399/mo) |
|--------|-------|----------------------------|
| Model | Fixed, opaque | BYOK, your choice |
| Cost transparency | None | Per-token tracking |
| Personas | 1 generic | 7+ specialists |
| Workflow | Slack→PR | Jira/Linear→Deploy |

---

## 9. Pricing Summary

### Platform Tiers (from MARKET_POSITIONING.md)

| Tier | Platform Fee | Target |
|------|--------------|--------|
| **Free** | $0 | 10 tasks/mo, 1 worker |
| **Starter** | $99/mo | 100 tasks/mo, 1 worker |
| **Pro** | $299/mo | Unlimited tasks, 3 workers |
| **Scale** | $999/mo | Unlimited, 10 workers, priority |
| **Enterprise** | Custom | Dedicated, SLA, SSO |

### Total Customer Cost (Platform + AI)

With blended model usage (40% Haiku, 30% Sonnet, 20% Opus, 10% GPT-5.1):

| Usage Level | Tasks/mo | AI Cost (~$1.05/task) | Platform | **Total** |
|-------------|----------|----------------------|----------|-----------|
| Light | 100 | ~$105 | $99 | **~$204/mo** |
| Medium | 300 | ~$315 | $299 | **~$614/mo** |
| Heavy | 1000 | ~$1,050 | $999 | **~$2,049/mo** |

### Value Proposition

At $614/mo total for 300 tasks/month vs hiring:
- **Junior engineer:** $10,000/mo for ~25 tickets = $400/ticket
- **WorkerMill:** $614/mo for 300 tasks = **$2/task**
- **Savings:** ~99%

---

## 10. Data Gaps & Next Steps

### Critical Gap: Token Tracking

Currently, workers don't report actual token usage back to the platform. The `inputTokens`, `outputTokens` fields show $0.00 because Claude Code CLI doesn't expose this data.

**Fix needed:** Parse Claude Code's cost output or use Anthropic's usage API to capture actual token consumption.

### Needed for GA

1. **Token usage capture** - Essential for accurate billing and BYOK model
2. **Cost alerts** - Already in settings, needs implementation
3. **Usage analytics** - Show customers their actual costs
4. **Model comparison** - Help customers choose optimal model mix

---

## Sources

- [OpenAI Pricing](https://openai.com/api/pricing/)
- [OpenAI API Pricing Documentation](https://platform.openai.com/docs/pricing)
- [GPT-5.1 Pricing Guide](https://chatlyai.app/blog/gpt-5-1-pricing-explained)
- Anthropic pricing from internal configuration (January 2026)
- ECS Fargate Spot pricing from AWS (us-east-1)
