# WorkerMill Video & Streaming Plan

Comprehensive plan for live streaming and publishing WorkerMill Teamboard showcase demos.

---

## Phase 1: OBS Setup & Branding

### 1.1 OBS Scene Configuration

- **Main Scene — "Coding"**: Full-screen capture of VS Code / terminal with a small webcam overlay (bottom-right, ~15% screen size)
- **Dashboard Scene — "WorkerMill HUD"**: Browser capture of the WorkerMill dashboard (workermill.com or localhost:5173) showing real-time task monitoring, log streaming, and agent activity
- **Split Scene — "Side-by-Side"**: Code editor on the left (60%), WorkerMill dashboard on the right (40%) — this is the money shot that shows AI agents working in real-time
- **Intro/Outro Scene**: Static branded slide with WorkerMill logo, URL, and session title
- **BRB Scene**: "Back in a moment" card for breaks during live streams

### 1.2 Branded Overlay

Create a persistent overlay that appears on all scenes:

- **Top bar**: Session title (e.g., "Building Teamboard — WorkerMill Showcase")
- **Bottom bar**: `workermill.com` URL + GitHub repo link
- **Corner watermark**: WorkerMill logo (subtle, semi-transparent)
- **Status indicator**: "LIVE" badge for streams, or "RECORDED" for pre-recorded sessions

Design the overlay as a transparent PNG (1920x1080). Use Figma, Canva, or even a simple HTML page captured as a browser source in OBS.

### 1.3 Audio Setup

- Use a dedicated microphone (USB condenser or headset mic) — laptop mics sound amateur
- OBS Filters on mic input: Noise Suppression (RNNoise), Noise Gate, Compressor
- Test audio levels — voice should peak around -12dB to -6dB
- Disable system notification sounds during recording/streaming

### 1.4 Resolution & Encoding

- **Canvas Resolution**: 1920x1080 (1080p)
- **Output Resolution**: 1920x1080 (don't downscale — code readability matters)
- **FPS**: 30 (sufficient for screen recording, saves bandwidth)
- **Encoder**: NVENC (if NVIDIA GPU) or x264 on medium preset
- **Bitrate for streaming**: 4500-6000 kbps
- **Bitrate for local recording**: 20,000+ kbps (CRF 18-20 for quality)
- **Recording format**: MKV (crash-safe), remux to MP4 after recording via OBS File > Remux

---

## Phase 2: Platform Setup

### 2.1 YouTube Channel (Primary Platform)

**Why YouTube**: Best long-tail discovery, SEO for developer tools, streams auto-save as VODs, embeddable.

1. Create or configure a YouTube channel branded as "WorkerMill"
2. Channel art: Banner showing the WorkerMill dashboard with tagline ("Mission control for AI coding agents")
3. Channel description: What WorkerMill is, link to workermill.com, link to GitHub
4. Create playlists:
   - **"Teamboard Showcase"** — the main demo series
   - **"WorkerMill in Action"** — shorter demos of specific features
   - **"Behind the Build"** — raw development sessions
5. Enable live streaming: YouTube Studio > Go Live (may require 24hr activation on new channels)
6. Connect OBS: Settings > Stream > Service: YouTube - RTMP Server > paste stream key from YouTube Studio

### 2.2 Twitter/X (Clip Distribution)

1. Ensure the WorkerMill Twitter/X account is set up
2. Use Twitter/X for short clips (30s-90s) highlighting key moments
3. Native video uploads perform 5-10x better than YouTube links on Twitter
4. Post clips with context: what's happening, what WorkerMill is doing, link to full video

### 2.3 LinkedIn (B2B Reach)

1. Post from personal profile (LinkedIn algorithm favors personal posts over company pages)
2. Native video uploads (1-3 minutes) with a text post explaining the demo
3. Target: engineering managers, CTOs, DevOps leads — WorkerMill's buyer persona
4. Best posting times: Tuesday-Thursday, 8-10am local time

### 2.4 Reddit (Developer Community)

Target subreddits for organic reach:

| Subreddit | Content Type | Rules to Follow |
|-----------|-------------|-----------------|
| r/programming | Technical deep-dives | No self-promotion spam; valuable content first |
| r/webdev | Full-stack demos | Show the product, don't just pitch it |
| r/artificial | AI agent capabilities | Focus on the AI orchestration angle |
| r/devops | CI/CD and automation | Highlight the deployment automation |
| r/SideProject | Building in public | Great for "look what I built" posts |

---

## Phase 3: Content Strategy

### 3.1 Session Types

| Type | Length | Frequency | Platform | Description |
|------|--------|-----------|----------|-------------|
| **Live Build Session** | 60-120 min | 1-2x/week | YouTube Live | Real-time development of Teamboard with narration |
| **Feature Highlight** | 3-10 min | 2-3x/week | YouTube + LinkedIn | Focused demo of one WorkerMill feature |
| **Clip** | 30-90 sec | Daily | Twitter/X + LinkedIn | Best moments from live sessions |
| **Timelapse** | 2-5 min | Weekly | All platforms | Compressed build session showing hours of AI work in minutes |

### 3.2 Teamboard Showcase Series Structure

Plan the Teamboard build as an episodic series. Each episode has a clear goal:

1. **Episode 1 — "Kickoff"**: Create the Jira project, configure WorkerMill, show the dashboard empty, explain what Teamboard is
2. **Episode 2 — "First Task"**: Create first Jira ticket, add `workermill` label, watch the AI agent claim and execute it live
3. **Episode 3 — "Backend Foundation"**: API routes, database models, watch multiple AI agents work in parallel (Epic Mode)
4. **Episode 4 — "Frontend Build"**: React components, show AI agents creating UI from Jira descriptions
5. **Episode 5 — "Integration"**: Connect frontend to backend, show cross-repo coordination
6. **Episode 6 — "Polish & Deploy"**: Bug fixes, styling, deployment — show the full lifecycle
7. **Episode 7 — "Retrospective"**: Review what was built, metrics (tasks completed, time saved, cost), lessons learned

### 3.3 Narration Guidelines

- **Always narrate** — explain what you're doing and why, even if it feels obvious
- **Call out WorkerMill features** as they happen: "Notice the dashboard just picked up the task..."
- **Show failures too** — blockers, retries, and how WorkerMill handles them builds credibility
- **Pause on the dashboard** when agents are working — let viewers see the real-time log streaming
- **Summarize after each major step** — "So what just happened is..."

### 3.4 Thumbnail & Title Strategy

**Titles** (YouTube-optimized):
- "I Let AI Agents Build an Entire App — Here's What Happened"
- "Real-Time AI Coding: Watch 4 Agents Build a Dashboard Simultaneously"
- "From Jira Ticket to Deployed Feature in 10 Minutes (No Human Code)"
- "WorkerMill: htop for AI Workers — Live Teamboard Build [Episode N]"

**Thumbnails**:
- Show the WorkerMill dashboard with visible agent activity
- Large readable text (3-5 words max)
- Bright accent color (WorkerMill brand color) on dark background
- Face/reaction shot if using webcam (increases CTR 15-30%)

---

## Phase 4: Production Workflow

### 4.1 Pre-Session Checklist

- [ ] Pull latest code: `git pull` in workermill repo
- [ ] Start local environment or verify prod is healthy
- [ ] Open WorkerMill dashboard in browser (clean state, no clutter)
- [ ] Open VS Code with relevant files
- [ ] Prepare Jira tickets for the session (have 3-5 ready to trigger)
- [ ] Test OBS scenes — verify all captures are working
- [ ] Test microphone levels
- [ ] Close notifications (Slack, email, system notifications)
- [ ] Set stream title and description in YouTube Studio
- [ ] Have a bullet-point outline of what you want to cover

### 4.2 During Session

1. Start with the **Intro Scene** (10-15 seconds)
2. Switch to **Coding Scene** and greet viewers, explain today's goal
3. Alternate between **Coding**, **Dashboard**, and **Split** scenes as appropriate
4. When triggering a task: switch to **Dashboard Scene** and narrate the agent activity
5. Take natural breaks — switch to **BRB Scene** if needed
6. Wrap up: summarize what was accomplished, preview next session
7. End on **Outro Scene** with CTA (subscribe, visit workermill.com)

### 4.3 Post-Session Workflow

1. **Stop stream/recording** in OBS
2. **Remux** MKV to MP4: OBS > File > Remux Recordings
3. **Review the VOD** on YouTube — add timestamps to description:
   ```
   0:00 Intro
   2:15 Creating the Jira ticket
   5:30 AI agent picks up the task
   12:00 Watching parallel execution
   ...
   ```
4. **Extract clips**: Use a video editor (DaVinci Resolve is free) or YouTube's built-in clip tool
   - Identify 2-3 highlight moments (agent starting, parallel execution, PR creation)
   - Export as 30-90 second clips at 1080p
5. **Post clips** natively to Twitter/X and LinkedIn with context
6. **Write a Reddit post** if the session had particularly interesting results
7. **Update the playlist** on YouTube

### 4.4 Recommended Editing Tools (All Free)

| Tool | Purpose |
|------|---------|
| **DaVinci Resolve** | Full video editing, color grading, clip extraction |
| **FFmpeg** | Command-line clip extraction and format conversion |
| **Canva** | Thumbnails and social media graphics |
| **Handbrake** | Video compression for social media uploads |

Quick FFmpeg clip extraction:
```bash
# Extract clip from 5:30 to 7:00
ffmpeg -i full-session.mp4 -ss 00:05:30 -to 00:07:00 -c copy clip-parallel-execution.mp4

# Create a 4x timelapse
ffmpeg -i full-session.mp4 -filter:v "setpts=0.25*PTS" -an timelapse.mp4
```

---

## Phase 5: Growth & Distribution

### 5.1 Cross-Promotion

- Embed the latest video or live stream on `workermill.com/docs` or a dedicated `/showcase` page
- Add video links to the GitHub README
- Share in relevant Discord communities (AI, DevTools, indie hackers)
- Post in Hacker News "Show HN" when you have a compelling demo

### 5.2 SEO Optimization (YouTube)

- **Tags**: AI coding, autonomous agents, developer tools, Jira automation, AI workers, code generation
- **Description**: First 2 lines are most important (shown in search results). Include the key value prop and links
- **Chapters**: Always add timestamps — YouTube shows them in search results
- **Cards & End Screens**: Link to previous/next episodes and subscribe CTA

### 5.3 Engagement

- Respond to every comment in the first 48 hours (boosts algorithm)
- Pin a comment on each video with a link to workermill.com and a question to drive discussion
- Ask viewers questions: "What feature would you want to see the AI agents tackle next?"

### 5.4 Analytics to Track

| Metric | Target | Platform |
|--------|--------|----------|
| Views per video | 100+ in first week | YouTube |
| Average watch time | >40% of video length | YouTube |
| Clip impressions | 1000+ per clip | Twitter/X |
| LinkedIn engagement rate | >3% | LinkedIn |
| Website referral traffic from YouTube | Track in analytics | workermill.com |
| Subscriber growth | Steady week-over-week increase | YouTube |

---

## Phase 6: Advanced (Future)

### 6.1 Multi-Platform Simultaneous Streaming

Use **Restream.io** (free tier: 2 platforms) to stream to YouTube + Twitch simultaneously from a single OBS output. Add LinkedIn Live when approved.

### 6.2 Automated Clip Generation

Use AI-powered clipping tools to auto-detect highlights:
- **Opus Clip** — AI-powered short clip generation from long videos
- **Vidyo.ai** — Similar auto-clipping with social media formatting

### 6.3 Community Building

- Create a Discord server for WorkerMill users and viewers
- Post session schedules in advance
- Let community members suggest Jira tickets for live sessions
- Highlight community contributions or use cases

### 6.4 Guest Sessions

Invite developers to use WorkerMill on their own projects during a live stream. Real-world usage on unfamiliar codebases is the most compelling demo possible.

---

## Immediate Next Steps

1. **Today**: Configure OBS scenes (Main, Dashboard, Split, Intro/Outro)
2. **Today**: Create branded overlay PNG
3. **Today**: Set up YouTube channel and connect OBS
4. **This week**: Record first Teamboard episode (doesn't need to be live — record locally first)
5. **This week**: Extract 2-3 clips and post to Twitter/X
6. **Next week**: Go live for the first time on YouTube
