# WorkerMill Video Production Guide

This guide produces four video assets from a single recording session. Record all raw clips first, then assemble each video from the shared footage.

---

## Pre-Recording Setup

### OBS Settings (already configured)
- 1920x1080, 30fps, NVENC HQ, hybrid MP4
- Source: **Window Capture** (VS Code only) for coding shots, **Display Capture** for dashboard shots
- Create two OBS Scenes: "VS Code" (window capture) and "Browser" (display capture or window capture of Chrome)

### VS Code Preparation
- **Zoom level:** Ctrl+= until editor font is ~18px (readable at 1080p even on a phone)
- **Terminal font:** Bump to 16px in settings (`terminal.integrated.fontSize`)
- **Theme:** Dark (default is fine)
- **Sidebar:** WorkerMill panel visible, everything else collapsed
- **Clean state:** Close all open tabs and terminals before recording
- **No other extensions** with noisy UI (disable GitLens inline blame, etc.)

### Browser Preparation
- Open workermill.com dashboard in Chrome
- Zoom to 110-125% so text fills the frame
- Close all other tabs (or use a clean Chrome profile)
- Disable all browser notifications
- Bookmark the boards page for quick navigation

### Desktop Preparation
- **Windows Focus Assist:** ON (blocks all notifications)
- **Close** Slack, Discord, Teams, email — anything that can pop a toast
- **Wallpaper:** Solid dark color (in case any desktop is visible)
- **Taskbar:** Auto-hide or ensure nothing distracting is pinned

### WorkerMill State
- Have a FlagDeck (or similar) spec ready as a `.md` file in VS Code
- Confirm the remote agent is connected (green status in VS Code sidebar)
- Confirm the dashboard loads and shows your org
- Have at least one completed task visible in history (proves the product works)
- Settings page should have integrations configured (GitHub connected, AI provider set)

---

## Recording Strategy

**Record everything as separate clips.** Start OBS, do one thing, stop. Label each clip immediately by renaming the file in `C:\Users\jarod\Videos\`. Don't try to record a continuous 20-minute session.

**Mouse movement:** Slow and deliberate. Hover on things you want the viewer to notice. Pause 2 seconds after each click before the next action.

**Do NOT narrate while recording.** All voiceover is added in post. This lets you re-record clips freely and keeps audio clean.

---

## Clip List — Record These

Record each clip separately. Some will be used across multiple videos.

### Clip 1: VS Code Extension Install (45 seconds)
1. Open VS Code with NO WorkerMill extension
2. Go to Extensions marketplace (Ctrl+Shift+X)
3. Search "WorkerMill"
4. Click Install
5. Show the WorkerMill icon appear in the activity bar
6. Click it — show the welcome/onboarding view

### Clip 2: Sign In & Connect (60 seconds)
1. From the welcome view, click "Get Started with GitHub"
2. Complete the OAuth flow (browser opens, authorize, redirect back)
3. Show the "Connected" state in the sidebar
4. Show the agent starting up (status bar: "WorkerMill: Starting...")
5. Show the agent connected (status bar: "WorkerMill [OrgName]: Idle")

### Clip 3: Settings Flythrough (90 seconds)
1. Open WorkerMill settings (gear icon in sidebar)
2. Slowly scroll through:
   - **Integrations tab:** Show GitHub connected, Jira connected
   - **AI Workers tab:** Show model selection (Claude Opus, Sonnet, Haiku), personas enabled, concurrent expert slider
   - **Quality Gates tab:** Show the gates configured
3. Don't explain anything — just let the camera see the UI. Narration covers it later.

### Clip 4: The Spec (30 seconds)
1. Show the FlagDeck spec file open in VS Code editor
2. Slowly scroll through it — let the viewer see the requirements
3. This establishes "here's what we're asking the AI to build"

### Clip 5: Triggering the Build — VS Code (30 seconds)
1. Right-click the `.md` spec file in the explorer
2. Click "WorkerMill: Product Build"
3. Show the progress notification appear
4. Show the sidebar update with the new task entering "Planning" state

### Clip 6: Planning Phase — VS Code (2-3 minutes)
1. After triggering the build, the sidebar shows "Planning"
2. Show the log terminal auto-opening with planning output
3. Let it run — capture the planner decomposing the spec into stories
4. Capture the critic scoring the plan (you'll see scores in the logs)
5. Show the plan being approved (status changes from Planning to Executing)

### Clip 7: The Dashboard — Board Created (60 seconds)
1. Switch to browser, open the boards page
2. Show the new board that was auto-created from the spec
3. Click into it — show the Kanban columns with cards
4. Click a card — show the description, persona assignment, dependencies
5. Show the dependency chain (cards depend on earlier cards)

### Clip 8: Experts Working — Dashboard Live View (5-10 minutes, unattended)
**This is the hero footage. Start recording and walk away.**
1. On the dashboard, open the active task
2. Position the screen to show:
   - Left: Terminal logs streaming
   - Right: Live Code Viewer with file diffs appearing
   - Bottom or overlay: Coordination feed showing expert messages
3. **Let it record for 5-10 minutes unattended**
4. The AI experts will autonomously:
   - Claim stories
   - Write code (visible in Live Code View)
   - Post decisions to the coordination feed
   - Ask questions to sibling experts
   - Run tests and fix failures
   - Commit and push
5. This footage gets time-lapsed in post (10 min → 30 seconds)

### Clip 9: Experts Working — VS Code Live View (3-5 minutes)
1. Back in VS Code, show the sidebar with active task(s)
2. Click the eye icon to open Live Diff
3. Show code appearing in the diff editor in real-time
4. Show the terminal with streaming logs
5. Show the coordination feed in the activity panel
6. **Let it run — capture the rhythm of autonomous coding**

### Clip 10: Expert Coordination Close-Up (2 minutes)
1. On the dashboard, focus on the Embedded Communications Feed
2. Capture moments where:
   - An expert posts a decision (e.g., "Using PostgreSQL for primary DB")
   - An expert asks a question to another expert
   - An expert answers a sibling's question
   - A blocker is detected and auto-resolved
3. These are powerful moments — they show the AI "team" collaborating

### Clip 11: Quality Gates Passing (60 seconds)
1. In the logs, capture a moment where quality gates run
2. Show: lint passing, typecheck passing, tests passing, build passing
3. This proves the code isn't just generated — it's validated

### Clip 12: PR Created (60 seconds)
1. Show the task transitioning to "PR Created" status
2. Click the PR link — show the GitHub PR
3. Show the diff (real code, real commits, real PR description)
4. Show the Tech Lead review comment (if review is enabled)

### Clip 13: Task Completion (30 seconds)
1. Show the task status change to "Completed" or "Deployed"
2. Show the cost summary (how much the entire build cost)
3. Show the Kanban board with cards moved to "Deployed" column

### Clip 14: The Result — Running App (60 seconds)
1. Show the built application actually running
2. Navigate through it — click buttons, show features
3. This is the payoff: "the AI built this, and it works"

### Clip 15: Cost Intelligence (30 seconds)
1. Open the Cost Intelligence page on dashboard
2. Show the cost breakdown, ROI metrics
3. Show per-task cost vs estimated developer hours saved

### Clip 16: Blocker Handling (if it happens naturally)
1. If a blocker occurs during recording, capture it
2. Show the red blocker banner on dashboard
3. Show the response options (Retry / Skip / Abort)
4. Show yourself clicking Retry and the expert resuming
5. If no natural blocker occurs, skip this — don't fake it

---

## Video 1: Hero Reel (60-90 seconds)

**Purpose:** Landing page embed, Twitter/LinkedIn shares, paid ads. This is the "holy shit" video that makes people stop scrolling.

**Tone:** Fast-paced, cinematic, no wasted frames. Every second earns the next second of attention.

### Assembly

| Time | Footage | What Viewer Sees |
|------|---------|------------------|
| 0:00-0:03 | Text card (black bg, white text) | "What if your backlog shipped overnight?" |
| 0:03-0:08 | Clip 4 (spec file) | A requirements doc in VS Code |
| 0:08-0:12 | Clip 5 (right-click → Product Build) | One click to start |
| 0:12-0:18 | Clip 6 (planning logs, fast-forward 4x) | AI decomposing the spec into stories |
| 0:18-0:25 | Clip 7 (board with cards) | Kanban board auto-created with dependency-ordered cards |
| 0:25-0:50 | Clip 8 (dashboard live view, time-lapse 10x-20x) | Logs streaming, code appearing, experts collaborating — the "wow" sequence |
| 0:50-0:55 | Clip 11 (quality gates green) | Tests passing, types checking, build succeeding |
| 0:55-1:00 | Clip 12 (GitHub PR) | Real PR with real code |
| 1:00-1:10 | Clip 14 (running app) | The finished product, actually working |
| 1:10-1:15 | Clip 13 (cost summary) | "$X.XX total cost" |
| 1:15-1:20 | Text card | "WorkerMill — Your backlog, shipped overnight." |
| 1:20-1:25 | Text card | "workermill.com" |

### Editing Notes
- **Cuts:** Hard cuts, no transitions. Every cut should feel intentional.
- **Speed:** Normal speed for the setup (0:00-0:25), then time-lapse the autonomous work (0:25-0:50), back to normal for the payoff (0:50+).
- **Music:** Upbeat electronic/ambient with a build. Start quiet, crescendo during the time-lapse, resolve on the running app. No lyrics. Try Epidemic Sound or Artlist — search "tech product launch" or "innovation." Budget $15/mo for a license.
- **Text overlays:** Minimal. A small "Planning..." → "Executing..." → "Reviewing..." label in the corner during the time-lapse is enough. Don't explain — let the visuals sell.
- **No voiceover.** Music only. The speed and visual density carry the message.

---

## Video 2: Product Walkthrough (3-5 minutes)

**Purpose:** YouTube, product page, "How it works" section. For people who saw the hero reel and want to understand the product.

**Tone:** Confident, clear, unhurried. Show each feature with enough time to register.

### Assembly

| Time | Footage | Voiceover (record separately) |
|------|---------|-------------------------------|
| 0:00-0:15 | Text card + Clip 14 (running app) | "This application was built entirely by AI workers. No human wrote a single line of code. Here's how." |
| 0:15-0:45 | Clip 4 (spec) + Clip 5 (trigger build) | "You start with a spec — a markdown file describing what you want built. Right-click, Product Build, and WorkerMill takes over." |
| 0:45-1:15 | Clip 6 (planning phase) | "First, the AI planner decomposes your spec into executable stories — each assigned to a specialized expert. A critic validates the plan before any code is written." |
| 1:15-1:45 | Clip 7 (board + cards) | "Stories land on a Kanban board with dependencies mapped automatically. Card one is always CI/CD — every subsequent card runs against a real pipeline." |
| 1:45-2:45 | Clip 8 or 9 (experts working, 4x speed) | "Then the experts go to work. Backend developers, frontend developers, DevOps engineers — each running in parallel, coordinating through a shared context API." |
| 2:45-3:15 | Clip 10 (coordination feed) | "Experts communicate decisions, ask questions, and resolve blockers autonomously. You're watching a team collaborate — except the team is AI." |
| 3:15-3:35 | Clip 11 (quality gates) | "Every story passes through quality gates. Lint, typecheck, tests, build — all green before code moves forward." |
| 3:35-3:55 | Clip 12 (PR) | "The result is a real pull request with real commits, reviewed by a built-in Tech Lead persona." |
| 3:55-4:15 | Clip 13 (completion + cost) | "Total cost for this build: [amount]. Total time: [duration]. Compare that to a team of engineers over weeks." |
| 4:15-4:30 | Clip 15 (cost intelligence) | "Track every dollar. See ROI metrics, efficiency scores, and cost breakdowns in real time." |
| 4:30-4:50 | Text card | "WorkerMill. From spec to production code. workermill.com" |

### Voiceover Recording
- Record in a quiet room. Even a closet with clothes (natural sound dampening) works.
- Use your best microphone. If you only have a laptop mic, get close (6 inches) and speak at normal volume.
- Record each section separately. Don't try to read the whole script in one take.
- Pace: ~130 words per minute. Slightly slower than conversational. Confident, not salesy.
- Edit pauses and mistakes in post (Audacity is free).

### Editing Notes
- **Cuts:** Smooth, with occasional brief crossfades (0.2s) between sections.
- **Music:** Same track as hero reel but quieter (ducked under voice, -15dB). Music is ambiance, not the star.
- **Text overlays:** Section labels as the topic changes ("Planning", "Execution", "Quality Gates", "Result"). Small, bottom-left corner, fade in/out.
- **Zoom:** In post, use a slight zoom (105-110%) on important moments — the critic score, the quality gates output, the cost summary. This directs attention.
- **Lower third:** Add "workermill.com" as a persistent subtle watermark, bottom-right.

---

## Video 3: Getting Started Tutorial (8-12 minutes)

**Purpose:** Documentation, YouTube SEO ("how to use WorkerMill"), onboarding new users.

**Tone:** Friendly, instructional. This is a teacher, not a salesperson.

### Assembly

| Time | Section | Footage | Voiceover |
|------|---------|---------|-----------|
| 0:00-0:30 | Intro | Text card + dashboard | "In this tutorial, I'll walk you through setting up WorkerMill and running your first AI-powered build from start to finish." |
| 0:30-2:00 | Install | Clip 1 (install extension) | Step-by-step: install extension, what you see, what each panel is for. |
| 2:00-3:30 | Auth & Connect | Clip 2 (sign in + agent) | GitHub sign-in flow, agent auto-install, waiting for connection. |
| 3:30-5:00 | Settings | Clip 3 (settings flythrough) | Walk through each settings tab. Explain what matters: AI provider key, model selection, integrations. |
| 5:00-5:30 | The Spec | Clip 4 (spec file) | "Create a markdown file with your requirements. Here's an example." |
| 5:30-6:00 | Trigger | Clip 5 (right-click → build) | "Right-click your spec file and select Product Build." |
| 6:00-7:00 | Planning | Clip 6 (planning logs) | Explain the planning phase, critic validation, what the scores mean. |
| 7:00-8:00 | Board | Clip 7 (board created) | Show the board, explain columns, dependencies, card structure. |
| 8:00-9:30 | Execution | Clip 8 + 9 (2x speed) | Show both dashboard and VS Code views. Explain logs, live code, coordination. |
| 9:30-10:00 | Quality | Clip 11 (gates passing) | "Every story runs through your quality gates before moving forward." |
| 10:00-10:30 | Result | Clip 12 + 14 (PR + running app) | Show the PR, show the running app. |
| 10:30-11:00 | Wrap-up | Dashboard overview | "That's it. From a spec file to a deployed application. Your backlog, shipped overnight." |

### Editing Notes
- **Pace:** Slower than the walkthrough. Pause between sections. Let viewers absorb.
- **Callouts:** Use arrows, circles, or highlight boxes to point at specific UI elements when explaining them. Most video editors (DaVinci Resolve, CapCut) have these built in.
- **Chapters:** Add YouTube chapters in the description for each section.
- **Thumbnail:** Screenshot of VS Code with logs streaming + "Getting Started with WorkerMill" text overlay.

---

## Video 4: Social Clips (15-30 seconds each)

**Purpose:** Twitter/X, LinkedIn, TikTok, Instagram Reels. Attention-grabbers that link to the full videos.

### Clip A: "The Time-Lapse" (15 seconds)
- Footage: Clip 8 at 20x speed (the full autonomous build compressed to 15 seconds)
- Text overlay: "AI experts building a full-stack app in [X] minutes"
- End card: "workermill.com"
- No voice, music only

### Clip B: "One Click" (20 seconds)
- Footage: Clip 5 (right-click → Product Build) → Clip 7 (board appears) → Clip 8 (5 seconds of execution)
- Text overlay: "Right-click a spec file. Get a production app."
- End card: "workermill.com"

### Clip C: "The Team" (20 seconds)
- Footage: Clip 10 (coordination feed close-up) — experts posting decisions, asking questions, answering each other
- Text overlay: "An AI engineering team that actually coordinates"
- End card: "workermill.com"

### Clip D: "The Cost" (15 seconds)
- Footage: Clip 13 (cost summary) → Clip 14 (running app)
- Text overlay: "$[X] and [Y] minutes. This is what AI-built software looks like."
- End card: "workermill.com"

### Clip E: "Before/After" (20 seconds)
- Split screen or quick cut:
  - Left/Before: The spec file (just text, requirements)
  - Right/After: The running application (fully functional)
- Text overlay: "Spec → Production. Zero human code."

### Social Clip Notes
- **Aspect ratio:** Record in 16:9 (OBS default), crop to 9:16 in post for TikTok/Reels, keep 16:9 for Twitter/LinkedIn.
- **Captions:** Add burned-in captions for any text overlays (most social video is watched on mute).
- **First frame matters:** The first frame must be visually interesting. Start mid-action, not with a blank screen.
- **Hook in 2 seconds:** The viewer decides to keep watching or scroll in 2 seconds. Lead with the most dramatic visual.

---

## Post-Production Tools

| Tool | Cost | Use For |
|------|------|---------|
| **DaVinci Resolve** (free) | $0 | Primary editor. Handles cuts, speed changes, text overlays, color, audio mixing. Professional-grade, free tier is more than enough. |
| **Audacity** (free) | $0 | Voiceover recording and cleanup. Noise reduction, normalization, trimming. |
| **Epidemic Sound** or **Artlist** | $13-17/mo | Royalty-free music. One track for all videos. Search: "tech", "innovation", "minimal electronic." |
| **Canva** (free tier) | $0 | Text cards, thumbnails, social media sizing. |

### DaVinci Resolve Quick Setup
1. Download from blackmagicdesign.com (free version)
2. New Project → set timeline to 1920x1080, 30fps
3. Import all clips to Media Pool
4. Edit tab: drag clips to timeline, cut with blade tool (B), trim by dragging edges
5. Speed changes: right-click clip → "Change Clip Speed" → enter percentage
6. Text: Effects Library → Titles → drag "Text" to timeline above video track
7. Export: Deliver tab → YouTube preset → render

---

## Recording Checklist

Run through this before every recording session:

- [ ] OBS open, correct scene selected (VS Code or Browser)
- [ ] Windows Focus Assist ON
- [ ] All chat apps closed
- [ ] VS Code zoomed to readable font size
- [ ] VS Code: only WorkerMill sidebar visible, no other panels
- [ ] Browser: dashboard loaded, zoomed 110-125%
- [ ] Remote agent connected (check VS Code status bar)
- [ ] Spec file ready in VS Code
- [ ] At least 20 GB free disk space
- [ ] Mouse movements practiced (slow, deliberate)
- [ ] OBS recording indicator visible (so you know it's actually recording)

---

## Editing Priorities

If you only have time to produce one video, make it **Video 1 (Hero Reel)**. A 60-second video that makes jaws drop is worth more than a 12-minute tutorial nobody finishes.

If you have time for two, add **Video 4 Clip A (The Time-Lapse)**. A 15-second time-lapse of AI experts building an app is the single most shareable piece of content you can produce.

The tutorial and walkthrough are important but serve existing interest. The hero reel and social clips create interest.

**Priority order:**
1. Hero Reel (60-90s) — landing page + ads
2. Social Clip A: Time-Lapse (15s) — viral potential
3. Social Clip E: Before/After (20s) — the simplest story to tell
4. Product Walkthrough (3-5min) — YouTube + product page
5. Remaining social clips
6. Tutorial (8-12min) — onboarding + YouTube SEO
