# WorkerMill Pricing and Positioning Research

*Last updated: January 2026*

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
| **Small Team** | 2-10 devs, has processes | GitHub + Jira/Linear, ships regularly |
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

- **B2B pricing**: Monthly minimums that cover infrastructure costs
- **Usage-based component**: Pay for what you use beyond included tasks
- **BYOK (Bring Your Own Keys)**: Customers provide their own AI API keys
- **Professional pricing signals professional tool**

### Pricing Tiers

| Tier | Monthly | Included Tasks | Overage (Std/Epic/Multi) |
|------|---------|----------------|--------------------------|
| **Starter** | $29/mo | 50 | $0.15 / $0.25 / $0.35 |
| **Team** | $99/mo | 250 | $0.10 / $0.20 / $0.30 |
| **Business** | $299/mo | 1000 | $0.08 / $0.15 / $0.25 |
| **Enterprise** | Custom | Custom | Volume discounts |

### Task Types

| Type | Description | Relative Cost |
|------|-------------|---------------|
| **Standard** | 1 expert, single task | 1x |
| **Epic** | 10+ experts in parallel (Anthropic) | 2x |
| **Multi-Provider** | 10+ experts, any AI provider mix | 3x |

### Payment Options

- Credit card (Stripe)
- Bitcoin/Crypto (via Stripe + Crypto.com integration)
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
| **WorkerMill** | Dev teams | Usage-based | $29-299/mo |

### Differentiation

| vs Copilot/Cursor | vs Devin |
|-------------------|----------|
| Autonomous tasks, not autocomplete | Usage-based, not $500/mo flat |
| Works while you sleep | Multi-provider flexibility |
| Ticket-driven, not editor-based | Orchestrates multiple experts |

---

## Key Messaging

### Tagline Options

1. "Turn tickets into pull requests."
2. "AI workers that ship code while you sleep."
3. "Mission control for autonomous AI coding agents."
4. "Your AI development team, on demand."

### Value Propositions

**For Small Teams:**
> Stop context-switching. Write the ticket, get the PR. Review and merge.

**For Agencies:**
> Multiply your throughput. Handle more clients without hiring.

**For Startups:**
> Move faster than your competition. Ship features around the clock.

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
| Worker containers | Variable | ~$0.025/task |

### Break-Even Analysis

At $99/mo Team tier with 250 included tasks:
- Fixed costs: ~$100/mo
- Variable costs: 250 × $0.025 = $6.25
- Revenue: $99
- Margin: ~-$7 at exactly 250 tasks (break-even at slight overage)

At higher volume or with multiple customers sharing fixed costs, margins improve significantly.

### Margin by Task Type

| Type | Your Cost | Price (Team tier) | Margin |
|------|-----------|-------------------|--------|
| Standard | $0.025 | $0.10 | 75% |
| Epic | $0.075 | $0.20 | 63% |
| Multi-Provider | $0.10 | $0.30 | 67% |

---

## Website Copy Recommendations

### Hero Section

**Headline:** Turn tickets into pull requests

**Subhead:** WorkerMill orchestrates AI coding agents that work on your backlog while you focus on what matters.

**CTA:** Start free trial / See how it works

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
STARTER          TEAM             BUSINESS
$29/mo           $99/mo           $299/mo
50 tasks         250 tasks        1000 tasks
1 user           5 users          20 users
Email support    Priority support Dedicated support
```

### Social Proof / Use Cases

- "We cleared our bug backlog in a week" - Small team
- "3x more PRs shipped per sprint" - Agency
- "Like having a junior dev that never sleeps" - Startup founder

---

## Next Steps

1. [ ] Update website hero and messaging
2. [ ] Build pricing page with tier comparison
3. [ ] Create onboarding flow that qualifies users
4. [ ] Set up Stripe billing with monthly subscriptions
5. [ ] Add usage tracking and overage billing
6. [ ] Create demo video showing ticket → PR flow

---

## Open Questions

1. **Free trial duration?** 14 days? 7 days? X tasks?
2. **Overage billing frequency?** Monthly? Real-time balance?
3. **Annual discount?** 2 months free standard?
4. **Self-hosted option?** For enterprise customers?
