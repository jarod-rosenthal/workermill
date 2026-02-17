# WorkerMill Monetization Strategy

## Current Architecture (As Shipped)

The VS Code extension **requires** the WorkerMill cloud API to function. There is no disconnected mode.

```
VS Code Extension → Agent Local API (127.0.0.1) → Cloud API (workermill.com) → PostgreSQL
                                                        ↑
                                                   Required. No offline mode.
```

Every feature — task listing, Jira issue browsing, log streaming, plan approval, running tasks — flows through `workermill.com`. The agent binary authenticates with an org API key and proxies all requests. If the cloud API is down, the extension shows "Agent not connected."

**What the cloud API sees vs. doesn't see:**

| Cloud API Receives | Cloud API Never Sees |
|-------------------|---------------------|
| Task summaries and status | Source code / repo contents |
| Structured log lines (curated `postLog()` output) | Raw terminal stdout/stderr |
| Coordination feed messages between experts | File contents being edited |
| Jira issue metadata | Git diffs or patches |
| Planning agent output (story descriptions, file lists) | Actual code changes |
| Error classifications and quality scores | Repository credentials |

The LLM provider (Anthropic, OpenAI, etc.) sees the code — not WorkerMill. Workers run on the user's machine and send prompts directly to the LLM API. WorkerMill is the orchestrator, not the inference layer.

---

## The Product Stack

| Layer | Monetizable? | Notes |
|-------|-------------|-------|
| **VS Code Extension** | No — free distribution channel | Gets users in the door. Free on Marketplace. |
| **Agent Binary** | Yes — the licensed product | Planning, orchestration, worker spawning, critic review |
| **Cloud API** | Yes — required for operation | Task state, logs, coordination, decision engine |
| **Decision Engine** | Yes — the core IP | Error classification, quality gates, review parsing, question routing |
| **Worker Code** | Bundled with agent | Expert coordination, persona system, blocker handling |

The VS Code extension is the **interface**. The agent binary is the **runtime**. The cloud API is the **brain**. You monetize the brain and runtime, not the interface.

---

## Pricing Tiers

### Free Tier

**Goal:** Let developers try WorkerMill on small tasks. Build adoption and word-of-mouth.

| Included | Not Included |
|----------|-------------|
| VS Code extension (full UI) | Planning agent + critic review |
| 1 concurrent worker | Multi-expert parallel orchestration |
| SDK mode (single-task, no story decomposition) | Provider routing |
| Basic error retry (3 attempts) | Cloud decision engine (error classification, quality gates, question routing) |
| Log streaming and task monitoring | Custom personas |
| Jira integration (browse + run) | Priority support |
| Community support (GitHub Issues) | |

**How it works:** User signs up at workermill.com, gets an org with a free plan. `workermill-agent setup` configures the API key. The agent checks the plan tier on startup and enforces capability limits. The VS Code extension works fully — it just reflects what the agent allows.

**Enforcement:** The cloud API returns the org's plan tier in the claim response. The agent respects these limits locally. The API also enforces server-side (rejects planning requests from free-tier orgs).

### Pro — $29/user/month

**Goal:** Full orchestration power for professional developers and small teams.

| Everything in Free, plus: |
|--------------------------|
| Unlimited concurrent workers |
| Planning agent + critic review loop (threshold: 85/100, up to 3 iterations) |
| Multi-expert parallel orchestration (Epic mode) |
| Cloud-powered decision engine (error classification, quality gates, question routing, review parsing) |
| Provider routing (Anthropic, OpenAI, Google, Ollama) |
| Dynamic file caps per story (5/6/8 based on complexity) |
| Manager review and deployment automation |
| Email support |

### Enterprise — Contact Sales (~$59/user/month)

**Goal:** Regulated industries, large teams, compliance requirements.

| Everything in Pro, plus: |
|-------------------------|
| Self-hosted option (agent + API + PostgreSQL, no egress to workermill.com) |
| Custom persona creation and directive authoring |
| SSO/SAML integration |
| Audit logs and compliance reporting |
| Org-wide analytics and cost tracking |
| VPC deployment option |
| Dedicated support + SLA |
| On-premises decision engine (air-gapped) |

---

## Why $29/month

**Below the autonomous agent tier:** Devin charges $20/month for 9 ACUs (~2.25 hours of work). WorkerMill Pro gives unlimited orchestration — the user pays their own LLM costs (API key or Claude Max subscription), but WorkerMill's orchestration is flat-rate. For a team running 10+ epics/month, $29 is dramatically cheaper than Devin's per-ACU model.

**Above the autocomplete tier:** GitHub Copilot is $10-19/month for code suggestions. WorkerMill doesn't suggest code — it executes entire tickets autonomously. Different category, higher price justified.

**Comparable to code intelligence tools:** Sourcegraph Enterprise is $59/user/month. Snyk Team is $25/developer/month. Tabnine is $12-39/user/month. $29/month for autonomous task execution is within the range developers and teams already pay for AI-powered dev tools.

---

## Industry Precedents

### GitLens → GitKraken (Free Extension as Funnel)

- **Model:** Free VS Code extension (40M+ installs) → paid GitKraken suite
- **Revenue:** ~$10.6M ARR, bootstrapped
- **Lesson:** The free extension is pure distribution. GitLens Pro features (commit graph, worktrees, visual file history) require a GitKraken account at $4.99/user/month. The extension surfaces "unlock with Pro" prompts naturally in the UI.
- **WorkerMill parallel:** The VS Code extension is free. When a free user tries to run a multi-story epic and the agent says "planning requires Pro," the extension displays that message in the sidebar. No artificial walls in the extension itself — it reflects agent capabilities.

### JetBrains (Local Tool, Licensed Binary)

- **Model:** Free Community editions, paid Ultimate at $14.90/month, no external funding
- **Revenue:** ~$252M ARR, fully bootstrapped since 2000
- **Lesson:** Local developer tools can build $250M+ businesses without cloud lock-in. JetBrains validates the license on startup (one-time phone-home), offers a perpetual fallback license if the subscription lapses, and runs entirely locally. Their AI Assistant offers free local completions and paid cloud completions — the same tiered-intelligence pattern.
- **WorkerMill parallel:** The agent binary validates a license key on `workermill-agent start`. If the license server is unreachable, the agent runs in free-tier mode (graceful degradation, not hard failure). Pro features activate when the API confirms the tier.

### Snyk (Free Extension, Cloud Intelligence Upsell)

- **Model:** Free VS Code extension + CLI → paid cloud scanning platform
- **Revenue:** $408M (2025), $8.5B peak valuation
- **Lesson:** The free tier has test quotas that any serious team exceeds quickly. The extension is the entry point; the continuously-updated vulnerability database is the product. Enterprise gets self-hosted scanning for regulated industries.
- **WorkerMill parallel:** The decision engine (`worker-decision-engine.ts`) is WorkerMill's vulnerability database equivalent — continuously improving intelligence that free users get a frozen snapshot of and Pro users get live access to.

### Docker Desktop (EULA-Based Commercial Gating)

- **Model:** Free for individuals and small businesses (<250 employees / <$10M revenue), paid for larger orgs
- **Revenue:** Not disclosed, $2.1B valuation
- **Lesson:** No technical enforcement — Docker Desktop downloads and runs without a license. Enforcement is via EULA and enterprise procurement compliance. Works for Fortune 500 companies; individual developers ignore it.
- **WorkerMill parallel:** Not recommended as primary model. Technical enforcement (API-side plan checking) is more reliable than EULA compliance for a smaller company without Docker's market position.

### Cursor (IDE + Cloud AI, Credit-Based)

- **Model:** Free VS Code fork with limited AI, Pro at $20/month with $20 credit pool for premium models
- **Revenue:** ~$500M ARR, $9B valuation
- **Lesson:** The IDE is local, the AI is cloud. Cursor's value is the orchestration layer (Tab, Composer, Agent) that makes AI useful in context — not the IDE itself (which is just VS Code). The June 2025 migration from request-based to credit-based pricing caused significant backlash due to unpredictable costs.
- **WorkerMill parallel:** WorkerMill's value is also the orchestration layer — planning, multi-expert coordination, quality gates — not the UI. Flat-rate pricing ($29/month) avoids Cursor's credit-anxiety problem.

### Devin / Cognition (Autonomous Agent, Usage-Based)

- **Model:** Per-ACU pricing, $20/month for 9 ACUs (~2.25 hours of agent work)
- **Revenue:** $73M ARR (June 2025), $10.2B valuation
- **Lesson:** Started at $500/month, dropped to $20/month in 12 months as the AI agent market commoditized. ACU consumption is unpredictable, creating billing anxiety. Fully cloud-hosted — no local option at standard tiers.
- **WorkerMill parallel:** WorkerMill's local-first architecture is a structural advantage over Devin. Users bring their own LLM costs. Flat-rate orchestration pricing means no per-task anxiety. The privacy story ("your code never touches our servers") directly counters Devin's cloud-only model.

### Tabnine (Privacy-First Enterprise)

- **Model:** Killed free tier entirely (April 2025), $12-39/user/month, VPC and air-gapped options
- **Revenue:** Not disclosed, $15.5M raised
- **Lesson:** Competed with Copilot by selling privacy guarantees Microsoft can't match. On-premises deployment for regulated industries (finance, healthcare, defense). Target customer pays a premium for the deployment model, not the AI quality.
- **WorkerMill parallel:** The Enterprise self-hosted tier follows Tabnine's playbook exactly. Regulated industries that cannot send any data to external APIs will pay $59+/user/month for a fully air-gapped WorkerMill deployment.

### Raycast (Local Tool, Cloud AI Upsell)

- **Model:** Free local launcher with 1000+ extensions, Pro at $8/month for AI + cloud sync
- **Revenue:** Not disclosed, $15M Series A
- **Lesson:** Built massive developer goodwill with a genuinely excellent free local product. AI features are the natural paid extension — they require cloud infrastructure that costs Raycast money. The $8/month price is set below ChatGPT Plus ($20) to position as "AI plus your launcher."
- **WorkerMill parallel:** WorkerMill's free tier should be genuinely useful (SDK mode works, logs stream, Jira browsing works). The upgrade to Pro is natural when users want the full planning + multi-expert pipeline — features that require the cloud decision engine.

---

## VS Code Marketplace: No Paid Extensions

The VS Code Marketplace **does not support paid extensions**. No payment processing, no subscription management, no revenue sharing. This is a deliberate Microsoft decision — VS Code benefits from a free extension ecosystem.

Every monetized VS Code extension handles payments externally:

| Pattern | Examples |
|---------|---------|
| Cloud service subscription (extension is a free client) | GitHub Copilot, Tabnine, Snyk |
| External license key (purchased on developer's website) | GitLens Pro |
| Companion SaaS product (extension is the IDE entry point) | Qodo, Sourcegraph |

**WorkerMill approach:** The extension is free on the Marketplace. It connects to the agent, which connects to workermill.com. The account and billing live on workermill.com. The extension never handles payments — it just reflects the capabilities the user's plan allows.

---

## Privacy Positioning

This is WorkerMill's structural advantage over cloud-only competitors.

**The pitch:**

> Your code never touches our servers. WorkerMill workers run on your machine — the agent spawns them locally as Claude Code processes. Your source code goes directly from your machine to the LLM provider you chose (Anthropic, OpenAI, etc.). WorkerMill's cloud API only receives task metadata: summaries, status updates, structured log output, and coordination messages. We never see a line of your code.
>
> For teams that need complete isolation: our Enterprise tier runs entirely on your infrastructure. Zero egress.

**Comparison:**

| Tool | Where Code Goes | Local Option |
|------|----------------|-------------|
| GitHub Copilot | Microsoft/Azure servers | No |
| Cursor | Cursor's cloud | No (Enterprise VPC only) |
| Devin | Cognition's cloud | No (Enterprise VPC only) |
| Tabnine | Tabnine cloud (or VPC/on-prem) | Enterprise only ($39/user/month) |
| **WorkerMill** | **User's machine → LLM provider directly** | **Yes, by default** |

WorkerMill is local-first by architecture, not as a premium add-on.

---

## Implementation Roadmap

### Phase 1: Ship Free (Now)

- Publish VS Code extension to Marketplace — free, no gating
- All current functionality works with a workermill.com account
- No plan tiers yet — everyone gets full features during early adoption
- Goal: installs, feedback, testimonials

### Phase 2: Introduce Tiers (When Ready)

- Add `planTier` field to Organization model (`free`, `pro`, `enterprise`)
- API returns plan tier in agent claim response and task dispatch
- Agent checks tier and enforces capability limits:
  - Free: SDK mode only, 1 worker, no planning/critic
  - Pro: full orchestration
- VS Code extension displays upgrade prompts when the agent reports a tier limitation
- Billing via Stripe (already integrated at `api/src/routes/billing.ts`)

### Phase 3: Decision Engine Tiering

- Free users get frozen decision logic baked into the agent binary (current `decision-client.ts` fallbacks)
- Pro users get live cloud-powered decisions from `worker-decision-engine.ts`
- Ship improved error classification, quality gates, and question routing as cloud-side updates — Pro users get them immediately, free users get them in the next binary release

### Phase 4: Enterprise Self-Hosted

- Package API + PostgreSQL + decision engine as a Docker Compose or Helm chart
- License key validates the deployment (annual, offline-capable with periodic check-in)
- Custom persona authoring via admin UI
- Audit log export and compliance reporting

---

## What Not To Do

| Anti-Pattern | Who Tried It | What Happened |
|-------------|-------------|---------------|
| Kill the free tier entirely | Tabnine (April 2025), Sourcegraph (July 2025) | Lost individual developer mindshare; only works if already enterprise-established |
| Price too high at launch | Devin ($500/month → $20/month in 12 months) | 96% price cut as the market commoditized |
| Usage-based with unpredictable costs | Cursor (June 2025 credit pool migration) | Community backlash, reports of surprise charges |
| EULA-only enforcement (no technical gate) | Docker Desktop | Works for Fortune 500 procurement; individual developers ignore it |
| Charge for the extension itself | Nobody successful | VS Code Marketplace doesn't support it; paywalled extensions don't get installs |
| Make the free tier too generous | Windsurf (unlimited free autocomplete) | Massive user base but conversion to paid is the ongoing challenge |

---

## Summary

The VS Code extension is free distribution. The agent binary + cloud API is the product. Monetize orchestration intelligence (planning, critic, multi-expert, decision engine), not data access. The privacy story ("code never touches our servers") is a structural advantage worth leaning into. Ship free now, introduce tiers when adoption proves demand, and target $29/month Pro as the primary revenue tier.
