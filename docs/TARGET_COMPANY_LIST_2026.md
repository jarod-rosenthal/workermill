# WorkerMill Target Company List 2026

**Purpose:** Targeted outreach list for companies at the right growth stage to need WorkerMill
**Last Updated:** January 29, 2026

---

## Executive Summary

This list identifies companies that match WorkerMill's Ideal Customer Profile (ICP):
- **5-50 employees** (small enough to make fast decisions, desperate for capacity)
- **Seed to Series A funded** (recent funding, aggressive hiring, budget pressure)
- **Using modern dev workflow** (Linear, GitHub, CI/CD)
- **Building fast, shipping constantly** (backlog pressure is real)

**Key insight:** Big companies (Vercel, Ramp, Mercury) can't make decisions quickly. Target **small, fast-moving startups** that raised in the last 12 months and are actively hiring.

---

## What WorkerMill Actually Is (For Outreach Clarity)

**WorkerMill is NOT another AI coding assistant.** It's an **AI Engineering Organization** that you configure for your stack, your domain, your workflow.

### The Product Reality

| What You Give It | What It Does | What You Get |
|------------------|--------------|--------------|
| A PRD in Linear/Jira | Spawns **your custom AI experts** working **in parallel** | A reviewed PR ready to merge |

### The Architecture

1. **You write a PRD/Epic** as a Linear or Jira ticket
2. **Planning Agent** decomposes it into stories with dependencies
3. **Multiple expert personas execute in parallel** - each with their own:
   - **Custom directives** (instructions for how they work)
   - **Custom AI provider** (route QA to Gemini, Backend to Claude, Security to GPT-5)
   - **Custom skills and specializations**
4. **Real-time coordination** - experts post decisions, ask questions, check sibling context
5. **Tech Lead (configurable)** reviews consolidated work
6. **Reviewed PR** comes out

### What Makes WorkerMill Different

**1. Persona Studio - Build Your Own AI Team**

WorkerMill ships with 16 built-in personas, but you can **create your own**:

| Built-In Examples | Custom Examples You'd Create |
|-------------------|------------------------------|
| backend_developer | unity_game_developer |
| frontend_developer | shopify_app_developer |
| security_engineer | salesforce_admin |
| devops_engineer | terraform_specialist |
| qa_engineer | playwright_expert |
| data_engineer | dbt_modeler |
| ml_engineer | pytorch_researcher |
| mobile_developer_ios | flutter_developer |
| mobile_developer_android | react_native_dev |
| api_developer | graphql_architect |
| database_administrator | postgres_dba |
| tech_lead | your_tech_lead |
| tech_writer | api_documenter |

Each persona has:
- **Custom directives** - Markdown instructions that define how it works
- **Custom scripts** - Execution scripts for deployment, testing, etc.
- **Skills** - Keywords for automatic persona assignment
- **Risk level** - How much autonomy it has

**2. Multi-Provider Routing - Right Model for Each Expert**

Route each persona to a different AI provider:

```json
{
  "qa_engineer": { "provider": "google", "model": "gemini-2.0-flash" },
  "backend_developer": { "provider": "anthropic", "model": "claude-sonnet-4" },
  "security_engineer": { "provider": "openai", "model": "gpt-5.1-codex" },
  "devops_engineer": { "provider": "ollama", "model": "qwen2.5-coder:32b" }
}
```

**3. Parallel Execution with Real-Time Coordination**

Not sequential. Not one agent. Multiple experts working simultaneously:
- Post decisions: `DEC-001: Using JWT for auth`
- Ask questions: `Q-001: What endpoint format should I use?`
- Answer siblings: `A-001: Use /api/v1/resource/:id`
- Check context before modifying shared files

**4. BYOK (Bring Your Own Keys)**

Your API keys. Zero markup. Full cost transparency.

### Why This Is Different From Everything Else

| Tool | Model | WorkerMill |
|------|-------|------------|
| **Copilot** | One model, autocomplete | Multiple custom experts, full autonomy |
| **Cursor** | One model, IDE-bound | Runs independently, configurable team |
| **Devin** | One agent, opaque | Custom team you design, full visibility |
| **Factory** | Enterprise, fixed | BYOK, customizable, any scale |

**The analogy:**
- Copilot = Someone finishing your sentences
- Devin = Hiring one junior who works alone
- **WorkerMill = Hiring a configurable engineering org that you design**

### The Pitch (Correct Version)

> "Design your AI engineering team. Route each persona to the right model. Watch them coordinate on your Epics."
>
> - Build custom personas for your stack (Unity, Shopify, Terraform, whatever)
> - Route each one to Anthropic, OpenAI, Google, or self-hosted Ollama
> - Planning Agent decomposes requirements into parallel stories
> - Real-time coordination feed shows decisions, questions, progress
> - Tech Lead reviews before humans see it
> - BYOK: Your API keys, zero markup, full cost control

**What NOT to say:**
- ❌ "Ship faster" (generic)
- ❌ "AI coding assistant" (we're not assistants)
- ❌ "13 experts" (that's the DEFAULT - the point is they're CUSTOMIZABLE)

**What TO say:**
- ✅ "Design your AI engineering team - custom personas, custom models"
- ✅ "Route Backend to Claude, QA to Gemini, DevOps to self-hosted Ollama"
- ✅ "Watch your custom team coordinate on Epics in real-time"
- ✅ "Not one agent struggling alone - a team you designed"

---

## Tier 1: HOT LEADS - Small, Recent Funding, Building Fast (5-30 employees)

These are the companies most likely to convert quickly - small teams, recent funding, actively building.

### Developer Tools & Infrastructure (Highest Affinity)

| Company | Description | Team Size | Funding | Why Target Now |
|---------|-------------|-----------|---------|----------------|
| **Mastra** | TypeScript AI agent framework | ~36 | $13M Seed (2025) | Ex-Gatsby founders, YC-backed, open-source, actively building |
| **Trigger.dev** | Background jobs platform | ~10-15 | $3M Seed (YC) | Small team, London-based, shipping fast |
| **Hatchet** | Durable execution/queues | ~6-10 | $5.7M Seed (YC) | Intentionally small team, hiring founding engineers |
| **Kilo Code** | Open-source coding agent | ~15-20 | $8M Seed (2025) | 750K downloads, 6T tokens/month, scaling fast |
| **Windmill** | Open-source workflow engine | ~10-22 | $500K Seed | Paris-based, open-source, resource-constrained |
| **Dub.co** | Link management platform | ~5-10 | Seed | Steven Tey (ex-Vercel), tiny team, 18.5K GitHub stars |
| **Resend** | Email API for developers | ~23 | Series A | YC-backed, 400K users, small team for scale |
| **Greptile** | AI code understanding API | ~10-15 | $4.1M Seed (YC W24) | Small team, Initialized Capital |

### Billing & Payments Infrastructure

| Company | Description | Team Size | Funding | Why Target Now |
|---------|-------------|-----------|---------|----------------|
| **Hyperline** | Automated B2B billing | ~25 | $14.4M total (Jan 2025) | Just raised $10M, Index Ventures, scaling |
| **Polar** | Open-source billing for AI SaaS | ~15-20 | $10M Seed (2025) | Accel-led, European, billing for AI companies |
| **Lago** | Usage-based billing platform | ~40 | $22.1M total | Open-source, growing fast |

### AI Infrastructure & Tools

| Company | Description | Team Size | Funding | Why Target Now |
|---------|-------------|-----------|---------|----------------|
| **Abundant** | Teleoperation for AI agents | ~10-20 | YC W25 | Human-in-the-loop for AI agents |
| **Browser Use** | Open-source browser automation | ~5-15 | YC W25 | Viral growth, 28K daily downloads |
| **Asteroid** | Runtime supervision for AI agents | ~10-15 | YC W25 | HIPAA-compliant, enterprise customers |
| **Confident AI** | LLM evaluation & red-teaming | ~10-15 | YC W25 | AI safety/quality tooling |
| **Castari** | Secure AI agent sandboxes | ~10-15 | YC F25 | Deploy agents with one command |
| **TrainLoop** | Improve reasoning models | ~5-10 | YC W25 | Minimal developer effort |
| **Empromptu** | Enterprise AI app builder | ~10-15 | $2M Pre-seed | Build AI apps from prompts |

**Outreach Strategy:** "You build AI infrastructure. We have Persona Studio (create custom personas), Provider Routing (route each to different models), and real-time coordination. Let's compare how we handle multi-agent orchestration."

---

## Tier 2: YC 2024-2025 Batch Companies (Fast Decision Makers)

Recent YC companies are used to moving fast and have budget from YC + follow-on funding.

### YC W25 / S25 Batch (Hottest - Just Funded)

| Company | Description | Batch | Why Target Now |
|---------|-------------|-------|----------------|
| **BootLoop** | Firmware in minutes via AI | S25 | Hardware + AI, complex builds |
| **Hyperspell** | Memory for AI agents | F25 | Building AI infrastructure |
| **Daytona** | Secure dev environments for AI | Recent | Infrastructure for AI-generated code |
| **Digger** | CI/CD for Terraform | 2020, $3.6M Seed | 300+ orgs, open-source |
| **Modelence** | Full-stack TypeScript platform | Recent | Next.js + Vercel + Supabase in one |
| **Cedana** | Live migration for AI workloads | S23 | GPU orchestration |
| **Cerebrium** | Serverless AI platform | Recent | AI deployment |
| **NextByte** | Hiring AI "vibe coders" | W25 | AI-native recruiting |
| **HUD** | Evals for computer use agents | W25 | Working with frontier AI labs |
| **AfterQuery** | Expert datasets for fine-tuning | W25 | Data for AI |
| **Gulp** | Real-time data pipelines | W25 | Fraud, recommendations |
| **Exla** | Model quantization | W25 | Reduce AI memory usage |
| **Augento** | Fine-tuning as a service | W25 | Fix struggling AI agents |

### YC 2024 Batch (Slightly More Established)

| Company | Description | Funding | Why Target Now |
|---------|-------------|---------|----------------|
| **VideoGen** | AI video generation | $3.5M Seed (S24) | Growing fast |
| **PermitFlow** | Construction permitting | $31M Series A | Kleiner Perkins led |
| **Rosebud AI** | AI game asset generation | ~$14.8M | 18 people, $2.7M ARR |
| **Balance** | AI accountant for SMBs | Seed | 20 customers, +20% MoM |
| **Gambit Robotics** | AI kitchen assistant | Seed | Hiring founding engineers |
| **Ploid AI** | AI bioinformatics platform | Pre-seed | Barcelona, hiring engineers |

**Outreach Strategy:** "Design your AI team in Persona Studio. Create personas for YOUR stack. Route Backend to Claude, QA to Gemini, DevOps to Ollama. Watch them coordinate in real-time on your Epics."

---

## Tier 3: Small But Growing SaaS (20-50 Employees)

These companies are big enough to have real backlogs but small enough to make quick decisions.

### Auth & Identity (They Understand Developer Pain)

| Company | Description | Team Size | Funding | Why Target Now |
|---------|-------------|-----------|---------|----------------|
| **Kinde** | Auth0/Clerk alternative | ~30-50 | Series A | Growing fast, developer-focused |
| **Stytch** | Auth infrastructure | ~50-80 | Series B | Dev-focused, scaling |

### Databases & Infrastructure

| Company | Description | Team Size | Funding | Why Target Now |
|---------|-------------|-----------|---------|----------------|
| **Turso** | Edge database (libSQL) | ~20-40 | Series A | Fast-growing, small team |
| **Upstash** | Serverless Redis/Kafka | ~30-50 | Series A | Dev tools, scaling |
| **Convex** | Reactive backend | ~30-50 | Series A, a16z | Small team, ambitious product |
| **EdgeDB** | Graph-relational database | ~20-40 | Series A | Developer experience focus |

### Dev Tools (Highest Affinity)

| Company | Description | Team Size | Funding | Why Target Now |
|---------|-------------|-----------|---------|----------------|
| **Depot** | Fast container builds | ~10-20 | Seed | Small, dev infrastructure |
| **Railway** | Deploy anything | ~30-50 | Series A | Fast deploy, small team |
| **Inngest** | Event-driven workflows | ~15-30 | Series A | Background jobs competitor |

### Vertical SaaS (Small Teams, Big Markets)

| Company | Description | Team Size | Funding | Why Target Now |
|---------|-------------|-----------|---------|----------------|
| **Attio** | Modern CRM | ~30-50 | Series B | Startup-focused CRM |
| **Owner** | Restaurant marketing | ~50-80 | $120M Series C (2025) | Just became unicorn |

**Outreach Strategy:** "Your stack, your personas. Create database_specialist for Turso. Route to Claude for complex queries, Gemini for tests. Watch custom team coordinate. PR comes out with your patterns, your standards."

---

## Tier 4: Open-Source Companies (Community + Commercial)

Open-source companies often have small teams relative to their user base - perfect for AI augmentation.

| Company | Description | Team Size | Community Size | Why Target Now |
|---------|-------------|-----------|----------------|----------------|
| **Cal.com** | Open-source scheduling | ~33 | Huge OSS community | Small team, big product surface |
| **Infisical** | Secret management | ~20-30 | Growing OSS | Security-focused |
| **Documenso** | Open-source DocuSign | ~10-20 | Active OSS | Tiny team, ambitious |
| **Formbricks** | Open-source Typeform | ~10-15 | Growing | Survey platform, small team |
| **Plausible** | Privacy-focused analytics | ~10-15 | Large OSS | Bootstrapped, lean team |
| **Medusa** | Open-source Shopify | ~30-50 | 25K+ GitHub stars | E-commerce, complex |
| **Appsmith** | Low-code platform | ~50-80 | Large OSS | Internal tools |
| **Novu** | Open-source notifications | ~20-30 | Growing | Notification infrastructure |

**Outreach Strategy:** "Design maintainer personas for YOUR project. Your conventions in the directives. Route sensitive security work to GPT-5, docs to Gemini. Watch your custom OSS team coordinate on issues."

---

## Tier 5: Small Development Agencies (10-30 people)

Boutique agencies can make fast decisions and would directly increase margins with AI workers.

| Company | Type | Size | Why Target Now |
|---------|------|------|----------------|
| **Thoughtbot** | Design + dev consultancy | ~80 | Premium brand, lean operations |
| **Eight Bit Studios** | Mobile + web | ~30-50 | Chicago-based, client work |
| **Booster Labs** | Startup studio | ~20-30 | Build products fast |
| **Significa** | Digital product agency | ~20-30 | Portugal-based, quality focused |
| **Pleo Design** | Product design + dev | ~15-25 | Small, European |
| **Little Big Things** | Mobile development | ~10-20 | App development |
| **Pixelmatters** | Digital products | ~30-50 | Portugal, scaling |
| **Ustwo** | Digital product studio | ~50-80 | Creative agency |

**Outreach Strategy:** "Client gives you a spec. Create custom personas for their stack. Route each to the right model. Your AI team coordinates overnight. You review the PR. Higher margins, custom delivery."

---

## Tier 6: AVOID - Too Big, Slow Decisions

These companies are too large to make quick decisions. They require enterprise sales cycles.

| Company | Why Avoid (For Now) |
|---------|---------------------|
| Vercel (823 employees) | Too big, procurement process |
| Ramp (500+ employees) | Enterprise sales cycle |
| Mercury (300+ employees) | Compliance/security reviews |
| Brex (500+ employees) | Long sales cycle |
| Notion (200+ employees) | Corporate procurement |
| Stripe (1000+ employees) | 6-12 month sales cycle |
| Any company with "Head of Procurement" | Wrong buying motion |

**Save these for later** when you have case studies and enterprise features (SSO, SOC 2).

---

## Qualification Scorecard (Updated for Fast Movers)

Use this to prioritize outreach - focus on **speed to decision**, not company size.

| Signal | Points | How to Verify |
|--------|--------|---------------|
| **< 50 employees** | +5 | LinkedIn, about page |
| **Raised in last 6 months** | +5 | Crunchbase, TechCrunch |
| **YC-backed** | +4 | YC directory |
| **Founder-led (CEO is technical)** | +4 | LinkedIn |
| **Open-source project** | +3 | GitHub presence |
| **Active GitHub commits** | +3 | Check repo activity |
| **Hiring founding engineers** | +4 | Indicates growth + capacity need |
| **Uses Linear** | +2 | Job postings, public mentions |
| **Developer tools company** | +3 | Product focus |
| **Mentioned capacity/hiring pain on Twitter** | +5 | Social listening |

**Priority threshold:** 15+ points = immediate outreach
**Sweet spot:** 10-30 employees, raised 3-12 months ago, hiring engineers

---

## Outreach Templates (Corrected - Focuses on Customization + Coordination)

### Template 1: For YC Companies / Recent Fundraise

> Subject: Build your AI engineering team (not use someone else's)
>
> Hi [Name],
>
> This isn't Copilot. This isn't one agent doing tasks.
>
> WorkerMill lets you **design your own AI engineering team**:
>
> - Create custom personas for your stack (Unity? Shopify? Terraform? Whatever you need)
> - Route each persona to different models (QA → Gemini, Backend → Claude, DevOps → self-hosted Ollama)
> - Watch them coordinate in parallel on your Epics - posting decisions, asking each other questions, reviewing each other's work
>
> You write a PRD in Linear. Planning Agent decomposes it. Your custom team executes in parallel. Tech Lead reviews. PR comes out.
>
> It's the difference between "using an AI tool" and "running an AI engineering org you designed."
>
> Free pilot for YC companies. Your API keys, zero markup.

### Template 2: For Tiny Teams (< 20 people)

> Subject: Design your AI team for [your stack]
>
> Hi [Name],
>
> [Company] is [Y] people building [product]. You probably have a specific stack and workflow.
>
> What if you could design an AI engineering team that matches it?
>
> WorkerMill lets you:
> - **Create custom personas** - not just "backend_developer" but "your_stack_specialist"
> - **Route to different models** - QA uses Gemini, Backend uses Claude, DevOps uses your self-hosted Ollama
> - **Define their instructions** - custom directives for how each persona works
> - **Watch them coordinate** - real-time feed of decisions, questions, and progress
>
> You give it an Epic. Your custom team executes in parallel. Tech Lead reviews. You get a PR.
>
> This isn't "AI writes code" - it's "your AI engineering org runs sprints."
>
> Want to see what a custom team looks like?

### Template 3: For Open-Source Companies

> Subject: Custom AI maintainers for [Project]
>
> Hi [Name],
>
> [Project] has [X] stars with a team of [Y]. You probably have project-specific patterns, conventions, and workflows.
>
> What if you could design AI maintainers that actually know your project?
>
> WorkerMill lets you:
> - Create custom personas (e.g., "[project]_core_maintainer", "[project]_docs_writer")
> - Define their directives with your project's conventions
> - Route each to different models based on task type
> - Watch them coordinate on issues in parallel
>
> Not generic "AI coding" - a team you designed for YOUR project.
>
> Free pilot for OSS maintainers. Your API keys, zero markup.

### Template 4: For Developer Tools Companies

> Subject: The AI team orchestration you'd want to build
>
> Hi [Name],
>
> You're building dev tools. You've probably thought about AI agents.
>
> We built what you might build next:
>
> - **Persona Studio** - Create custom AI personas with directives, scripts, and skills
> - **Provider Routing** - Route each persona to Anthropic, OpenAI, Google, or Ollama
> - **Parallel Coordination** - Experts post decisions, ask questions, check sibling context
> - **BYOK** - Your API keys, zero markup, full cost transparency
>
> The architecture: Planning Agent → Story decomposition → Parallel expert execution → Real-time coordination → Tech Lead review → PR
>
> Want to see the coordination protocol? Happy to do a deep dive on the orchestration.

### Template 5: For AI/Agent Companies (Highest Affinity)

> Subject: How we coordinate N custom AI agents in parallel
>
> Hi [Name],
>
> You're building [AI thing]. You think about agent coordination.
>
> We ship with 16 personas, but the real product is **Persona Studio**:
>
> - Create any persona you need (Unity game dev? Shopify admin? Terraform specialist?)
> - Write custom directives (Markdown instructions)
> - Route each to a different provider (QA → Gemini, Security → GPT-5, Backend → Claude)
> - Watch them coordinate via real-time feed:
>   - `DEC-001: Using JWT for auth` (decisions)
>   - `Q-001: What endpoint format?` (questions)
>   - Sibling context checks before shared file edits
>
> Not 13 fixed agents. A customizable team architecture.
>
> Would love to compare notes on coordination protocols.

### Template 6: For Companies with Specific Stacks

> Subject: AI team built for [React Native / Unity / Terraform / whatever]
>
> Hi [Name],
>
> You're building with [specific stack]. Generic AI tools don't know your patterns.
>
> WorkerMill lets you design AI personas for YOUR stack:
>
> **Example for [stack]:**
> ```
> - [stack]_core_developer: Main implementation
> - [stack]_test_writer: Test coverage
> - [stack]_docs_maintainer: Documentation
> - [stack]_reviewer: Code review
> ```
>
> Each persona has:
> - Custom directives (your coding standards, your patterns)
> - Custom model routing (use Claude for complex, Gemini for tests)
> - Skills-based auto-assignment from ticket content
>
> Give it an Epic. Your custom team coordinates in parallel. Reviewed PR comes out.
>
> Want to set up a [stack]-specific team together?

---

## Research Sources (January 2026)

### Funding & Startup Discovery
- [Y Combinator Company Directory](https://www.ycombinator.com/companies) - Filter by batch, industry, hiring
- [YC W25 Demo Day Coverage](https://techcrunch.com/2025/03/13/10-startups-to-watch-from-y-combinators-w25-demo-day/)
- [YC S25 Batch Analysis](https://www.extruct.ai/blog/ycs25/) - 160 AI startups breakdown
- [Top Startups - Sequoia, YC, a16z](https://topstartups.io/) - Sortable by funding round
- [Growth List - Seed Startups 2026](https://growthlist.co/seed-startups/)
- [Fundraise Insider - Seed Stage](https://fundraiseinsider.com/blog/seed-startups/)

### Recent Funding News
- [TechCrunch - January 2026 AI Funding](https://techcrunch.com/2026/01/)
- [Crunchbase - AI Funding Trends](https://news.crunchbase.com/ai/)
- [Hacker News - Who is Hiring (Jan 2026)](https://nchelluri.github.io/hnjobs/)

### Developer Tools Landscape
- [DevTools Landscape 2025](https://insights.tryspecter.com/devtools-landscape-2025/) - 550+ companies
- [Mastra $13M Seed Announcement](https://mastra.ai/blog/seed-round)
- [Hyperline $10M Funding](https://techcrunch.com/2025/01/16/hyperline-secures-10-million-for-its-automated-billing-platform/)
- [Kilo Code $8M Seed](https://technews180.com/funding-news/open-source-coding-agent-kilo-raises-8m-in-seed-funding/)

### Company Research
- [Tracxn](https://tracxn.com) - Team size, funding, competitors
- [PitchBook](https://pitchbook.com) - Valuations, investors
- [Crunchbase](https://crunchbase.com) - Funding rounds

---

## Action Items (Prioritized)

### This Week: Hot Leads (Tier 1)
- [ ] Find founder emails for: Mastra, Trigger.dev, Hatchet, Dub.co, Greptile
- [ ] Send personalized outreach to founders (not VP Eng - these are small teams)
- [ ] Offer free 30-day pilot, no commitment
- [ ] Join their Discord/Slack communities if public

### Week 2: YC Batch Companies (Tier 2)
- [ ] Go through YC W25/S25 directory, filter for developer tools
- [ ] Reach out via Twitter/X (founders are active there)
- [ ] Offer "YC companies get first month free"
- [ ] Ask for intros from any YC connections

### Week 3: Open-Source Companies (Tier 4)
- [ ] Identify maintainers of popular OSS projects
- [ ] Reach out offering help with issue triage
- [ ] Position as "AI contributor that never sleeps"

### Ongoing: Signal Monitoring
- [ ] Set Google Alerts for: "raised seed", "YC W26", "hiring founding engineer"
- [ ] Monitor Hacker News "Who is Hiring" threads monthly
- [ ] Watch Twitter for founders complaining about capacity/hiring
- [ ] Track new YC batch announcements (W26 demo day ~March 2026)

---

## Contact Information Database

### Tier 1: Hot Leads - Verified Contacts

| Company | Founder | Email | Twitter | LinkedIn |
|---------|---------|-------|---------|----------|
| **Mastra** | Sam Bhagwat (CEO) | — | [@mastra_ai](https://x.com/mastra_ai) | [sambhagwat](https://linkedin.com/in/sambhagwat/) |
| **Mastra** | Shane Thomas (CPO) | — | — | [smthomas3](https://linkedin.com/in/smthomas3/) |
| **Trigger.dev** | Matt Aitken (CEO) | matt@trigger.dev | — | [mattaitken1985](https://linkedin.com/in/mattaitken1985/) |
| **Trigger.dev** | James Ritchie | — | — | [jamesritchiecv](https://linkedin.com/in/jamesritchiecv/) |
| **Hatchet** | Alexander Belanger (CEO) | — | — | [alexander-belanger](https://linkedin.com/in/alexander-belanger-aa3974135/) |
| **Dub.co** | Steven Tey (CEO) | steven@dub.co | [@steventey](https://x.com/steventey) | [steventey](https://linkedin.com/in/steventey/) |
| **Hyperline** | Lucas Bédout (CEO) | lucas@hyperline.co | — | [lucasbedout](https://linkedin.com/in/lucasbedout/) |
| **Polar** | Birk Jernström (CEO) | birk@polar.sh | [@birk](https://x.com/birk) | — |
| **Resend** | Zeno Rocha (CEO) | zeno@resend.com | [@zenorocha](https://x.com/zenorocha) | [zenorocha](https://linkedin.com/in/zenorocha/) |
| **Greptile** | Daksh Gupta (CEO) | daksh@greptile.com | [@dakshgup](https://x.com/dakshgup) | [dakshg](https://linkedin.com/in/dakshg/) |
| **Windmill** | Ruben Fiszel (CEO) | contact@windmill.dev | [@rubenfiszel](https://x.com/rubenfiszel) | — |
| **Browser Use** | Magnus Müller | — | [@mamagnus00](https://x.com/mamagnus00) | [magnus-mueller](https://ch.linkedin.com/in/magnus-mueller) |
| **Kilo Code** | Sid Sijbrandij (ex-GitLab CEO) | — | — | — |

### Tier 3-4: Additional Verified Contacts

| Company | Founder | Email | Twitter | LinkedIn |
|---------|---------|-------|---------|----------|
| **Cal.com** | Bailey Pumfleet (CEO) | bailey@cal.com | [@BaileyPumfleet](https://x.com/BaileyPumfleet) | [baileypumfleet](https://linkedin.com/in/baileypumfleet/) |
| **Cal.com** | Peer Richelsen (Chairman) | — | [@peer_rich](https://x.com/peer_rich) | [peer-richelsen](https://linkedin.com/in/peer-richelsen-221233138/) |
| **Turso** | Glauber Costa (CEO) | glauber@turso.tech | [@glcst](https://x.com/glcst) | [glommer](https://linkedin.com/in/glommer/) |

### Notes on Outreach
- **Twitter/X is fastest** for founders who are active there (Steven Tey, Birk, Zeno, Daksh, Peer Richelsen)
- **LinkedIn InMail** for those without public Twitter (Lucas Bédout, Alexander Belanger)
- **Email patterns**: Most use firstname@company.com
- **YC network**: Mastra, Trigger.dev, Hatchet, Greptile, Windmill, Browser Use, Cal.com are all YC - leverage YC intros if you have them
- **Peer Richelsen note**: He explicitly prefers Twitter DMs over LinkedIn

---

## Quick Wins: Companies to Contact This Week

| Company | Best Contact | Why Now | Pitch Angle |
|---------|--------------|---------|-------------|
| **Mastra** | Twitter [@mastra_ai](https://x.com/mastra_ai) or LinkedIn Sam | Just raised $13M, building AI agents | "You build agent frameworks. We have Persona Studio for designing AI teams. Compare coordination protocols?" |
| **Trigger.dev** | matt@trigger.dev | Small team, shipping fast | "Create a trigger_dev_expert persona. Route to Claude. Watch it coordinate with QA/Docs on Epics." |
| **Hatchet** | LinkedIn Alexander Belanger | Hiring founding engineers | "Instead of hiring, design AI personas for your stack. Route each to different models. Watch them coordinate." |
| **Dub.co** | [@steventey](https://x.com/steventey) on Twitter | Tiny team, 18K GitHub stars | "5 people, 18K stars. Design link_management personas with your conventions. Multi-model routing." |
| **Hyperline** | LinkedIn Lucas Bédout | Just raised €9.7M in Jan 2025 | "Design billing_engineer personas with your Stripe patterns. Route complex → Claude, tests → Gemini." |
| **Polar** | [@birk](https://x.com/birk) on Twitter | $10M Accel-led, OSS billing | "Custom personas for OSS billing. Your standards in directives. Self-hosted Ollama for sensitive work." |
| **Resend** | zeno@resend.com | 400K users, YC-backed | "Design email_infrastructure personas. Route transactional logic → Claude, test coverage → Gemini." |
| **Greptile** | daksh@greptile.com | $25M Series A, AI code review | "You do AI code review. We do AI code WRITING with built-in review. Complementary?" |
| **Browser Use** | [@mamagnus00](https://x.com/mamagnus00) | $17M seed, viral YC W25 | "Viral growth = custom needs. Design browser_agent personas. Route to right models. Parallel execution." |

---

## Success Metrics

| Metric | Target (30 days) |
|--------|------------------|
| Outreach sent | 50 (quality > quantity) |
| Response rate | 20%+ (small companies respond more) |
| Demo calls booked | 10 |
| Pilots started | 5 |
| Converted to paid | 2-3 |

---

## Key Insight

**Small companies (< 50 people) can say yes in one meeting.**

Big companies need:
- Multiple stakeholders
- Security review
- Procurement process
- 3-6 month sales cycle

Small companies need:
- One founder who sees the value
- A free trial that works
- Quick time-to-value

**Target founders, not VP Engs. Offer pilots, not contracts.**

---

## The Differentiator to Hammer Home

Every AI coding tool says "ship faster." Nobody else offers this:

> **"Design your own AI engineering team. Custom personas for your stack. Route each to different models. Watch them coordinate on your Epics."**

**The three pillars:**

1. **Persona Studio** - Create custom personas (Unity dev? Shopify admin? Your stack specialist?)
2. **Provider Routing** - Route each persona to Anthropic, OpenAI, Google, or self-hosted Ollama
3. **Parallel Coordination** - Experts post decisions, ask questions, check sibling context in real-time

**Competition comparison:**

| Tool | Customization | Multi-Model | Coordination |
|------|--------------|-------------|--------------|
| Copilot | ❌ | ❌ | ❌ |
| Cursor | ❌ | ❌ | ❌ |
| Devin | ❌ | ❌ | ❌ (single agent) |
| **WorkerMill** | ✅ Full Persona Studio | ✅ Per-persona routing | ✅ Real-time feed |

**WorkerMill = a customizable AI engineering org, not a fixed tool**

---

## Demo Script (What to Show)

1. **Show Persona Studio** - "These are the built-in personas. But watch - I'll create one for [their stack]"
2. **Create a custom persona** - "unity_game_developer with custom directives for their coding standards"
3. **Show Provider Routing** - "Backend uses Claude Sonnet, QA uses Gemini Flash, DevOps uses self-hosted Ollama"
4. **Show a PRD** - "Here's a feature request for their product"
5. **Show Planning Agent output** - "Decomposed into stories, assigned to the right personas"
6. **Show the coordination feed** - "Watch your custom team claim stories and coordinate"
7. **Highlight coordination** - "See? unity_game_developer asked qa_engineer about test patterns. Answer came back."
8. **Show Tech Lead review** - "Review happens before you see the PR"
9. **Show the PR** - "From your custom team, using your preferred models, with your coding standards"

**The reveals:**
- "This isn't 13 fixed agents - you DESIGN the team"
- "This isn't one model - each persona can use a different provider"
- "This isn't autocomplete - it's an AI engineering org you configure"

---

*Last updated: 2026-01-29*
