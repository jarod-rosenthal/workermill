# WorkerMill Marketing Agent: Autonomous Campaign System

> Implementation plan for an autonomous, AI-driven marketing operation that runs sustained campaigns
> across all major platforms without human oversight. The `marketing_agent` persona orchestrates
> a team of specialized sub-agents that create content, generate videos, engage communities,
> and grow WorkerMill's brand continuously.

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [The Marketing Agent Architecture](#the-marketing-agent-architecture)
- [Sub-Agent Roster](#sub-agent-roster)
- [Content Pipeline](#content-pipeline)
- [Platform Strategy](#platform-strategy)
- [Video Production Pipeline](#video-production-pipeline)
- [Campaign Playbooks](#campaign-playbooks)
- [Autonomous Operations](#autonomous-operations)
- [Technical Implementation](#technical-implementation)
- [Content Calendar & Cadence](#content-calendar--cadence)
- [Metrics & Feedback Loops](#metrics--feedback-loops)
- [Phase Rollout](#phase-rollout)
- [Risk Management](#risk-management)
- [Budget Estimates](#budget-estimates)

---

## Executive Summary

WorkerMill has a genuinely differentiated product — the only platform that decomposes a product description into stories, dispatches parallel expert agents with different personas, coordinates them via a real-time feed, validates quality, and delivers a production-ready consolidated PR. **Nobody else does this.**

The problem is visibility. The product's magic (orchestration, coordination, quality gates) is invisible to outsiders. This plan creates an autonomous marketing system that:

1. **Demonstrates capability continuously** — live public builds, comparison videos, speedrun clips
2. **Engages communities authentically** — developer forums, AI communities, indie hacker spaces
3. **Produces content at scale** — 50+ pieces/week across all platforms, video included
4. **Learns and adapts** — analytics feedback loops tune content strategy without human intervention
5. **Runs indefinitely** — once deployed, the system sustains itself with periodic human checkpoints

### Core Message

**"Ship production-grade software from a spec."**

Not "AI agent orchestrator." Not "htop for AI workers." The message is the outcome: describe what you want, get a production codebase with tests, CI/CD, security scanning, and documentation. Other tools generate code. WorkerMill ships products.

### The Claude Max Wedge

The zero-risk acquisition pitch for the millions of Claude Max subscribers: *"You're already paying $100/month for unlimited Claude. WorkerMill turns it into a parallel AI engineering team that builds production-grade software while you sleep. No extra cost."*

---

## The Marketing Agent Architecture

```
                    ┌─────────────────────────┐
                    │    marketing_agent       │
                    │    (Campaign Director)   │
                    │                          │
                    │  - Strategy & calendar   │
                    │  - Content approval      │
                    │  - Budget management     │
                    │  - Performance review    │
                    └────────┬────────────────┘
                             │
          ┌──────────────────┼──────────────────────┐
          │                  │                       │
    ┌─────▼──────┐    ┌─────▼──────┐    ┌──────────▼──────────┐
    │ content    │    │  video     │    │  community          │
    │ _writer    │    │ _producer  │    │  _manager           │
    │            │    │            │    │                     │
    │ Blog posts │    │ Demo clips │    │ Reddit, HN,         │
    │ Twitter    │    │ Tutorials  │    │ Discord, Slack      │
    │ LinkedIn   │    │ YouTube    │    │ Forum engagement    │
    │ Threads    │    │ TikTok     │    │ Comment replies     │
    └─────┬──────┘    └─────┬──────┘    └──────────┬──────────┘
          │                 │                       │
    ┌─────▼──────┐    ┌─────▼──────┐    ┌──────────▼──────────┐
    │ graphic    │    │  demo      │    │  analytics          │
    │ _designer  │    │ _builder   │    │  _tracker           │
    │            │    │            │    │                     │
    │ OG images  │    │ Live demos │    │ Engagement metrics  │
    │ Diagrams   │    │ Showcase   │    │ Funnel tracking     │
    │ Thumbnails │    │ projects   │    │ A/B test results    │
    │ Infographs │    │ /build pg  │    │ Content scoring     │
    └────────────┘    └────────────┘    └─────────────────────┘
```

### How It Maps to WorkerMill's Epic Mode

This marketing system **uses WorkerMill's own architecture** to run itself — the marketing_agent is a persona like `backend_developer` or `qa_engineer`, and its sub-agents are stories in an ongoing Epic. The coordination feed tracks content decisions, the blocker manager handles failed API calls or rejected posts, and the dashboard shows campaign progress.

**WorkerMill markets itself by demonstrating itself.** Every campaign execution is a live proof of the product's orchestration capabilities.

---

## Sub-Agent Roster

### 1. `content_writer` — Written Content Specialist

**Role:** Creates all text-based content across platforms. Adapts tone, length, and format per platform.

**Capabilities:**
- Blog posts (technical deep-dives, tutorials, comparisons, case studies)
- Twitter/X threads (hooks, engagement bait, technical insights)
- LinkedIn articles (professional tone, enterprise audience)
- Reddit posts (authentic, community-first, never salesy)
- Hacker News submissions (technical substance, no marketing speak)
- Newsletter editions (weekly digest of builds, features, metrics)
- Product Hunt launch copy
- Dev.to / Hashnode cross-posts

**Tone Guidelines:**
| Platform | Tone | Length | Format |
|----------|------|--------|--------|
| Twitter/X | Sharp, technical, visual | 280 chars / thread | Hook → proof → CTA |
| LinkedIn | Professional, outcome-focused | 500-1500 words | Story → insight → CTA |
| Reddit | Authentic, helpful, humble | Varies | Value-first, link-second |
| Hacker News | Technical depth, no hype | Varies | Show HN with substance |
| Blog | Comprehensive, authoritative | 1500-3000 words | Tutorial / deep-dive |
| Dev.to | Tutorial-focused, code-heavy | 1000-2000 words | Step-by-step guide |

**Content Pillars:**
1. **"Watch AI Build"** — narrated builds of real projects
2. **"The Orchestration Gap"** — why single-agent tools aren't enough
3. **"Claude Max Unlocked"** — getting 10x value from your subscription
4. **"Build Wars"** — head-to-head comparisons with other tools
5. **"Behind the Coordination Feed"** — technical deep-dives into WorkerMill's architecture
6. **"From Spec to Ship"** — end-to-end walkthroughs

### 2. `video_producer` — Video Content Specialist

**Role:** Produces all video content using AI video generation tools. Manages the full pipeline from script to published video.

**Tool Stack:**
| Tool | Purpose | Cost |
|------|---------|------|
| **Runway Gen-3/4** | B-roll, transitions, cinematic sequences | ~$96/mo (Unlimited) |
| **Sora 2** | Complex scene generation, product vision pieces | ~$200/mo (Pro) |
| **HeyGen** | AI avatar presenter for tutorials and explainers | ~$48/mo (Creator) |
| **Synthesia** | Professional talking-head videos, multilingual | ~$89/mo (Creator) |
| **ElevenLabs** | Voice cloning, narration, multilingual voiceover | ~$22/mo (Starter) |
| **Midjourney / DALL-E 3** | Thumbnails, cover images, social graphics | ~$30/mo |
| **ScreenStudio / Trupeer** | Screen recordings with auto-zoom and polish | ~$15/mo |
| **CapCut / Descript** | Editing, captions, format adaptation | ~$25/mo |

**Video Types:**
| Type | Length | Cadence | Platform |
|------|--------|---------|----------|
| Speedrun clips | 30-60s | 3x/week | Twitter, TikTok, Shorts, Reels |
| Build Wars comparisons | 5-10min | 1x/week | YouTube |
| Technical deep-dives | 10-20min | 2x/month | YouTube |
| Tutorial walkthroughs | 5-15min | 1x/week | YouTube, Dev.to |
| AI avatar explainers | 2-3min | 2x/week | LinkedIn, Twitter |
| Live build recordings | 30-60min | 1x/week | YouTube (streamed), clips extracted |

### 3. `community_manager` — Community Engagement Specialist

**Role:** Monitors and engages with developer communities. Builds relationships, answers questions, provides value before promotion.

**Communities:**
| Community | Handle/Presence | Strategy |
|-----------|----------------|----------|
| Twitter/X | @workermill | Daily engagement, quote-tweets of AI dev content, respond to mentions |
| Reddit | u/workermill | r/ClaudeAI, r/ChatGPT, r/LocalLLaMA, r/SideProject, r/indiehackers — value-first commenting, occasional Show posts |
| Hacker News | workermill | Show HN launches, thoughtful commenting on AI/dev threads |
| Discord | WorkerMill server | Community hub, support, showcase channel, build-along events |
| Dev.to | @workermill | Cross-post blog content, engage in discussions |
| Indie Hackers | workermill | Building-in-public updates, revenue milestones |
| Product Hunt | WorkerMill | Launch + follow-up engagement |
| LinkedIn | WorkerMill page | Professional content, enterprise-focused |
| YouTube | WorkerMill | Long-form content hub |
| TikTok | @workermill | Short-form clips, developer audience |

**Engagement Rules:**
- **Never spam.** Every interaction must provide genuine value.
- **80/20 rule:** 80% helpful content / engagement, 20% product mentions.
- **Answer questions first,** then mention WorkerMill only if genuinely relevant.
- **Be transparent** that this is the WorkerMill account — never astroturf.
- **Acknowledge competitors honestly.** "Devin is great for X, WorkerMill is better for Y."
- **Respond to every mention** within 2 hours.

### 4. `graphic_designer` — Visual Content Specialist

**Role:** Creates all static visual content. Maintains brand consistency across platforms.

**Outputs:**
- Twitter/X card images and thread graphics
- YouTube thumbnails (high-CTR style)
- Blog post hero images and diagrams
- Architecture diagrams for technical content
- Comparison infographics (WorkerMill vs competitors)
- OG images for link previews
- Presentation slides for conferences/webinars

**Brand Guidelines:**
| Element | Specification |
|---------|--------------|
| Primary color | Deep blue (#1a1a2e) |
| Accent color | Electric cyan (#00d4ff) |
| Secondary accent | Warm amber (#ffa726) |
| Typography | Inter (headings), JetBrains Mono (code) |
| Style | Dark mode default, clean, technical, premium |
| Icons | Lucide icon set, consistent stroke width |
| Screenshots | Always dark theme, highlighted key areas |

**Tool Stack:**
| Tool | Purpose |
|------|---------|
| Midjourney v7 / DALL-E 3 | Hero images, abstract visuals |
| Figma + AI plugins | Diagrams, infographics, social templates |
| Excalidraw | Technical architecture diagrams |
| Carbon.now.sh | Code snippet images |
| Claude (this tool) | SVG generation for diagrams |

### 5. `demo_builder` — Live Demo & Showcase Specialist

**Role:** Continuously builds showcase projects using WorkerMill to demonstrate capabilities. Each build becomes content for other agents.

**Showcase Project Pipeline:**
| Project | Description | Demonstrates |
|---------|-------------|-------------|
| SaaS Dashboard | Analytics dashboard with auth, charts, API | Full-stack orchestration |
| REST API + Docs | Express API with OpenAPI docs, tests, CI | Backend expert + QA + tech writer |
| E-commerce Store | Product catalog, cart, checkout, payments | Multi-persona coordination |
| CLI Tool | npm package with tests, README, CI/CD | Focused single-expert execution |
| Mobile App | React Native app with navigation, state | Mobile persona capability |
| DevOps Pipeline | Terraform + GitHub Actions + monitoring | DevOps persona showcase |
| AI Chat App | OpenAI/Claude integration, streaming, DB | Modern stack demonstration |
| Real-time App | WebSocket chat with rooms, auth, deploy | Complex coordination demo |

**Each showcase produces:**
1. Public build recording (coordination feed visible)
2. Time-lapse speedrun clip (30-60s)
3. Before/after comparison (description → deployed app)
4. Blog post walkthrough
5. The actual deployed app (proof it works)
6. GitHub repo (proof of quality — tests pass, CI green)

### 6. `analytics_tracker` — Performance & Optimization Specialist

**Role:** Tracks all campaign metrics, identifies what's working, and feeds insights back to other agents to optimize content strategy.

**Metrics Tracked:**
| Category | Metrics |
|----------|---------|
| Reach | Impressions, views, unique visitors |
| Engagement | Likes, comments, shares, saves, click-through rate |
| Conversion | Signups, `/build` page visits, CLI installs, first build completions |
| Retention | Return visits, second build, upgrade to paid |
| Content | Top-performing posts, best posting times, optimal content length |
| Platform | Per-platform performance comparison |
| Competitor | Share of voice, mention tracking |

**Feedback Loop:**
```
analytics_tracker observes → identifies top performers → extracts patterns →
feeds to content_writer/video_producer → they produce more of what works →
analytics_tracker measures → repeat
```

---

## Content Pipeline

### Automated Content Factory

```
┌────────────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  Trigger        │────▶│  Generate    │────▶│  Review &     │────▶│  Publish &   │
│                 │     │              │     │  Adapt        │     │  Distribute  │
│ - Schedule      │     │ - Draft post │     │ - Platform    │     │ - Post       │
│ - Trending topic│     │ - Generate   │     │   adaptation  │     │ - Schedule   │
│ - New feature   │     │   visuals    │     │ - Brand check │     │ - Cross-post │
│ - Showcase done │     │ - Script     │     │ - Fact check  │     │ - Engage     │
│ - Competitor    │     │   video      │     │ - Quality     │     │ - Monitor    │
│   news          │     │              │     │   score       │     │              │
└────────────────┘     └──────────────┘     └───────────────┘     └──────────────┘
        │                                                                  │
        └──────────────── analytics_tracker feedback ◀─────────────────────┘
```

### Content Generation Triggers

| Trigger | Action | Agents Involved |
|---------|--------|-----------------|
| **Scheduled** (calendar) | Produce planned content for the week | content_writer, graphic_designer |
| **New feature shipped** | Announcement post + demo video + blog | All agents |
| **Showcase project completed** | Extract clips, write walkthrough, post everywhere | demo_builder → video_producer → content_writer |
| **Trending AI topic** | Newsjack with WorkerMill angle | content_writer, community_manager |
| **Competitor announcement** | Comparison post or "how we're different" | content_writer, graphic_designer |
| **Community question** | Detailed answer + content piece if broadly useful | community_manager → content_writer |
| **Milestone hit** | Celebration post (users, builds, PRs merged) | content_writer, graphic_designer |
| **Performance insight** | Double down on what's working | analytics_tracker → all content agents |

---

## Platform Strategy

### Twitter/X — Primary Distribution Channel

**Why:** Developer audience, real-time engagement, viral potential, visual content performs well.

**Strategy:**
- **3-5 posts/day** — mix of original content, engagement, and reposts
- **Weekly thread** — deep-dive into a WorkerMill capability
- **Daily speedrun clip** — 30s compressed build
- **Quote-tweet strategy** — add WorkerMill perspective to trending AI dev discussions
- **Spaces participation** — join AI/dev Twitter Spaces, offer expertise

**Content Mix:**
| Type | Frequency | Example |
|------|-----------|---------|
| Speedrun clip | Daily | "Description → deployed app in 47 minutes" with video |
| Technical insight | 3x/week | "Here's how our coordination feed prevents merge conflicts between parallel AI agents" |
| Comparison | 1x/week | "Same spec, 4 tools. Here's what each produced:" |
| Behind-the-scenes | 2x/week | Screenshot of coordination feed, agent decision-making |
| Engagement/reply | Continuous | Respond to AI dev discussions |
| Milestone/metric | 1x/week | "WorkerMill built 47 production apps this week" |

**Thread Templates:**

```
Thread 1: "The Orchestration Problem"
- Hook: "Every AI coding tool gives you ONE agent. Here's what happens when you give them a team."
- 5-7 tweets showing single-agent vs multi-agent results
- CTA: Link to /build page

Thread 2: "Claude Max Unlock"
- Hook: "You're paying $100/mo for Claude Max and using 10% of its value. Here's why."
- Show how WorkerMill parallelizes Claude Max into a dev team
- CTA: Try it free with your existing subscription

Thread 3: "Build Wars"
- Hook: "I gave the same product spec to Devin, Bolt, Cursor, and WorkerMill."
- Side-by-side screenshots of outputs
- Honest comparison (praise competitors where they're better)
- CTA: "Try it yourself"
```

### YouTube — Long-Form Content Hub

**Why:** Search discoverability, tutorial content has long shelf life, builds authority.

**Channel Strategy:**
- **2-3 videos/week**
- **Playlists:** Build Wars, Tutorials, Architecture Deep-Dives, Showcase Gallery
- **Shorts:** Repurposed speedrun clips from Twitter (30-60s)
- **Community tab:** Polls, behind-the-scenes, feature previews

**Video Series:**

| Series | Format | Cadence |
|--------|--------|---------|
| **Build Wars** | Same spec → multiple tools → compare results | Weekly |
| **From Spec to Ship** | Full narrated build walkthrough | Weekly |
| **Architecture Explained** | How WorkerMill's internals work | Biweekly |
| **60-Second Builds** | Compressed speedruns | 3x/week (Shorts) |
| **Community Builds** | Featuring what users have built | Weekly |

### LinkedIn — Enterprise & Professional Audience

**Why:** Decision-makers, CTOs, engineering managers. Enterprise pipeline.

**Strategy:**
- **3-4 posts/week** — professional tone, outcome-focused
- **Articles** — monthly deep-dives on AI engineering team management
- **Carousels** — visual comparisons, workflow diagrams
- **Video** — 2-3 min AI avatar explainers

**Content Angles:**
- "How AI engineering teams reduce time-to-market by 80%"
- "The cost of context-switching: why parallel AI agents outperform sequential ones"
- "Why your code never leaves your machine with WorkerMill's local mode"
- "AI quality gates: how we ensure AI-generated code meets production standards"

### Reddit — Community & Authenticity

**Why:** High-intent developer audience, organic discovery, authentic engagement.

**Target Subreddits:**
| Subreddit | Subscribers | Strategy |
|-----------|------------|----------|
| r/ClaudeAI | 100K+ | Claude Max integration angle |
| r/ChatGPT | 5M+ | AI tool comparison content |
| r/LocalLLaMA | 500K+ | Multi-provider angle, Ollama support |
| r/SideProject | 200K+ | Showcase projects built with WorkerMill |
| r/webdev | 2M+ | Technical tutorials, production-quality output |
| r/indiehackers | 100K+ | Building-in-public, solo founder angle |
| r/ExperiencedDevs | 200K+ | Quality gates, enterprise controls angle |
| r/devops | 300K+ | CI/CD, deployment automation angle |

**Rules:**
- **No direct promotion in first 2 weeks** on any subreddit — establish presence first
- **Answer questions genuinely** — become known as helpful before mentioning product
- **Show HN-style posts** only after building karma and reputation
- **Always disclose** affiliation when mentioning WorkerMill

### Hacker News — Credibility & Technical Audience

**Why:** One front-page post = massive, high-quality traffic. But HN audience is ruthlessly anti-marketing.

**Strategy:**
- **Show HN post** — only when `/build` page enables instant try-it experience
- **Technical blog posts** — submit deep-dives on coordination architecture, multi-agent patterns
- **Engage in comments** on AI coding tool discussions with genuine technical insights
- **Never** post marketing content. Only technical substance.

**Show HN Requirements (must have before posting):**
- [ ] `/build` page works with zero signup friction
- [ ] Public showcase projects viewable without login
- [ ] Blog post explaining the technical architecture in depth
- [ ] Honest "What we don't do well" section in the post

### TikTok / Instagram Reels — Visual Viral Potential

**Why:** Short-form video has the highest viral coefficient. Developer content is underserved.

**Strategy:**
- **Daily 30-60s clips** — compressed builds, satisfying "code appearing" visuals
- **"Describe → Build → Ship" format** — always the same structure for brand recognition
- **Trending audio** — adapt popular sounds to dev content
- **Captions always on** — 90%+ of short-form is watched muted

### Dev.to / Hashnode / Medium — SEO & Tutorial Content

**Why:** Long-tail search traffic, developer-specific platforms, cross-posting amplifies reach.

**Strategy:**
- **Cross-post blog content** with platform-specific formatting
- **Tutorial series** — step-by-step guides using WorkerMill
- **"How I Built X" stories** — using showcase projects as source material

### Discord — Community Hub

**Why:** Direct relationship with users, real-time support, showcase sharing.

**Server Structure:**
| Channel | Purpose |
|---------|---------|
| #announcements | New features, updates |
| #showcase | Users share what they've built |
| #support | Technical help |
| #feature-requests | Community-driven roadmap |
| #build-along | Weekly guided builds |
| #general | Community discussion |
| #clips | Short video clips of builds |

---

## Video Production Pipeline

### Fully Autonomous Video Generation

The video_producer sub-agent manages an end-to-end pipeline that generates professional-quality video content without human intervention.

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Script   │───▶│ Assets   │───▶│ Assembly │───▶│ Polish   │───▶│ Publish  │
│          │    │          │    │          │    │          │    │          │
│ Claude   │    │ Screen   │    │ CapCut / │    │ Auto-    │    │ YouTube  │
│ writes   │    │ capture  │    │ Descript │    │ captions │    │ Twitter  │
│ script + │    │ (Trupeer)│    │ combine  │    │ Thumb-   │    │ TikTok   │
│ shot list│    │ AI video │    │ narrate  │    │ nail gen │    │ LinkedIn │
│          │    │ (Runway) │    │ (11Labs) │    │ Format   │    │ Shorts   │
│          │    │ Avatar   │    │          │    │ adapt    │    │ Reels    │
│          │    │ (HeyGen) │    │          │    │          │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

### Video Type Recipes

**1. Speedrun Clip (30-60s)**
```
Input:  Screen recording of WorkerMill building a project
Process:
  1. Record full build via ScreenStudio/Trupeer (auto-zoom on key actions)
  2. Compress to 30-60s with speed ramps (slow on impressive moments)
  3. Add captions (CapCut auto-captions)
  4. Add timer overlay (elapsed time counter)
  5. Generate thumbnail (Midjourney: "speedrun timer, code, deploy")
  6. Add trending audio track
Output: Posted to Twitter, TikTok, YouTube Shorts, Instagram Reels
```

**2. Build Wars Comparison (5-10min)**
```
Input:  Same product spec, results from 3-4 tools
Process:
  1. Claude writes script with fair comparison narrative
  2. Screen recordings from each tool (or simulated if no access)
  3. Split-screen assembly showing parallel execution
  4. AI narrator (ElevenLabs) reads comparison points
  5. Side-by-side output quality comparison
  6. Honest "where they win" for each competitor
  7. Generate comparison infographic thumbnail
Output: YouTube, with clips extracted for Twitter/LinkedIn
```

**3. AI Avatar Explainer (2-3min)**
```
Input:  Feature or concept to explain
Process:
  1. Claude writes 2-minute script
  2. HeyGen generates AI avatar presenter
  3. Screen recordings of feature demo overlay
  4. Diagrams generated by graphic_designer inserted as b-roll
  5. Auto-captions added
Output: LinkedIn, Twitter, YouTube
```

**4. Architecture Deep-Dive (10-20min)**
```
Input:  Technical concept (e.g., "How the coordination feed works")
Process:
  1. Claude writes detailed technical script
  2. Excalidraw diagrams animated step-by-step
  3. Code walkthrough with highlighted sections
  4. AI narrator explains while diagrams build on screen
  5. Real build demo showing the concept in action
Output: YouTube (primary), blog post companion piece
```

### LLM Outsourcing for Video

The video_producer routes specific tasks to the best available LLM for each job:

| Task | Best LLM | Why |
|------|----------|-----|
| Script writing | Claude Opus 4 | Best at long-form, nuanced technical writing |
| Video prompts | GPT-4o | Strong at visual description for Sora/Runway |
| Thumbnail concepts | Midjourney v7 | Best image generation quality |
| Code explanations | Claude Sonnet 4.5 | Fast, accurate code understanding |
| SEO optimization | GPT-4o | Strong at keyword optimization |
| Social copy adaptation | Claude Haiku 4.5 | Fast, cheap, good at tone adaptation |
| Trend analysis | Perplexity | Real-time web knowledge |

---

## Campaign Playbooks

### Playbook 1: "The Launch" (Week 0)

**Prerequisite:** `/build` page live, 3+ showcase projects deployed.

**Day 1: Hacker News Show HN**
- Title: "Show HN: WorkerMill — Ship production-grade software from a description"
- Body: Technical architecture overview, honest limitations, live demo link
- Timing: Tuesday 9-10am EST (peak HN traffic)
- Support: Team ready to answer every comment thoughtfully

**Day 1-2: Twitter Storm**
- Main announcement tweet with 30s speedrun video
- Thread: "How we built this" technical deep-dive
- Quote-tweet strategy: engage every reply
- Pin: Best-performing tweet

**Day 2: Product Hunt**
- Launch with video demo, 5 screenshots, clear value prop
- "Maker" comments explaining technical decisions
- Respond to every review and question

**Day 3-5: Community Seeding**
- Reddit posts in 3-4 relevant subreddits (authentic, not copy-pasted)
- Dev.to launch article: "How I Built a SaaS in 47 Minutes with AI"
- LinkedIn article for professional audience
- Discord server goes live with launch-day event

**Day 5-7: Follow-Up Content**
- "What we learned from launch day" blog post
- Metrics shared publicly (builds completed, PRs created)
- First "Build Wars" comparison video

### Playbook 2: "Build Wars" (Ongoing Weekly)

Every week, the demo_builder creates the same project with WorkerMill and 1-2 competitors.

**Process:**
1. demo_builder selects a project type (rotates through showcase list)
2. Runs the build on WorkerMill with public coordination feed
3. Attempts same spec on Devin / Bolt / Cursor / Codex (or simulates based on published capabilities)
4. video_producer creates comparison video
5. content_writer creates thread and blog post
6. community_manager distributes across platforms

**Comparison Criteria (always fair):**
- Time to complete
- Code quality (tests, types, lint)
- Files generated
- Production readiness (CI/CD, documentation, security)
- Cost
- Where the competitor was better (always include this)

### Playbook 3: "Claude Max Campaign" (Targeted)

Focused campaign targeting Claude Max subscribers specifically.

**Channels:** r/ClaudeAI, Claude-related Twitter discussions, AI community Discords

**Content:**
- "5 things you didn't know your Claude Max subscription could do"
- "I turned my $100/mo Claude subscription into a dev team"
- "Claude Max + WorkerMill = parallel AI engineers for $0 extra"
- Tutorial: "Set up WorkerMill with Claude Max in 5 minutes"

**Timing:** Amplify whenever Anthropic announces Claude Max features or price changes.

### Playbook 4: "Ship in Public" (Ongoing Daily)

Continuous transparency about what WorkerMill is building, using WorkerMill itself.

**Format:**
- Daily tweet: "Today WorkerMill built: [showcase project]. Here's the coordination feed."
- Weekly blog: "This week's builds: X projects, Y stories, Z quality score average"
- Monthly metrics: "WorkerMill by the numbers: builds, PRs, code quality trends"

### Playbook 5: "Conference Season" (Quarterly)

AI and developer conferences as content amplification events.

**Pre-conference:** Preview content related to conference themes
**During:** Live-tweet sessions with WorkerMill perspective, run live demos
**Post:** Summary blog posts, video recaps, new content inspired by talks

### Playbook 6: "Influencer Seeding" (Ongoing)

Identify and engage developer influencers who would genuinely benefit from WorkerMill.

**Criteria for outreach:**
- Active in AI/dev tools space
- Audience of 10K+ developers
- History of honest reviews (not just paid promotions)
- Would genuinely use the product

**Approach:**
- Offer free access (no strings attached)
- Ask for honest review (including criticism)
- Amplify their content regardless of whether it's positive
- Never ask them to say specific things

---

## Autonomous Operations

### The Autonomous Loop

```
┌──────────────────────────────────────────────────────────────┐
│                    WEEKLY CYCLE                               │
│                                                               │
│  Monday:    analytics_tracker reviews last week's data        │
│             marketing_agent adjusts strategy                  │
│             content_writer drafts week's content calendar     │
│                                                               │
│  Tue-Thu:   content_writer produces daily content             │
│             video_producer creates 2-3 videos                 │
│             community_manager engages across all platforms    │
│             demo_builder runs 1-2 showcase builds             │
│                                                               │
│  Friday:    video_producer publishes weekly Build Wars        │
│             content_writer publishes weekly newsletter        │
│             analytics_tracker compiles weekly report           │
│                                                               │
│  Ongoing:   community_manager monitors & responds 24/7       │
│             analytics_tracker feeds insights continuously     │
│             graphic_designer supports all content with visuals│
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Automation Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Scheduling** | n8n workflow automation | Content calendar execution, cross-platform posting |
| **Social posting** | Buffer / Typefully API | Scheduled multi-platform distribution |
| **Video pipeline** | n8n + Runway/HeyGen APIs | Automated video generation and publishing |
| **Analytics** | PostHog + platform APIs | Unified metrics dashboard |
| **Monitoring** | Mention.com / Brand24 | Track mentions, sentiment, competitor activity |
| **Content DB** | PostgreSQL (WorkerMill API) | Store content calendar, performance data, asset library |
| **Image generation** | Midjourney / DALL-E 3 API | On-demand visual creation |
| **Voice generation** | ElevenLabs API | Narration for all video content |
| **Trend detection** | Perplexity API + Google Trends | Identify content opportunities in real-time |

### n8n Workflow Architecture

**Workflow 1: Daily Content Generation**
```
Trigger (cron: 6am EST) →
  Fetch content calendar for today →
  For each scheduled item:
    Route to appropriate sub-agent (Claude API call) →
    Generate visuals (Midjourney/DALL-E API) →
    Adapt for each platform (Claude Haiku) →
    Queue for posting at optimal times (Buffer API) →
  Log to analytics DB
```

**Workflow 2: Trend Newsjacking**
```
Trigger (every 2 hours) →
  Check Google Trends + Twitter trending for AI/dev keywords →
  Filter for relevance to WorkerMill →
  If relevant trend found:
    Generate content angle (Claude) →
    Create post + visual →
    Post within 30 minutes of trend detection →
  Log response metrics
```

**Workflow 3: Community Monitoring & Response**
```
Trigger (every 15 minutes) →
  Check Reddit mentions, Twitter mentions, Discord messages →
  Classify: question / praise / criticism / spam →
  For questions: Generate helpful response (Claude) →
  For praise: Like + repost + thank →
  For criticism: Flag for human review if sensitive, otherwise respond thoughtfully →
  Log all interactions
```

**Workflow 4: Weekly Video Production**
```
Trigger (Monday 8am) →
  demo_builder selects this week's showcase project →
  Run build on WorkerMill (triggers actual task execution) →
  Capture screen recording + coordination feed →
  video_producer generates script (Claude) →
  Generate narration (ElevenLabs) →
  Generate B-roll (Runway) →
  Assemble video (CapCut API) →
  Generate thumbnail (Midjourney) →
  Publish to YouTube →
  Extract clips for Shorts/Twitter/TikTok →
  Distribute clips to all platforms
```

### Human Checkpoints (Minimal but Critical)

While the system runs autonomously, certain decisions require human review:

| Checkpoint | Frequency | Why |
|------------|-----------|-----|
| **Weekly strategy review** | Weekly (15 min) | Approve next week's content themes, review analytics summary |
| **Controversial content flag** | As needed | Any content about competitors, pricing, or sensitive topics |
| **Budget approval** | Monthly | Review tool spending, approve/adjust |
| **Brand consistency audit** | Monthly | Spot-check 20 random pieces for tone/quality |
| **Crisis response** | As needed | Negative viral content, security issues, outages |

---

## Technical Implementation

### Phase 1: Content Pipeline (Weeks 1-2)

**New files to create:**
```
worker/directives/marketing_agent/README.md     # Persona directive
worker/epic/marketing/                            # Marketing orchestration
  campaign-scheduler.ts                           # Content calendar & scheduling
  content-generator.ts                            # Text content generation
  platform-adapter.ts                             # Adapt content per platform
  analytics-collector.ts                          # Metrics aggregation
api/src/routes/marketing.ts                       # Marketing API endpoints
api/src/services/marketing-scheduler.ts           # Cron-based content scheduling
api/src/models/MarketingContent.ts                # Content storage model
api/src/models/MarketingCampaign.ts               # Campaign tracking model
```

**Database schema (new tables):**
```sql
-- Content items produced by the marketing system
CREATE TABLE marketing_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  campaign_id UUID REFERENCES marketing_campaigns(id),
  content_type VARCHAR(50) NOT NULL,        -- 'tweet', 'thread', 'blog', 'video', 'image'
  platform VARCHAR(50) NOT NULL,            -- 'twitter', 'youtube', 'linkedin', etc.
  status VARCHAR(20) DEFAULT 'draft',       -- 'draft', 'scheduled', 'published', 'archived'
  title TEXT,
  body TEXT NOT NULL,
  media_urls JSONB DEFAULT '[]',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  external_id VARCHAR(255),                 -- Platform post ID after publishing
  external_url TEXT,                         -- URL to published content
  performance JSONB DEFAULT '{}',           -- Engagement metrics
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign tracking
CREATE TABLE marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  playbook VARCHAR(100) NOT NULL,           -- 'launch', 'build_wars', 'claude_max', etc.
  status VARCHAR(20) DEFAULT 'active',
  config JSONB DEFAULT '{}',
  metrics JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics snapshots
CREATE TABLE marketing_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES marketing_content(id),
  platform VARCHAR(50) NOT NULL,
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),
  impressions INTEGER DEFAULT 0,
  engagements INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  raw_data JSONB DEFAULT '{}'
);
```

**API endpoints:**
```
POST   /api/marketing/campaigns          # Create campaign
GET    /api/marketing/campaigns          # List campaigns
GET    /api/marketing/campaigns/:id      # Campaign details + metrics
POST   /api/marketing/content            # Create content item
GET    /api/marketing/content            # List content (filterable)
PATCH  /api/marketing/content/:id        # Update content (schedule, publish)
POST   /api/marketing/content/:id/publish # Publish to platform
GET    /api/marketing/analytics          # Aggregated analytics
GET    /api/marketing/analytics/content/:id  # Per-content analytics
POST   /api/marketing/generate           # Trigger content generation
```

### Phase 2: Video Pipeline (Weeks 3-4)

**Integrations to build:**
```
worker/epic/marketing/video/
  script-generator.ts          # Claude API for script generation
  screen-capture.ts            # Automated screen recording via Puppeteer/Playwright
  video-assembler.ts           # Combine screen captures + narration + b-roll
  thumbnail-generator.ts       # Midjourney/DALL-E API for thumbnails
  platform-uploader.ts         # YouTube Data API, Twitter Media API, etc.

worker/epic/marketing/integrations/
  runway-client.ts             # Runway Gen-4 API for B-roll generation
  heygen-client.ts             # HeyGen API for avatar videos
  elevenlabs-client.ts         # ElevenLabs API for narration
  buffer-client.ts             # Buffer API for cross-platform scheduling
  youtube-client.ts            # YouTube Data API for uploads + analytics
```

### Phase 3: Community & Analytics (Weeks 5-6)

**Integrations to build:**
```
worker/epic/marketing/community/
  reddit-monitor.ts            # Reddit API for mention tracking + posting
  twitter-monitor.ts           # Twitter API for mention tracking + engagement
  discord-bot.ts               # Discord bot for community management
  hn-monitor.ts                # HN algolia API for mention tracking

worker/epic/marketing/analytics/
  platform-collectors.ts       # Collect metrics from all platform APIs
  performance-scorer.ts        # Score content performance
  trend-detector.ts            # Identify trending topics
  strategy-optimizer.ts        # Feed insights back to content generation
```

### Phase 4: Autonomous Orchestration (Weeks 7-8)

**n8n workflow deployment:**
- Deploy n8n instance (self-hosted or cloud)
- Configure all workflows (daily content, trend newsjacking, community monitoring, weekly video)
- Connect to WorkerMill API for content storage and scheduling
- Set up monitoring alerts for workflow failures
- Configure human checkpoint notifications (Slack/email)

---

## Content Calendar & Cadence

### Weekly Content Volume

| Platform | Content/Week | Type |
|----------|-------------|------|
| Twitter/X | 21-35 posts | Mix of original, engagement, clips |
| YouTube | 2-3 videos + 5-7 Shorts | Tutorials, comparisons, deep-dives |
| LinkedIn | 3-4 posts | Professional articles, carousels |
| Reddit | 5-10 comments + 1-2 posts | Engagement + occasional content |
| Dev.to | 1-2 articles | Tutorials, cross-posts |
| TikTok | 5-7 clips | Speedruns, compressed builds |
| Discord | Continuous | Community management |
| Newsletter | 1 edition | Weekly digest |
| Blog | 1-2 posts | Deep-dives, tutorials |
| **Total** | **~50-70 pieces/week** | |

### Monthly Themes

| Month | Theme | Key Content |
|-------|-------|-------------|
| 1 | "Launch & Prove" | Show HN, Product Hunt, first Build Wars |
| 2 | "Claude Max Unlock" | Target Claude subscribers, tutorial series |
| 3 | "Quality Matters" | Quality gates showcase, "other tools generate code, we ship products" |
| 4 | "Enterprise Ready" | Security, local mode, data sovereignty angles |
| 5 | "Community" | User showcase features, build-along events |
| 6 | "Scale" | Multi-provider, team features, enterprise case studies |

---

## Metrics & Feedback Loops

### North Star Metrics

| Metric | Target (Month 1) | Target (Month 3) | Target (Month 6) |
|--------|-----------------|-----------------|-----------------|
| `/build` page visits | 1,000 | 10,000 | 50,000 |
| Signups | 100 | 1,000 | 5,000 |
| First build completions | 50 | 500 | 2,500 |
| Twitter followers | 1,000 | 5,000 | 20,000 |
| YouTube subscribers | 200 | 2,000 | 10,000 |
| Discord members | 100 | 500 | 2,000 |
| GitHub stars | 100 | 1,000 | 5,000 |

### Content Performance Scoring

Each content piece gets a performance score (0-100) based on:

```
Score = (
  0.3 * engagement_rate +    # Likes, comments, shares relative to impressions
  0.3 * conversion_rate +    # Click-throughs to /build page
  0.2 * amplification +      # Shares, retweets, cross-posts
  0.2 * longevity            # Performance after 7 days (evergreen value)
)
```

The analytics_tracker feeds these scores back to content_writer and video_producer, which adjust their content strategy to produce more of what scores well.

### A/B Testing Framework

The system continuously tests:
- **Headlines/hooks:** 2 variations per content piece, measure click-through
- **Posting times:** Rotate times for 4 weeks, then settle on best performers
- **Content formats:** Thread vs single tweet, video vs image, long vs short
- **CTAs:** "Try it free" vs "See it in action" vs "Build something now"
- **Platforms:** Which platform drives the most conversions per content type

---

## Phase Rollout

### Phase 0: Foundation (Week 1)

- [ ] Create `marketing_agent` persona directive
- [ ] Set up social media accounts (Twitter, YouTube, LinkedIn, TikTok, Discord)
- [ ] Design brand assets (logo variants, color palette, social templates)
- [ ] Write first 10 blog posts (backlog for launch week)
- [ ] Record first 5 speedrun clips
- [ ] Set up Buffer for scheduling
- [ ] Set up PostHog for analytics

### Phase 1: Soft Launch (Weeks 2-3)

- [ ] Start posting daily on Twitter (build audience before official launch)
- [ ] Publish first YouTube video (tutorial format)
- [ ] Begin engaging in Reddit communities (no promotion yet)
- [ ] Launch Discord server (invite-only beta)
- [ ] Publish 3 blog posts on Dev.to
- [ ] Start "Ship in Public" daily tweets

### Phase 2: Official Launch (Week 4)

- [ ] Hacker News Show HN (requires `/build` page to be live)
- [ ] Product Hunt launch
- [ ] Twitter launch thread + paid boost ($500)
- [ ] Reddit posts in 4 subreddits
- [ ] First Build Wars video
- [ ] Newsletter #1 to collected emails
- [ ] Open Discord to public

### Phase 3: Sustained Campaign (Weeks 5-8)

- [ ] Deploy n8n automation workflows
- [ ] Begin autonomous content generation loop
- [ ] Weekly Build Wars series
- [ ] Influencer seeding (5 developers)
- [ ] Conference content tie-ins
- [ ] Claude Max targeted campaign

### Phase 4: Scale & Optimize (Weeks 9+)

- [ ] Full autonomous operation (human checkpoints only)
- [ ] Expand video production to daily
- [ ] Multilingual content (HeyGen dubbing)
- [ ] Paid amplification of top-performing organic content
- [ ] Community ambassador program
- [ ] Partnership content with complementary tools

---

## Risk Management

### Content Risks

| Risk | Mitigation |
|------|-----------|
| AI-generated content sounds generic/robotic | Strong persona directives, brand voice training, quality scoring threshold |
| Competitor comparison perceived as unfair | Always include "where they win," use factual claims only |
| Community backlash against automated posting | Transparent about using AI, always provide genuine value |
| Content quality drops without oversight | Weekly human audit of 20 random pieces, minimum quality score threshold |
| Platform algorithm changes reduce reach | Diversify across 8+ platforms, never depend on one channel |
| Account bans for automated posting | Use official APIs, respect rate limits, follow TOS |

### Brand Risks

| Risk | Mitigation |
|------|-----------|
| Over-promising on capabilities | Always demo real builds, never fabricate results |
| Negative comparison with well-funded competitors | Frame as "different approach" not "better" — acknowledge their strengths |
| User-generated negative content goes viral | Respond within 1 hour, acknowledge issues, fix publicly |
| Pricing/feature misrepresentation | All marketing content auto-checked against current feature set |

### Technical Risks

| Risk | Mitigation |
|------|-----------|
| n8n workflow failures | Monitoring + alerting, fallback to manual posting |
| API rate limiting on platforms | Queue management, respect limits, spread posts across day |
| Video generation quality inconsistent | Quality threshold: only publish videos scoring > 7/10 on internal rubric |
| Cost overrun on AI tools | Monthly budget cap with alerts at 80% threshold |

---

## Budget Estimates

### Monthly Tool Costs

| Tool | Monthly Cost | Purpose |
|------|-------------|---------|
| Runway Gen-4 | $96 | Video B-roll generation |
| Sora 2 (OpenAI) | $200 | Complex video scenes |
| HeyGen | $48 | AI avatar videos |
| ElevenLabs | $22 | Voice narration |
| Midjourney | $30 | Thumbnails, graphics |
| Buffer Pro | $36 | Social scheduling |
| n8n Cloud | $50 | Workflow automation |
| ScreenStudio | $15 | Screen recording |
| PostHog | $0 (free tier) | Analytics |
| Brand24/Mention | $79 | Social monitoring |
| Claude API (content) | ~$100 | Content generation calls |
| GPT-4o API (video) | ~$50 | Video prompt generation |
| **Total** | **~$726/month** | |

### Optional Paid Amplification

| Channel | Monthly Budget | Purpose |
|---------|---------------|---------|
| Twitter Ads | $500 | Boost top-performing organic content |
| YouTube Ads | $300 | Pre-roll on AI/dev content |
| Reddit Ads | $200 | Targeted subreddit promotion |
| **Total Paid** | **$1,000/month** | |

### Total Monthly Budget

| Category | Cost |
|----------|------|
| Tools & APIs | ~$726 |
| Paid amplification (optional) | ~$1,000 |
| **Total (with paid)** | **~$1,726/month** |
| **Total (organic only)** | **~$726/month** |

---

## Summary

This marketing system is designed to be a self-sustaining content machine that:

1. **Uses WorkerMill to market WorkerMill** — every campaign execution demonstrates the product
2. **Produces 50-70 pieces of content per week** across all major platforms
3. **Runs autonomously** with minimal human oversight (weekly 15-min checkpoints)
4. **Learns and improves** through analytics feedback loops
5. **Costs under $750/month** for organic operations
6. **Scales without adding headcount** — more content doesn't require more people

The key insight: WorkerMill's marketing should be indistinguishable from its product demonstration. Every showcase build is content. Every coordination feed is proof. Every quality gate pass is a selling point. The marketing_agent doesn't just talk about WorkerMill — it runs on WorkerMill, proving the product works by using it.

---

*Document created: February 2026*
*Next update: After Phase 0 completion*
