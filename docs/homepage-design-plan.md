# WorkerMill Homepage Design Plan

## Strategic Positioning

**Target Audience**: Engineering leaders, CTOs, VPs of Engineering, and tech-forward founders who:
- Have growing backlogs of routine development tasks
- Want to accelerate delivery without expanding headcount
- Are curious about AI-assisted development but skeptical of hype

**Core Message**: "Your AI engineering team that actually ships code."

**Tone**: Professional, confident, understated. No hyperbole. Let the product speak.

---

## Page Structure

### Navigation Bar (Sticky)
```
[WorkerMill Logo]                    [How It Works] [Features] [Docs] [Pricing]  [Login →]
```

- Clean, minimal header
- Logo on left (gradient text like dashboard)
- Nav links center-right
- Login button as primary CTA (top right, solid button)
- Transparent on hero, solid on scroll

---

## Section 1: Hero

**Layout**: Full viewport height, dark gradient background

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                                                                             │
│                    Your AI engineering team                                 │
│                    that actually ships code.                                │
│                                                                             │
│         Autonomous AI workers that turn Jira tickets into                   │
│         reviewed, tested, and merged pull requests.                         │
│                                                                             │
│              [Request Early Access]   [Watch Demo →]                        │
│                                                                             │
│         ┌─────────────────────────────────────────────────────┐            │
│         │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │            │
│         │       [Dashboard Screenshot / Animation]            │            │
│         │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │            │
│         └─────────────────────────────────────────────────────┘            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Elements**:
- Headline: Large, bold, gradient text
- Subheadline: Clear value prop in one sentence
- Primary CTA: "Request Early Access" (collects email for waitlist)
- Secondary CTA: "Watch Demo" (link or modal with video/gif)
- Hero visual: Animated dashboard mockup or real screenshot

**Why this works**: Immediately answers "what is this" and "why should I care"

---

## Section 2: Proof Bar (Social Validation)

**Layout**: Horizontal strip, subtle background

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   "Saved our team 20+ hours/week"     ⚡ 500+ PRs shipped    94% approval   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Elements**:
- 3-4 key metrics or short testimonial snippets
- Optional: "Trusted by engineers at [logo] [logo] [logo]" if we have them
- If no external validation yet: Use product stats ("500+ tasks completed", "~15 min avg resolution")

---

## Section 3: How It Works

**Layout**: 3-step horizontal flow with icons/illustrations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                         How It Works                                        │
│                                                                             │
│    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐           │
│    │     📋       │  →   │     🤖       │  →   │     ✅       │           │
│    │   Connect    │      │    Execute   │      │    Ship      │           │
│    │              │      │              │      │              │           │
│    │ Link Jira &  │      │ AI workers   │      │ Review PRs   │           │
│    │ GitHub in    │      │ analyze,     │      │ and merge.   │           │
│    │ 5 minutes    │      │ code, test   │      │ Done.        │           │
│    └──────────────┘      └──────────────┘      └──────────────┘           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Elements**:
- Clean 3-step visual progression
- Icons or mini-illustrations for each step
- Brief, scannable copy
- Emphasis on simplicity and speed

---

## Section 4: The Workers (Feature Highlight)

**Layout**: Grid of worker persona cards

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                    Meet Your AI Engineering Team                            │
│                                                                             │
│     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│     │     ⚙️      │  │     🎨      │  │     🔧      │  │     🔒      │    │
│     │   Backend   │  │  Frontend   │  │   DevOps    │  │  Security   │    │
│     │  Developer  │  │  Developer  │  │  Engineer   │  │  Engineer   │    │
│     │             │  │             │  │             │  │             │    │
│     │ APIs, DBs,  │  │ React, CSS, │  │ CI/CD,      │  │ Audits,     │    │
│     │ server code │  │ components  │  │ Terraform   │  │ compliance  │    │
│     └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                                             │
│     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                     │
│     │     🧪      │  │     📝      │  │     👔      │                     │
│     │     QA      │  │   Tech      │  │   Virtual   │                     │
│     │  Engineer   │  │   Writer    │  │   Manager   │                     │
│     │             │  │             │  │             │    ← Unique!        │
│     │ Tests,      │  │ Docs,       │  │ Reviews all │                     │
│     │ validation  │  │ guides      │  │ worker PRs  │                     │
│     └─────────────┘  └─────────────┘  └─────────────┘                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Elements**:
- Visual persona cards (like the dashboard)
- Highlight the Virtual Manager as differentiator
- Subtle hover effects to show interactivity
- Links to detailed persona docs

---

## Section 5: Key Differentiators

**Layout**: Alternating feature blocks with visuals

### Block 1: Quality Control
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌──────────────────────┐    Built-in Quality Control                      │
│  │                      │                                                   │
│  │  [Visual: Manager    │    Every PR goes through our Virtual Manager     │
│  │   reviewing code]    │    before completion. No sloppy code ships.      │
│  │                      │                                                   │
│  └──────────────────────┘    ✓ Automated code review                       │
│                              ✓ Standards enforcement                        │
│                              ✓ Revision requests when needed                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Block 2: Transparency
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│    Full Visibility                   ┌──────────────────────┐              │
│                                      │                      │              │
│    Watch workers in real-time.       │  [Visual: Dashboard  │              │
│    See logs, progress, costs.        │   with live task]    │              │
│    No black boxes.                   │                      │              │
│                                      └──────────────────────┘              │
│    ✓ Live task progress                                                    │
│    ✓ Detailed execution logs                                               │
│    ✓ Cost tracking per task                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Block 3: Control
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌──────────────────────┐    You're Always in Control                      │
│  │                      │                                                   │
│  │  [Visual: System     │    Start, stop, cancel anytime. Choose which     │
│  │   controls]          │    personas run. Select AI models.               │
│  │                      │                                                   │
│  └──────────────────────┘    ✓ One-click system enable/disable             │
│                              ✓ Per-task cancellation                        │
│                              ✓ Model selection (Opus, Sonnet, Haiku)        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Section 6: Use Cases

**Layout**: Tab or accordion interface

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                         What Can Workers Do?                                │
│                                                                             │
│  [Bug Fixes]  [New Features]  [Refactoring]  [Documentation]  [Tests]      │
│  ─────────────                                                              │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │   Bug Fixes                                                         │   │
│  │                                                                     │   │
│  │   "Fix null pointer exception in UserService.getProfile()"         │   │
│  │                                                                     │   │
│  │   Worker analyzes the stack trace, locates the bug, writes a       │   │
│  │   fix with test coverage, and creates a PR. Average time: 12 min.  │   │
│  │                                                                     │   │
│  │   [See example PR →]                                                │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Use Case Categories**:
1. **Bug Fixes** - Stack traces, error handling, edge cases
2. **New Features** - API endpoints, UI components, integrations
3. **Refactoring** - Code cleanup, pattern migration, tech debt
4. **Documentation** - README updates, API docs, inline comments
5. **Tests** - Unit tests, integration tests, test coverage

---

## Section 7: Metrics That Matter

**Layout**: Large stat cards

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                       Built for Accountability                              │
│                                                                             │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐           │
│   │                 │  │                 │  │                 │           │
│   │   ~15 min       │  │   ~$0.50        │  │   ~85%          │           │
│   │   Avg MTTR      │  │   per task      │  │   success rate  │           │
│   │                 │  │                 │  │                 │           │
│   │ Mean time to    │  │ Transparent     │  │ First-attempt   │           │
│   │ resolution      │  │ cost tracking   │  │ completion      │           │
│   │                 │  │                 │  │                 │           │
│   └─────────────────┘  └─────────────────┘  └─────────────────┘           │
│                                                                             │
│   Track MTTA, MTTR, costs, and success rates. Export reports.              │
│   [Learn about metrics →]                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Section 8: Integrations

**Layout**: Logo grid with connection visual

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                    Works With Your Stack                                    │
│                                                                             │
│            ┌─────────┐          ┌─────────┐                                │
│            │  JIRA   │ ───────► │ Worker  │ ───────► ┌─────────┐          │
│            └─────────┘          │  Mill   │          │ GitHub  │          │
│                                 └─────────┘          └─────────┘          │
│                                                                             │
│   • Jira Cloud & Data Center    • GitHub & GitHub Enterprise               │
│   • Automatic status sync       • Branch creation & PR management          │
│   • Comment updates             • Webhook notifications                    │
│                                                                             │
│   Coming soon: Linear, GitLab, Bitbucket                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Section 9: Pricing (Preview)

**Layout**: Simple tier cards

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                          Simple, Transparent Pricing                        │
│                                                                             │
│     ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐ │
│     │     Starter     │      │      Pro        │      │   Enterprise   │ │
│     │                 │      │   (Popular)     │      │                 │ │
│     │   $99/month     │      │   $299/month    │      │    Custom      │ │
│     │                 │      │                 │      │                 │ │
│     │ • 50 tasks/mo   │      │ • 200 tasks/mo  │      │ • Unlimited    │ │
│     │ • 2 personas    │      │ • All personas  │      │ • SSO/SAML     │ │
│     │ • Email support │      │ • Virtual Mgr   │      │ • Dedicated    │ │
│     │                 │      │ • Priority      │      │ • SLA          │ │
│     │                 │      │                 │      │                 │ │
│     │ [Coming Soon]   │      │ [Coming Soon]   │      │ [Contact Us]   │ │
│     └─────────────────┘      └─────────────────┘      └─────────────────┘ │
│                                                                             │
│   * You only pay for AI costs (Claude API) - we charge for the platform   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Note**: Keep pricing cards but mark as "Coming Soon" since registration isn't enabled yet.

---

## Section 10: FAQ

**Layout**: Accordion/expandable questions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                       Frequently Asked Questions                            │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ▼ How does WorkerMill access my code?                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │   Workers clone your repository into isolated environments. Each    │   │
│  │   task runs in a fresh container with read/write access only to     │   │
│  │   the specific repo. Credentials are encrypted at rest.             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ► What AI models power the workers?                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ► Can workers break my production code?                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ► How do you handle sensitive data?                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ► What happens if a worker gets stuck?                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**FAQ Topics**:
1. How does WorkerMill access my code?
2. What AI models power the workers?
3. Can workers break my production code?
4. How do you handle sensitive data?
5. What happens if a worker gets stuck?
6. Can I use my own Anthropic API key?
7. What types of tasks work best?
8. How is this different from Copilot/Cursor?

---

## Section 11: CTA Footer

**Layout**: Dark section with clear call to action

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│              Ready to accelerate your engineering team?                     │
│                                                                             │
│                      [Request Early Access]                                 │
│                                                                             │
│         Join the waitlist. We're onboarding teams weekly.                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Section 12: Footer

**Layout**: Standard footer with links

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  WorkerMill                Product          Resources        Company       │
│                            How It Works     Documentation    About         │
│  AI-powered task           Features         API Reference    Blog          │
│  automation                Pricing          Changelog        Careers       │
│                            Integrations     Status           Contact       │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  © 2025 WorkerMill         Privacy Policy   Terms of Service   Security   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Visual Design System

### Colors
- **Primary**: Electric blue/purple gradient (matches dashboard)
- **Background**: Dark slate (#0f172a → #1e293b)
- **Cards**: Slightly lighter with subtle borders
- **Accents**: Green for success, amber for warnings
- **Text**: White/gray hierarchy

### Typography
- **Headlines**: Bold, large, gradient text for impact
- **Subheadlines**: Regular weight, muted color
- **Body**: Clean, readable, sufficient line height
- **Code**: Monospace for technical elements

### Motion
- **Subtle parallax** on hero scroll
- **Fade-in** on scroll for sections
- **Hover effects** on cards (scale, border glow)
- **No excessive animation** - professional, not playful

### Imagery
- **Dashboard screenshots** (real product)
- **Abstract code/terminal visuals** (not stock photos)
- **Persona icons** (emoji or custom icons)
- **Integration logos** (Jira, GitHub)

---

## Technical Implementation

### Route Structure
```
/ (Homepage - public)
/login (Login page - public)
/docs (Public documentation subset)
/docs/* (All doc pages - public)
/dashboard (Protected)
/setup (Protected)
```

### Components to Create
```
frontend/src/pages/Home/
├── Home.tsx              # Main homepage component
├── Hero.tsx              # Hero section
├── ProofBar.tsx          # Social proof/stats bar
├── HowItWorks.tsx        # 3-step flow
├── Workers.tsx           # Persona grid
├── Features.tsx          # Differentiator blocks
├── UseCases.tsx          # Tab interface
├── Metrics.tsx           # Stats cards
├── Integrations.tsx      # Logo grid
├── Pricing.tsx           # Tier cards
├── FAQ.tsx               # Accordion
├── CTAFooter.tsx         # Final CTA
└── Footer.tsx            # Site footer

frontend/src/components/
├── Navbar.tsx            # Shared navigation (public/private)
└── WaitlistForm.tsx      # Email capture modal
```

### Changes Required
1. Update `App.tsx` routing - make `/` public, redirect authenticated users
2. Create shared `Navbar` component for public pages
3. Make `/docs` accessible without authentication
4. Add waitlist/email capture functionality (simple form → API/database)

---

## Content Needs

Before implementation, we need:
1. **Hero video/animation** - Dashboard in action (could be GIF)
2. **Social proof** - Real metrics or early user quotes
3. **Screenshots** - Polished dashboard screenshots
4. **Legal pages** - Privacy Policy, Terms of Service (can be placeholder)

---

## Implementation Priority

### Phase 1: Core Homepage
1. Hero section with CTA
2. How It Works
3. Workers/Personas
4. Simple footer
5. Login button working

### Phase 2: Full Content
1. Features section
2. Use cases
3. Metrics
4. FAQ
5. Pricing (Coming Soon)

### Phase 3: Polish
1. Animations/transitions
2. Waitlist form backend
3. Analytics integration
4. SEO optimization (meta tags, OG images)

---

## Success Metrics

After launch, track:
- **Waitlist signups** (primary conversion)
- **Time on page** (engagement)
- **Scroll depth** (content effectiveness)
- **Login clicks** (existing user retention)
- **Doc page views** (education)
