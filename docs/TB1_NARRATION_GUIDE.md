# TB-1 Narration Guide — "Kickoff"

> Episode 1 of the Teamboard Showcase series.
> **Goal**: Show WorkerMill taking a project from zero to scaffolded, deployed, and passing CI — with no human code written.

---

## Pre-Recording Setup

### What to have ready before you hit record

- [ ] WorkerMill dashboard open (workermill.com or localhost:5173) — clean state, no active tasks
- [ ] Linear/GitHub Issues board open with TB-1 ticket ready (label NOT added yet — you'll add it live)
- [ ] Terminal open with `workermill-agent start` running (or cloud orchestrator active)
- [ ] Browser tab ready for `teamboard.workermill.com` (will 404 initially — that's the point)
- [ ] Browser tab for GitHub repo `workermill-examples/teamboard` (empty or non-existent — also the point)
- [ ] OBS scenes configured: Intro, Coding/Terminal, Dashboard, Split, Outro
- [ ] Notecard or second monitor with this narration guide

### Key URLs to have bookmarked

| What | URL |
|------|-----|
| WorkerMill Dashboard | `https://workermill.com` or `localhost:5173` |
| TB-1 Ticket | Linear/GitHub issue link |
| Target Repo | `https://github.com/workermill-examples/teamboard` |
| Live App (will exist after) | `https://teamboard.workermill.com` |
| Vercel Dashboard | `https://vercel.com/workermill-examples/teamboard` |

---

## Episode Structure

**Total target length:** 20-40 minutes (depends on agent execution time)
**Tone:** Conversational, like a friend showing you something cool they built. Not a corporate demo.

---

## ACT 1 — The Setup (3-5 minutes)

### Scene: Intro Card (15 seconds)

> *[Intro scene with WorkerMill branding]*

**Say:**
> "Welcome to the Teamboard Showcase — a series where we build a full production SaaS app entirely with AI workers. No human writes a single line of application code. I'm going to use WorkerMill to orchestrate everything — from repo scaffolding to a live deployment."

### Scene: Split (browser + terminal)

**Show:** The empty GitHub repo page (404 or empty repo) and the target URL returning nothing.

**Say:**
> "Right now there's nothing. No repo, no code, no deployment. By the end of this episode, we'll have a fully scaffolded Next.js 15 app with a Prisma schema, CI/CD pipelines, and a live health check endpoint at teamboard.workermill.com. All from a single ticket."

### Scene: Browser — show the TB-1 ticket

**Show:** The TB-1 ticket content. Scroll through it slowly.

**Say:**
> "Here's the ticket — TB-1: Set up project repository and local dev environment. This is a devops engineer persona task. It covers repo scaffolding, database setup with Neon PostgreSQL, Prisma schema with all our data models, GitHub Actions CI/CD, and a Vercel deployment.
>
> I've written a detailed PRD — this is the spec that the AI agents will work from. It includes the exact file structure, the Prisma schema, the CI/CD workflow YAML, pinned dependency versions — everything a human engineer would need to execute this, except the AI is going to do it."

**Key beats to hit:**
- Mention this is a Next.js 15 app (not 14 — call out the CVE reason if you want)
- Mention the tech stack briefly: Next.js, Prisma, Neon, Vercel, shadcn/ui
- Explain that the PRD is detailed on purpose — "garbage in, garbage out applies to AI too"

---

## ACT 2 — Triggering the Task (2-3 minutes)

### Scene: Browser — Linear/GitHub Issues

**Action:** Add the `workermill` label to TB-1 while narrating.

**Say:**
> "Now I'm going to trigger WorkerMill. All I do is add the 'workermill' label to this ticket. That fires a webhook to the WorkerMill API, which creates a task and starts the planning pipeline."

### Scene: Dashboard — WorkerMill

**Switch to the WorkerMill dashboard immediately after adding the label.**

**Say:**
> "And here's the dashboard — watch the top. In a few seconds you should see the task appear..."

**Wait for the task to appear. Fill dead air:**
> "WorkerMill is receiving the webhook, creating the task record, and now the planning agent is going to analyze the ticket. It reads the PRD, looks at the target repo, and decomposes the work into stories — think of them as atomic units of work that individual expert agents will execute."

**When the task appears:**
> "There it is — [read the task title]. Status is 'planning'. The planning agent is figuring out how to break this down."

---

## ACT 3 — Planning Phase (5-8 minutes)

### Scene: Dashboard — Task Detail View

**Click into the task to see the log stream.**

**Say:**
> "Let me click into the task so we can see what's happening in real-time. This is the log stream — everything the agent writes to stdout shows up here via Server-Sent Events. Same pattern as watching a CI job, except it's an AI agent."

**Narrate what you see in the logs. Key things to call out:**

#### If team planning is active (3 parallel analysts):

> "You can see three analysts spinning up in parallel — a Codebase analyst, a Requirements analyst, and a Risk analyst. They're all reading the same ticket but from different angles.
>
> The Codebase analyst is looking at the target repo structure — in this case it's empty, so it'll note that.
> The Requirements analyst is parsing the acceptance criteria from the PRD.
> The Risk analyst is looking for potential issues — dependency conflicts, security concerns, CI gotchas.
>
> These three reports get fed into the final planner, which synthesizes them into a concrete execution plan."

#### When the plan appears:

> "Here's the plan. You can see it's been broken into [N] stories. Let me walk through them quickly..."

**Read through the story titles.** For each one, give a one-sentence explanation:
- "Story 1 is the repo scaffold — creating the file structure, package.json, tsconfig..."
- "Story 2 is the Prisma schema — all our data models, the database connection..."
- "Story 3 is the CI pipeline — GitHub Actions for lint, typecheck, and tests..."
- etc.

**Say:**
> "Each story lists the specific files it's going to create or modify. The plan validator caps this at 5 files per story to prevent scope explosion — that's a lesson we learned the hard way in earlier versions."

#### When the critic runs:

> "Now the critic agent reviews the plan. It scores it on completeness, risk, and adherence to the PRD. We need a score of 80 or higher to proceed. If it scores below that, the planner iterates — up to 3 times."

**When the score comes back:**
> "Score: [X] out of 100. [If passing:] That clears our threshold, so we're moving to execution."

---

## ACT 4 — Execution Phase (8-15 minutes)

### Scene: Dashboard — Log Stream

**This is where you spend the most time. The agent is actually building.**

**Say:**
> "Now the expert agents are executing. In Epic Mode — which is what we're running because we're using Anthropic as the provider — the agents can work in parallel. Each story gets assigned to an expert based on the persona. For TB-1, everything is going to a devops_engineer expert."

**Narrate the execution as it happens. Key moments to highlight:**

#### Repository creation

> "The agent is creating the repository structure now. You can see it scaffolding out the directories — src/app for the Next.js routes, prisma/ for the schema, .github/workflows for CI..."

#### Package.json and dependencies

> "It's writing the package.json now. Notice the pinned versions — Next.js 15.1, React 19, Prisma. These are specified in the PRD because we've had issues with AI agents picking outdated versions. Being explicit about dependencies is key."

#### Prisma schema

> "Here's the Prisma schema being created. This is the full data model for TeamBoard — Users, Workspaces, Boards, Columns, Cards, Labels, Activities. It's designed for multi-tenancy with workspace-scoped RBAC. The AI agent is writing this from the PRD spec, not inventing it."

**Pause here and switch to Split view (dashboard + code):**
> "Let me show you the schema side by side. [Read through key models] You've got User with password hash for auth, Workspace with slug for URLs, Board and Column for the Kanban structure, Card with priority and due dates, and Activity for the audit trail. This is a real production schema."

#### CI/CD workflows

> "Now it's creating the GitHub Actions workflows. The CI pipeline runs on every push and PR — lint, typecheck, tests, npm audit. The E2E job runs after the quality gate passes. The deploy workflow handles post-deploy tasks — database migrations, seeding demo data, and a smoke test."

#### Health check endpoint

> "There's the health check endpoint — GET /api/health. Simple JSON response with status and timestamp. This is what we'll use to verify the deployment is live."

#### Git operations

> "The agent is committing and pushing now. Every push triggers the CI pipeline on GitHub Actions, and the Vercel GitHub integration picks up the push for auto-deployment."

**If any errors occur during execution, narrate them honestly:**
> "Looks like we hit an issue — [describe the error]. Watch how the agent handles this. It's reading the error output, diagnosing the problem, and pushing a fix. This iteration loop is one of the most important parts of WorkerMill — agents don't just generate code and hope for the best. They iterate until CI passes."

---

## ACT 5 — Verification (3-5 minutes)

### Scene: Split — Dashboard + Browser

**Once execution completes, verify the deliverables.**

#### GitHub repo

**Open the GitHub repo in browser:**
> "Let's check the repo. Here it is — workermill-examples/teamboard. You can see the full file structure the agent created. Let me click into a few files..."

**Click through:**
- `package.json` — show the scripts and dependencies
- `prisma/schema.prisma` — show the data model
- `.github/workflows/ci.yml` — show the CI pipeline
- `src/app/api/health/route.ts` — show the health endpoint

#### CI pipeline

**Open the GitHub Actions tab:**
> "Let's check CI. Here's the first workflow run — triggered by the agent's push. [If passing:] All green. Lint, typecheck, tests, npm audit — everything passes. [If still running:] It's still running, but we can check back."

#### Live deployment

**Open teamboard.workermill.com:**
> "And the moment of truth — let's check the live URL."

**Navigate to `teamboard.workermill.com/api/health`:**
> "Health check endpoint — status: ok. The app is live on Vercel, connected to Neon PostgreSQL, and passing all checks. We went from an empty repo to a deployed application without writing a single line of code."

**Navigate to `teamboard.workermill.com`:**
> "The landing page is a placeholder right now — that's expected. The actual UI comes in TB-3. But the foundation is here: routing, auth configuration, database models, CI/CD pipeline, and a live deployment."

---

## ACT 6 — Wrap-Up & Recap (2-3 minutes)

### Scene: Split — Dashboard showing completed task

**Say:**
> "Let me recap what just happened. We started with a ticket description and a detailed PRD. WorkerMill's planning pipeline broke the work into [N] stories. Expert agents executed each story, creating files, configuring infrastructure, and iterating until CI passed.
>
> What got built:
> - A Next.js 15 project with TypeScript, TailwindCSS, and shadcn/ui configured
> - A full Prisma schema with [N] models — Users, Workspaces, Boards, Cards, Activities
> - Neon PostgreSQL connected with pooled and direct connections
> - GitHub Actions CI with lint, typecheck, unit tests, and E2E support
> - Vercel auto-deployment with post-deploy migrations and smoke tests
> - A live health check endpoint at teamboard.workermill.com
>
> This is just the foundation. In Episode 2, we'll tackle TB-2 — the entire backend API. Authentication, workspace CRUD with RBAC, board and card management, the card move operation for drag-and-drop, activity tracking, dashboard stats, and SSE real-time streaming. That's 28 API endpoints built by AI workers."

### Scene: Outro Card

> "If you want to try WorkerMill yourself, head to workermill.com. The repo for this build is public at github.com/workermill-examples/teamboard — you can see every commit, every CI run, everything the agents did.
>
> See you in Episode 2."

---

## Narration Tips Specific to TB-1

### What makes TB-1 visually interesting

TB-1 is infrastructure setup — not the most visually exciting phase. To keep viewers engaged:

1. **Emphasize the "zero to deployed" arc** — The before/after is compelling. Empty repo to live URL.
2. **Show the planning phase in detail** — This is unique to WorkerMill. Most AI demos skip planning.
3. **Read through the generated code** — Don't just say "it created the files." Open them, scroll through, call out specific patterns.
4. **Show CI running** — Real CI pipelines running on real infrastructure is more credible than "it works on my machine."
5. **If anything fails, show the recovery** — Agent error correction is MORE interesting than a perfect run. Don't edit out failures.

### Common questions viewers will have (address proactively)

| Question | Where to address it |
|----------|-------------------|
| "How does the AI know what to build?" | Act 1 — when showing the PRD |
| "What if the code doesn't work?" | Act 4 — when showing iteration on CI failures |
| "Is this just ChatGPT copy-paste?" | Act 3 — when showing team planning and critic review |
| "How much did this cost?" | Act 6 — mention the task cost from the dashboard if visible |
| "Can I use this for my projects?" | Act 6 — CTA to workermill.com |

### Pacing guide

| Act | Pace | Energy |
|-----|------|--------|
| Act 1 (Setup) | Medium — set the stage clearly | Calm, confident |
| Act 2 (Trigger) | Quick — this is the "button press" moment | Building excitement |
| Act 3 (Planning) | Slow — explain what's happening | Informative, patient |
| Act 4 (Execution) | Variable — narrate active moments, let quiet moments breathe | Engaged, observational |
| Act 5 (Verification) | Quick — show the results | Satisfied, proud |
| Act 6 (Wrap-up) | Medium — summarize and tease next episode | Warm, inviting |

### Things to NOT say

- "This is just a simple scaffold" — Underselling makes viewers wonder why they should care
- "The AI sometimes makes mistakes" — Sounds defensive. If it makes a mistake, show the recovery instead
- "I could have done this faster manually" — Maybe, but you couldn't do 6 projects simultaneously. Focus on scale and consistency
- "Let me skip ahead" — If something is slow, narrate over it. Don't cut the live experience

### Things to definitely say

- "No human code was written" — Repeat this. It's the thesis of the entire showcase
- "This is a production stack — same tools and patterns a human team would use"
- "The AI agents don't just generate code. They iterate until CI passes"
- "Everything is public — you can see every commit, every CI run"
- "This is episode 1 of 6. By the end, this will be a fully functional Kanban board with drag-and-drop, real-time updates, and multi-tenant RBAC"

---

## Post-Recording Checklist

- [ ] Clip: The moment the task appears on the dashboard (10-15 seconds)
- [ ] Clip: Planning phase with analyst reports (30-60 seconds)
- [ ] Clip: Agent creating the Prisma schema (30 seconds)
- [ ] Clip: CI passing for the first time (15 seconds)
- [ ] Clip: Health check endpoint returning 200 at the live URL (15 seconds)
- [ ] Clip: Before/after — empty repo vs deployed app (30 seconds)
- [ ] Add YouTube timestamps for each Act
- [ ] Write tweet thread: "Just built a full Next.js project — scaffolding, Prisma schema, CI/CD, Vercel deployment — without writing any code. Here's the 60-second version:" + clip
- [ ] LinkedIn post: Focus on the infrastructure angle — "AI agents that don't just write code, they set up real CI/CD pipelines and deploy to real infrastructure"
