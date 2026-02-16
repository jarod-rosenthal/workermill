# WorkerMill Pricing and Positioning Research

*Last updated: February 2026*

## Executive Summary

WorkerMill is **B2B developer infrastructure**, not a consumer product. The target customer is dev teams with existing workflows who want to automate routine coding tasks via AI agents.

---

## Core Product Definition

### What WorkerMill Does

| Input | Output |
|-------|--------|
| Jira/Linear ticket | Pull Request |

**WorkerMill turns tickets into pull requests.**

### What WorkerMill Is NOT

- A no-code app builder
- A replacement for knowing how to code
- A way to "build my idea" for non-technical users
- A deployment platform (though it can set up CI/CD)

---

## Target Customer

### Ideal Customer Profile

| Segment | Description | Characteristics |
|---------|-------------|-----------------|
| **Solo Dev / Small Team** | 1-10 devs, has processes | GitHub + Jira/Linear, ships regularly |
| **Agency** | Builds for clients | High volume, needs throughput |
| **Startup** | Technical founders, moving fast | Has codebase, wants to multiply output |
| **Enterprise** | Large org, compliance needs | SSO, audit logs, SLAs |

### NOT the Customer

| User Type | Why Not |
|-----------|---------|
| Non-technical founders | No codebase, won't understand PRs |
| Students learning to code | Not ready for automated workflows |
| Hobbyists without real projects | No issue tracker, no deployment path |
| "I have an idea" people | Need a dev, not a dev tool |

### Qualification Criteria

A customer must have:
- [ ] Existing codebase on GitHub/GitLab/BitBucket
- [ ] Issue tracker (Jira/Linear) OR willingness to use internal board
- [ ] Understanding of pull requests and code review
- [ ] Deployment path (existing CI/CD or willingness to set up GitHub Actions)

---

## Pricing Model

### Philosophy

- **Simple 3-tier model**: Free, Pro, Enterprise — no per-task billing, no overage rates
- **BYOK (Bring Your Own Keys)**: Free tier runs on user hardware with their own AI API keys
- **Unlimited tasks on all tiers**: No artificial task limits — pay for capacity, not usage
- **Professional pricing signals professional tool**

### Pricing Tiers

| | **Free** | **Pro** | **Enterprise** |
|---|---------|---------|----------------|
| **Price** | $0/mo | $29/mo (launch: $14.50) | Custom |
| **Users** | 1 | 5 | Unlimited |
| **Concurrent Workers** | 1 | 5 | Unlimited |
| **Expert Personas/Task** | 3 | Unlimited | Unlimited |
| **Log Retention** | 14 days | 90 days | Unlimited |
| **Tasks** | Unlimited | Unlimited | Unlimited |
| **Execution** | Local + BYOK | Cloud + warm pool | Dedicated infrastructure |
| **Support** | Community | Priority | Dedicated CSM |
| **SSO/SAML** | - | - | Yes |
| **Compliance (SOC 2, HIPAA)** | - | - | Yes |

### What Each Tier Unlocks

| Tier | Key Value |
|------|-----------|
| **Free** | Get started with zero cost. Run workers locally with your own AI keys. Perfect for solo devs evaluating the platform. |
| **Pro** | Cloud execution with warm worker pools for faster start times. Team collaboration with 5 seats. Extended log retention for debugging and audits. |
| **Enterprise** | Full compliance suite (SSO/SAML, SOC 2, HIPAA BAA). Dedicated infrastructure with custom SLAs. Unlimited everything. |

### Payment Options

- Credit card (Stripe)
- Invoice (Enterprise only)

---

## Competitive Positioning

### Landscape

| Tool | Target | Model | Price Point |
|------|--------|-------|-------------|
| GitHub Copilot | Individual devs | Seat-based | $10-19/mo |
| Cursor | Individual devs | Seat-based | $20/mo |
| Devin | Dev teams | Seat-based | $500/mo |
| Factory | Enterprise | Custom | Unknown |
| **WorkerMill** | Dev teams | Capacity-based | Free - $29/mo |

### Differentiation

| vs Copilot/Cursor | vs Devin |
|-------------------|----------|
| Autonomous tasks, not autocomplete | Free tier available, Pro at $29/mo vs $500/mo |
| Works while you sleep | Multi-provider flexibility (BYOK) |
| Ticket-driven, not editor-based | Orchestrates multiple expert personas |

### Pricing Advantage

WorkerMill's BYOK model means customers pay AI providers directly for tokens. The platform fee covers orchestration, monitoring, and workflow automation — not AI compute. This makes WorkerMill dramatically cheaper than platforms that bundle AI costs into their pricing.

---

## Key Messaging

### Tagline Options

1. "Turn tickets into pull requests."
2. "AI workers that ship code while you sleep."
3. "Mission control for autonomous AI coding agents."
4. "Your AI development team, on demand."

### Value Propositions

**For Solo Devs (Free):**
> Start automating your backlog today. Zero cost, zero commitment. Bring your own API keys and run locally.

**For Small Teams (Pro):**
> Stop context-switching. Write the ticket, get the PR. Cloud workers with warm pools ship faster.

**For Agencies (Pro):**
> Multiply your throughput. Handle more clients without hiring. 5 concurrent workers running 24/7.

**For Enterprise:**
> Full compliance, unlimited scale, dedicated support. SSO/SAML, SOC 2 ready, custom SLAs.

### How It Works (Simple)

1. Connect your GitHub repo
2. Connect Jira or Linear
3. Add the `workermill` label to a ticket
4. Get a pull request

### Deployment Messaging

> **Already have CI/CD?** Your pipeline handles deployment after merge.
>
> **Don't have CI/CD?** WorkerMill can set up GitHub Actions for you.

WorkerMill creates PRs. Deployment happens through your existing pipeline or one we help you build.

---

## Objection Handling

### "Will it deploy my code?"

> WorkerMill creates pull requests with code changes. If you have CI/CD set up (GitHub Actions, Vercel, etc.), merging the PR triggers deployment automatically. If you don't have CI/CD, we can set up GitHub Actions for you, or you deploy manually.

### "What if I don't use Jira?"

> You can use our built-in task board, or connect Linear. We're adding more integrations based on customer demand.

### "Is this like Copilot?"

> Copilot helps you write code in your editor. WorkerMill is different - you give it a ticket, and it autonomously creates a complete pull request. It works while you're in meetings, sleeping, or focused on other things.

### "What AI models does it use?"

> You bring your own API keys. WorkerMill supports Anthropic (Claude), OpenAI, Google (Gemini), and self-hosted Ollama. You choose the model for each task.

### "Why is there a free tier?"

> We believe the best way to evaluate an AI coding tool is to use it on your real codebase. The free tier gives you unlimited tasks with 1 worker — enough to see real results before upgrading.

---

## Infrastructure Economics

### Cost Structure

| Resource | Type | Monthly Cost |
|----------|------|--------------|
| API (ECS Fargate) | Fixed | ~$18-36 |
| RDS PostgreSQL | Fixed | ~$30 |
| NAT Gateway / VPC Endpoints | Fixed | ~$14-35 |
| CloudWatch/S3/misc | Fixed | ~$15 |
| **Fixed floor** | | **~$77-116** |
| Worker containers (Pro/Enterprise) | Variable | ~$0.025/task |

### Free Tier Economics

The Free tier has **zero marginal cost** to WorkerMill:
- Workers run on the user's local machine (Docker containers)
- AI tokens paid directly by user (BYOK)
- Only platform API calls hit WorkerMill infrastructure
- Negligible per-user cost at the API layer

### Pro Tier Margin

At $29/mo (launch $14.50/mo) with cloud execution:
- Average 5 concurrent workers, usage varies
- Compute cost per task: ~$0.025
- At 200 tasks/month: $5 compute cost
- **Margin: ~83% at $29/mo, ~66% at launch price**

### Enterprise Margin

Custom pricing covers dedicated infrastructure costs with target 70%+ margins.

---

## Website Copy Recommendations

### Hero Section

**Headline:** Turn tickets into pull requests

**Subhead:** WorkerMill orchestrates AI coding agents that work on your backlog while you focus on what matters.

**CTA:** Get started free / See how it works

### How It Works Section

```
1. CONNECT
   Link your GitHub repo and Jira/Linear

2. LABEL
   Add 'workermill' to any ticket

3. REVIEW
   Get a pull request, review the code

4. MERGE
   Your CI/CD handles the rest
```

### Pricing Section

```
FREE             PRO              ENTERPRISE
$0/mo            $29/mo           Custom
Unlimited tasks  Unlimited tasks  Unlimited tasks
1 user           5 users          Unlimited users
1 worker         5 workers        Unlimited workers
Local + BYOK     Cloud + warm     Dedicated infra
```

### Social Proof / Use Cases

- "We cleared our bug backlog in a week" - Small team
- "3x more PRs shipped per sprint" - Agency
- "Like having a junior dev that never sleeps" - Startup founder

---

## Next Steps

1. [x] Update website hero and messaging
2. [x] Build pricing page with tier comparison
3. [ ] Create onboarding flow that qualifies users
4. [x] Set up Stripe billing with monthly subscriptions
5. [ ] Add usage tracking dashboard
6. [ ] Create demo video showing ticket → PR flow

---

## Open Questions

1. **Launch pricing duration?** How long does the $14.50 introductory rate last?
2. **Annual discount?** 2 months free standard?
3. **Self-hosted option?** For enterprise customers who need on-prem?
4. **Pro trial?** Should Pro have a 14-day free trial?
