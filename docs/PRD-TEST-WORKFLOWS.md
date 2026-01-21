# PRD Test Workflows for Market Expansion

This document contains comprehensive Product Requirements Documents (PRDs) designed to test WorkerMill's orchestration capabilities at scale. Each PRD represents a substantial product initiative that would generate 15-30+ stories across multiple personas.

## Purpose

These PRDs serve dual purposes:
1. **Validate WorkerMill's PRD Workflow** - Test planning agent, multi-story coordination, dependency management, and persona routing
2. **Demonstrate Market Value** - Show potential customers that WorkerMill can execute real product development, not just individual tickets

## PRD Candidates Overview

| # | PRD | Target Market | Est. Stories | Primary Personas |
|---|-----|--------------|--------------|------------------|
| 1 | Public Status Page Platform | B2B SaaS companies | 24 | backend, frontend, devops |
| 2 | Incident Analytics & SLA Platform | Enterprise IT | 22 | backend, frontend, qa |
| 3 | Runbook Automation Engine | DevOps/SRE teams | 28 | backend, frontend, security, devops |

---

# Execution Tracking Framework

## Overview

Each PRD execution is time-boxed with explicit go/no-go gates. This prevents runaway costs and ensures we fail fast if the workflow isn't working.

## Success Definition

| Level | Definition | Action |
|-------|------------|--------|
| **Full Success** | >85% stories merged, feature deployable, <120% time budget | Document as case study, proceed to next PRD |
| **Partial Success** | 60-85% stories merged, core functionality works | Analyze failures, fix workflow bugs, retry failed stories |
| **Failure** | <60% stories merged OR >150% time budget | Abort, conduct post-mortem, fix systemic issues before retry |

## Time & Cost Budgets

| PRD | Max Duration | Max Cost | Stories | Cost/Story Budget |
|-----|--------------|----------|---------|-------------------|
| #1 Status Pages | 5 days | $150 | 24 | ~$6.25 |
| #2 Analytics | 4 days | $120 | 22 | ~$5.45 |
| #3 Runbook Engine | 7 days | $200 | 28 | ~$7.14 |

**Abort Triggers:**
- Cost exceeds 150% of budget
- Time exceeds 150% of duration
- 3+ consecutive story failures
- Same story fails 3+ times

## Phase Gates

### Gate 0: Pre-Execution Checklist
Before starting any PRD execution:

| Check | Required | Verification |
|-------|----------|--------------|
| Target repo builds cleanly | ✓ | `npm run build` passes |
| Target repo tests pass | ✓ | `npm test` passes (or N/A) |
| No blocking PRs open | ✓ | Check GitHub PR queue |
| WorkerMill orchestrator healthy | ✓ | Dashboard shows "Running" |
| Planning agent tested | ✓ | Dry-run plan generation works |

### Gate 1: Planning Complete (Hour 2)

| Metric | Pass Criteria | Fail Action |
|--------|---------------|-------------|
| Plan generated | Yes | Debug planning agent |
| Story count reasonable | Within ±20% of estimate | Adjust PRD scope |
| Dependencies logical | No circular deps, clear order | Re-prompt planning |
| Personas assigned | All stories have persona | Fix assignment logic |
| Human review | Plan approved | Iterate on plan |

**Go/No-Go Decision:** Human approves plan before any execution begins.

### Gate 2: Foundation Phase Complete (Day 1-2)

| Metric | Pass Criteria | Fail Action |
|--------|---------------|-------------|
| Phase 1 stories completed | ≥80% merged | Pause, debug failures |
| Build still passing | Yes | Fix before continuing |
| PR approval rate | ≥70% first-attempt | Review PR quality |
| Avg time per story | <4 hours | Investigate bottlenecks |

**Go/No-Go Decision:** Proceed only if foundation is solid.

### Gate 3: Mid-Execution Check (Day 2-3)

| Metric | Pass Criteria | Fail Action |
|--------|---------------|-------------|
| Overall completion | ≥40% stories merged | Evaluate abort |
| Dependency handling | Blocked stories unblock correctly | Fix orchestrator |
| Cost burn rate | <budget pace | Throttle or abort |
| Conflict rate | <10% of PRs have conflicts | Improve coordination |

**Go/No-Go Decision:** Continue, adjust, or abort based on trajectory.

### Gate 4: Pre-Completion (Day N-1)

| Metric | Pass Criteria | Fail Action |
|--------|---------------|-------------|
| Stories remaining | ≤20% | Push to complete |
| Integration tests | Core flows pass | Debug integration |
| Blocking issues | 0 critical blockers | Escalate or abort |

### Gate 5: Completion Review (Final)

| Metric | Pass Criteria | Fail Action |
|--------|---------------|-------------|
| All P0 stories | 100% merged | Cannot ship without |
| All P1 stories | ≥80% merged | Acceptable |
| Feature deployable | Yes | Debug deployment |
| User acceptance | Manual QA passed | Fix critical bugs |

## Per-Story Tracking

Each story tracks:

```
┌─────────────────────────────────────────────────────────────┐
│ Story: 1.3 - Status page creation wizard UI                 │
├─────────────────────────────────────────────────────────────┤
│ Status:        completed ✓                                  │
│ Persona:       frontend                                     │
│ Dependencies:  [1.2] ✓                                      │
│ Attempts:      1                                            │
│ Time:          2h 34m                                       │
│ Cost:          $4.82                                        │
│ PR:            #147 (merged)                                │
│ PR Attempts:   1 (approved first try)                       │
│ Files Changed: 4                                            │
│ Lines Added:   342                                          │
│ Test Coverage: 78%                                          │
└─────────────────────────────────────────────────────────────┘
```

## Metrics Dashboard

Track in real-time during execution:

### Velocity Metrics
| Metric | Formula | Target |
|--------|---------|--------|
| Stories/Day | Completed stories / Days elapsed | ≥5 |
| PR Merge Rate | Merged PRs / Total PRs | ≥85% |
| First-Attempt Success | PRs approved first try / Total PRs | ≥70% |
| Rework Rate | Revision requests / Total PRs | ≤30% |

### Quality Metrics
| Metric | Formula | Target |
|--------|---------|--------|
| Build Break Rate | Builds broken by PRs / Total PRs | ≤5% |
| Test Pass Rate | Tests passing after merge / Total merges | ≥95% |
| Conflict Rate | PRs with merge conflicts / Total PRs | ≤10% |
| Rollback Rate | Reverted PRs / Total PRs | ≤2% |

### Cost Metrics
| Metric | Formula | Target |
|--------|---------|--------|
| Cost per Story | Total spend / Completed stories | ≤budget |
| Cost per Line | Total spend / Lines of code | Trend down |
| Retry Cost | Spend on retried stories / Total spend | ≤15% |

### Dependency Metrics
| Metric | Formula | Target |
|--------|---------|--------|
| Blocked Time | Time stories spent blocked / Total time | ≤20% |
| Unblock Latency | Time from dependency done to unblock | ≤5 min |
| Dependency Failures | Stories failed due to bad dependency | 0 |

## Abort Criteria

Immediately stop execution if:

| Condition | Threshold | Rationale |
|-----------|-----------|-----------|
| Cost overrun | >150% budget | Prevent runaway spending |
| Time overrun | >150% duration | Opportunity cost |
| Consecutive failures | 3+ stories | Systemic issue |
| Same story fails | 3+ attempts | Story is problematic |
| Build broken | >2 hours | Blocking all progress |
| Security issue | Any | Cannot ship insecure code |

## Post-Execution Analysis

After each PRD, document:

### Success Analysis
- Which story types succeeded most? (backend vs frontend vs devops)
- Which dependencies were handled well?
- What was the optimal parallelization?

### Failure Analysis
- Root cause for each failed story
- Were failures due to: bad prompt, bad code, bad dependency, bad planning?
- What workflow bugs were discovered?

### Cost Analysis
- Actual vs budgeted cost
- Cost by persona type
- Cost by story complexity
- Retry/rework cost breakdown

### Time Analysis
- Actual vs estimated duration
- Bottlenecks identified
- Optimal phase sizing

### Recommendations
- Workflow improvements needed
- Planning agent adjustments
- Prompt engineering changes
- Architecture changes for target repo

## Tracking Template

Use this template to track each PRD execution:

```markdown
# PRD Execution: [Name]
Started: YYYY-MM-DD HH:MM
Target Completion: YYYY-MM-DD

## Budget
- Time: X days (deadline: DATE)
- Cost: $XXX (current: $YYY)

## Current Status
- Phase: [1-5]
- Stories: XX/YY completed (ZZ%)
- Blockers: [list]

## Gate Status
- [ ] Gate 0: Pre-execution ✓
- [ ] Gate 1: Planning complete
- [ ] Gate 2: Foundation complete
- [ ] Gate 3: Mid-execution check
- [ ] Gate 4: Pre-completion
- [ ] Gate 5: Final review

## Story Tracker
| Story | Status | Attempts | Time | Cost | PR |
|-------|--------|----------|------|------|-----|
| 1.1 | ✓ | 1 | 2h | $3.50 | #142 |
| 1.2 | ✓ | 2 | 4h | $7.20 | #143 |
| 1.3 | 🔄 | 1 | - | $2.10 | #144 |
| ... | | | | | |

## Daily Log
### Day 1
- Stories completed: X
- Issues encountered: ...
- Gate status: ...
- Go/No-Go decision: PROCEED / PAUSE / ABORT

### Day 2
...
```

---

# PRD #1: Public Status Page Platform

## Executive Summary

Build a customer-facing status page system that allows OnCallShift users to communicate service health to their own customers. This competes with Atlassian Statuspage ($29-99/user/month) at OnCallShift's disruptive price point.

**Business Case:** Status pages are a natural extension of incident management. Teams already track incidents internally - this feature lets them communicate externally with minimal additional effort.

**Revenue Impact:**
- New revenue stream: $10-20/status page/month
- Competitive differentiation from pure incident management tools
- Reduced churn (customers more embedded in platform)

## Problem Statement

### Current State
- OnCallShift users manage incidents internally but manually update external stakeholders
- Common workarounds: manual emails, Slack announcements, third-party status page tools
- Disconnect between internal incident status and external communication

### Pain Points
1. **Manual Communication Overhead** - Engineers spend 15-30 min per incident on stakeholder updates
2. **Tool Fragmentation** - Separate status page service means duplicate data entry
3. **Delayed Updates** - External status often lags internal reality by 10-30 minutes
4. **Cost** - Statuspage.io costs $29-99/month on top of incident management tools

### Desired State
- Incidents automatically reflect on public status page (with controls)
- One-click publish of incident updates to status page
- Customers self-serve status checks instead of filing support tickets
- Embedded status widgets for customer portals

## Market Analysis

### Competitive Landscape

| Competitor | Pricing | Strengths | Weaknesses |
|------------|---------|-----------|------------|
| Atlassian Statuspage | $29-99/mo | Market leader, polished | Expensive, no incident management |
| Instatus | $20-50/mo | Modern UI, fast | Limited integrations |
| Cachet | Free (OSS) | Self-hosted | Requires maintenance, dated UI |
| Better Uptime | $20-60/mo | Uptime monitoring included | Separate from incident tools |

### Opportunity
- No incumbent offers integrated incident management + status pages at <$30/mo
- 67% of SaaS companies report needing status page functionality
- Status pages reduce support ticket volume by 15-30% during outages

## User Personas

### Persona 1: Sarah - Engineering Manager
- **Role:** Manages a team of 8 engineers at a B2B SaaS company
- **Goals:** Reduce time engineers spend on stakeholder communication
- **Frustrations:** Manually updating Statuspage.io while also managing incidents
- **Quote:** "I wish our status page updated automatically when we acknowledge an incident"

### Persona 2: Marcus - Customer Success Lead
- **Role:** Manages relationships with 50 enterprise accounts
- **Goals:** Proactively communicate outages before customers notice
- **Frustrations:** Finding out about incidents from customers instead of engineering
- **Quote:** "I need a link I can send customers that shows real-time status"

### Persona 3: DevOps Dana - Site Reliability Engineer
- **Role:** On-call engineer, first responder to incidents
- **Goals:** Focus on fixing issues, not writing status updates
- **Frustrations:** Pressure to update status page while debugging production
- **Quote:** "Let me push a button to say 'investigating' and get back to the terminal"

## User Journeys

### Journey 1: Initial Status Page Setup
```
Sarah logs into OnCallShift
→ Navigates to Status Pages section
→ Clicks "Create Status Page"
→ Enters subdomain (acme.oncallstatus.com) and branding
→ Selects which services to display publicly
→ Configures incident auto-publish rules
→ Previews status page
→ Publishes and shares URL with customers
```

### Journey 2: Incident Triggers Status Update
```
Alert fires → Incident created in OnCallShift
→ Dana acknowledges incident
→ System checks auto-publish rules
→ Status page shows "Service Degraded - Investigating"
→ Dana adds internal note: "Database connection pool exhausted"
→ Dana clicks "Publish Update" with customer-friendly message
→ Status page updates, subscribers notified
→ Dana resolves incident
→ Status page shows "Resolved" with timeline
```

### Journey 3: Customer Checks Status
```
Customer notices slowness in Acme's product
→ Visits status.acme.com
→ Sees "API Service - Degraded Performance"
→ Reads latest update: "Investigating increased latency"
→ Clicks "Subscribe" and enters email
→ Receives email when incident resolves
→ Doesn't file support ticket (saved CS team time)
```

## Functional Requirements

### Epic 1: Status Page Management
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 1.1 | Create status page with custom subdomain | P0 | backend |
| 1.2 | Configure status page branding (logo, colors, favicon) | P1 | frontend |
| 1.3 | Select services to display on status page | P0 | backend |
| 1.4 | Set service display names (public vs internal names) | P1 | backend |
| 1.5 | Preview status page before publishing | P1 | frontend |
| 1.6 | Delete/archive status page | P2 | backend |

### Epic 2: Public Status Page Display
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 2.1 | Render public status page at custom subdomain | P0 | frontend |
| 2.2 | Display current status for each service (operational/degraded/outage) | P0 | frontend |
| 2.3 | Show active incidents with timeline | P0 | frontend |
| 2.4 | Display 90-day uptime history per service | P1 | backend, frontend |
| 2.5 | Show scheduled maintenance windows | P1 | frontend |
| 2.6 | Mobile-responsive status page design | P1 | frontend |
| 2.7 | Status page loads in <2 seconds globally (CDN) | P1 | devops |

### Epic 3: Incident-to-Status Integration
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 3.1 | Auto-publish incident to status page based on severity rules | P0 | backend |
| 3.2 | Manual "Publish to Status Page" action from incident | P0 | backend, frontend |
| 3.3 | Edit customer-facing incident message (separate from internal notes) | P0 | frontend |
| 3.4 | Incident status transitions reflect on status page | P0 | backend |
| 3.5 | Post-incident: display resolution summary on status page | P1 | backend |
| 3.6 | Incident privacy controls (never publish certain services) | P1 | backend |

### Epic 4: Subscriber Notifications
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 4.1 | Email subscription signup on status page | P0 | backend, frontend |
| 4.2 | Send email notifications on incident updates | P0 | backend |
| 4.3 | Webhook subscription for programmatic consumers | P1 | backend |
| 4.4 | Unsubscribe link in all notification emails | P0 | backend |
| 4.5 | Subscription management page for subscribers | P2 | frontend |

### Epic 5: Embeddable Widgets
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 5.1 | Embeddable status badge (image) for READMEs | P1 | backend |
| 5.2 | Embeddable JavaScript widget for customer portals | P1 | frontend |
| 5.3 | Widget customization (size, theme, services shown) | P2 | frontend |

### Epic 6: Scheduled Maintenance
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 6.1 | Create scheduled maintenance window | P1 | backend |
| 6.2 | Display upcoming maintenance on status page | P1 | frontend |
| 6.3 | Notify subscribers of upcoming maintenance | P1 | backend |
| 6.4 | Auto-transition maintenance window states | P2 | backend |

## Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Status page load time | <2s (p95) | Customers check during outages when patience is low |
| Availability | 99.95% | Status page must be up when main product is down |
| Subscriber notification delivery | <60s from publish | Timely communication is the core value prop |
| Global latency | <500ms from any region | International customers need fast access |
| Status page isolation | Separate infrastructure | Status page shouldn't go down with main product |

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Status page adoption | 40% of paid orgs within 6 months | % of orgs with active status page |
| Subscriber growth | 100+ subscribers per status page avg | Avg subscribers per active page |
| Support ticket reduction | 20% decrease during incidents | Compare ticket volume before/after |
| Time to external update | <5 min from incident creation | Measure publish latency |
| Customer satisfaction | >4.2/5 feature rating | In-app survey |

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Status page down during incident | High - defeats purpose | Low | Host on separate infrastructure, CDN |
| Accidental publish of sensitive info | High - customer trust | Medium | Preview before publish, audit log |
| Subdomain squatting | Medium - brand issues | Low | Verify domain ownership for custom domains |
| Email deliverability issues | Medium - notifications fail | Medium | Use dedicated sending domain, monitor bounces |

## Story Breakdown for WorkerMill

### Phase 1: Foundation (Stories 1-8)
```
Story 1: Database schema for status pages, services mapping, subscribers
  Persona: backend
  Dependencies: None

Story 2: API endpoints for status page CRUD
  Persona: backend
  Dependencies: Story 1

Story 3: Status page creation wizard UI
  Persona: frontend
  Dependencies: Story 2

Story 4: Public status page renderer (React)
  Persona: frontend
  Dependencies: Story 2

Story 5: Service status display component
  Persona: frontend
  Dependencies: Story 4

Story 6: CDN configuration for status page hosting
  Persona: devops
  Dependencies: Story 4

Story 7: Custom subdomain routing
  Persona: devops
  Dependencies: Story 6

Story 8: Status page branding customization
  Persona: frontend
  Dependencies: Story 3
```

### Phase 2: Incident Integration (Stories 9-14)
```
Story 9: Incident-to-status-page linking model
  Persona: backend
  Dependencies: Story 1

Story 10: Auto-publish rules engine
  Persona: backend
  Dependencies: Story 9

Story 11: "Publish to Status Page" UI action
  Persona: frontend
  Dependencies: Story 9

Story 12: Customer-facing message editor
  Persona: frontend
  Dependencies: Story 11

Story 13: Incident status sync to status page
  Persona: backend
  Dependencies: Story 10

Story 14: Incident timeline on public page
  Persona: frontend
  Dependencies: Story 13
```

### Phase 3: Notifications (Stories 15-19)
```
Story 15: Subscriber model and email capture
  Persona: backend
  Dependencies: Story 1

Story 16: Email notification service integration
  Persona: backend
  Dependencies: Story 15

Story 17: Subscriber signup UI on status page
  Persona: frontend
  Dependencies: Story 15

Story 18: Unsubscribe handling
  Persona: backend
  Dependencies: Story 16

Story 19: Webhook subscription support
  Persona: backend
  Dependencies: Story 15
```

### Phase 4: Polish & Extras (Stories 20-24)
```
Story 20: 90-day uptime history calculation
  Persona: backend
  Dependencies: Story 1

Story 21: Uptime history visualization
  Persona: frontend
  Dependencies: Story 20

Story 22: Embeddable status badge generator
  Persona: backend
  Dependencies: Story 2

Story 23: JavaScript embed widget
  Persona: frontend
  Dependencies: Story 4

Story 24: Scheduled maintenance support
  Persona: backend
  Dependencies: Story 9
```

## Definition of Done

- [ ] All P0 stories completed and deployed
- [ ] Status page loads in <2s from US, EU, APAC
- [ ] Incident published to status page within 30s of action
- [ ] Email notifications delivered within 60s
- [ ] 90%+ code coverage on critical paths
- [ ] Security review passed (no PII leakage, proper auth)
- [ ] Documentation complete (user guide, API docs)
- [ ] Load tested to 10,000 concurrent status page viewers

---

# PRD #2: Incident Analytics & SLA Platform

## Executive Summary

Build a comprehensive analytics platform that provides actionable insights into incident patterns, team performance, and SLA compliance. This enables data-driven decisions about reliability investments and demonstrates ROI of incident management practices to executives.

**Business Case:** Teams track incidents but lack tools to analyze patterns. Executives need SLA compliance reports for customers. This creates upsell opportunity for enterprise tier.

**Revenue Impact:**
- Enterprise tier differentiator ($20-50/user/month premium)
- Reduced churn through demonstrated value/ROI
- Enables SLA-based contracts with customers

## Problem Statement

### Current State
- OnCallShift tracks incidents but provides minimal analytics
- Teams manually calculate MTTR/MTTA in spreadsheets
- No SLA tracking or compliance reporting
- Executives lack visibility into incident trends

### Pain Points
1. **No Trend Visibility** - "Are we getting better or worse at incident response?"
2. **Manual Reporting** - Teams spend hours preparing monthly reliability reports
3. **SLA Blind Spots** - No automated tracking of customer SLA commitments
4. **Unfair On-Call Distribution** - No data on who gets paged most

### Desired State
- Real-time dashboards showing incident trends and team performance
- Automated SLA tracking with breach alerts
- Scheduled reports delivered to stakeholders
- Data-driven insights for process improvement

## Market Analysis

### Competitive Landscape

| Competitor | Analytics Capability | SLA Tracking |
|------------|---------------------|--------------|
| PagerDuty | Advanced (Analytics add-on $$$) | Enterprise only |
| Opsgenie | Basic dashboards | Limited |
| Datadog | Excellent (but separate tool) | Via monitors |
| Rootly | Good incident analytics | Basic |

### Opportunity
- Analytics is a common enterprise procurement requirement
- PagerDuty charges $39/user/month extra for Advanced Analytics
- Bundled analytics at OnCallShift's price point is disruptive

## User Personas

### Persona 1: VP Engineering - Victor
- **Role:** Owns reliability for 200-person engineering org
- **Goals:** Report to CEO on reliability metrics, justify SRE headcount
- **Frustrations:** Manually compiling incident data into board presentations
- **Quote:** "I need a dashboard I can show the CEO that proves we're improving"

### Persona 2: SRE Manager - Maya
- **Role:** Manages 6-person SRE team, owns SLAs
- **Goals:** Ensure SLA compliance, optimize on-call rotations
- **Frustrations:** Discovering SLA breaches after customer complaints
- **Quote:** "I want to know we're about to breach an SLA before we actually do"

### Persona 3: On-Call Engineer - Jake
- **Role:** Regular on-call participant, cares about work-life balance
- **Goals:** Fair on-call distribution, fewer unnecessary pages
- **Frustrations:** Feels like he gets paged more than teammates
- **Quote:** "Show me the data - am I really getting paged more, or does it just feel that way?"

## User Journeys

### Journey 1: Executive Reviews Monthly Reliability
```
Victor opens OnCallShift Analytics dashboard
→ Views "Reliability Summary" for past month
→ Sees MTTR improved 23% vs previous month
→ Notes top 3 services by incident volume
→ Exports PDF report for leadership meeting
→ Schedules report for automatic delivery monthly
```

### Journey 2: SRE Manager Monitors SLA Health
```
Maya configures SLA for "API Service" (99.9% uptime)
→ System calculates current compliance: 99.87%
→ Dashboard shows "At Risk" status
→ Maya drills down to see contributing incidents
→ Creates action item to address root cause
→ Sets up alert for SLA breach threshold
```

### Journey 3: Engineer Checks On-Call Fairness
```
Jake opens Team Analytics
→ Views "On-Call Load Distribution" chart
→ Sees he's received 34 pages vs team average of 28
→ Breaks down by time of day - mostly overnight
→ Brings data to manager for rotation adjustment
→ Manager rebalances schedule based on insights
```

## Functional Requirements

### Epic 1: Core Metrics Engine
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 1.1 | Calculate MTTR (Mean Time to Resolve) per service/team | P0 | backend |
| 1.2 | Calculate MTTA (Mean Time to Acknowledge) per service/team | P0 | backend |
| 1.3 | Calculate MTBF (Mean Time Between Failures) | P1 | backend |
| 1.4 | Track incident volume over time (hourly/daily/weekly/monthly) | P0 | backend |
| 1.5 | Compute incident trends (improving/degrading/stable) | P1 | backend |
| 1.6 | Aggregate metrics by service, team, severity, time period | P0 | backend |

### Epic 2: Analytics Dashboard
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 2.1 | Reliability summary dashboard with key metrics | P0 | frontend |
| 2.2 | Incident volume time series chart | P0 | frontend |
| 2.3 | MTTR/MTTA trend visualization | P0 | frontend |
| 2.4 | Service health heatmap | P1 | frontend |
| 2.5 | Top services by incident volume table | P1 | frontend |
| 2.6 | Date range selector and filtering | P0 | frontend |
| 2.7 | Dashboard drill-down to incident list | P1 | frontend |

### Epic 3: SLA Management
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 3.1 | Define SLA targets per service (uptime %, response time) | P0 | backend |
| 3.2 | Calculate current SLA compliance from incident data | P0 | backend |
| 3.3 | SLA status dashboard (compliant/at-risk/breached) | P0 | frontend |
| 3.4 | SLA breach alerting via notification channels | P0 | backend |
| 3.5 | SLA burn rate calculation (error budget remaining) | P1 | backend |
| 3.6 | Historical SLA compliance reporting | P1 | backend, frontend |

### Epic 4: Team Performance Analytics
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 4.1 | On-call load distribution per team member | P0 | backend |
| 4.2 | On-call fairness visualization | P0 | frontend |
| 4.3 | Response time by individual (time to acknowledge) | P1 | backend |
| 4.4 | Pages by time of day/day of week analysis | P1 | frontend |
| 4.5 | Escalation frequency analysis | P2 | backend |

### Epic 5: Reporting & Export
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 5.1 | Export dashboard as PDF report | P1 | frontend |
| 5.2 | Export raw data as CSV | P1 | backend |
| 5.3 | Scheduled report delivery (daily/weekly/monthly) | P1 | backend |
| 5.4 | Custom report builder (select metrics, date range) | P2 | frontend |
| 5.5 | Email report templates | P2 | backend |

## Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Dashboard load time | <3s for 1-year data | Executives won't wait |
| Metric calculation freshness | <5 min lag | Near real-time SLA tracking |
| Data retention | 2 years | Trend analysis needs history |
| Report generation | <30s for full PDF | Async with notification |
| Query performance | <1s for any aggregation | Fast drill-down exploration |

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Analytics DAU | 30% of active users | Daily active users on analytics pages |
| Report exports | 5+ per org per month | Export actions tracked |
| SLA configuration | 60% of services have SLA | Services with SLA defined |
| Enterprise conversion | 15% lift | A/B test enterprise tier |

## Story Breakdown for WorkerMill

### Phase 1: Metrics Foundation (Stories 1-6)
```
Story 1: Incident metrics calculation service
  Persona: backend
  Dependencies: None

Story 2: Time-series aggregation for incident data
  Persona: backend
  Dependencies: Story 1

Story 3: MTTR/MTTA/MTBF calculation logic
  Persona: backend
  Dependencies: Story 1

Story 4: Metrics API endpoints
  Persona: backend
  Dependencies: Stories 1-3

Story 5: Service/team/severity dimension support
  Persona: backend
  Dependencies: Story 4

Story 6: Metrics caching layer for performance
  Persona: backend
  Dependencies: Story 4
```

### Phase 2: Dashboard UI (Stories 7-12)
```
Story 7: Analytics page layout and navigation
  Persona: frontend
  Dependencies: Story 4

Story 8: Key metrics summary cards
  Persona: frontend
  Dependencies: Story 7

Story 9: Incident volume time series chart
  Persona: frontend
  Dependencies: Story 7

Story 10: MTTR/MTTA trend charts
  Persona: frontend
  Dependencies: Story 7

Story 11: Date range picker and filters
  Persona: frontend
  Dependencies: Story 7

Story 12: Drill-down to incident list
  Persona: frontend
  Dependencies: Story 11
```

### Phase 3: SLA System (Stories 13-17)
```
Story 13: SLA definition model and API
  Persona: backend
  Dependencies: Story 1

Story 14: SLA compliance calculation engine
  Persona: backend
  Dependencies: Story 13

Story 15: SLA configuration UI
  Persona: frontend
  Dependencies: Story 13

Story 16: SLA dashboard with status indicators
  Persona: frontend
  Dependencies: Story 14

Story 17: SLA breach notifications
  Persona: backend
  Dependencies: Story 14
```

### Phase 4: Team Analytics (Stories 18-20)
```
Story 18: On-call load calculation per user
  Persona: backend
  Dependencies: Story 1

Story 19: On-call fairness visualization
  Persona: frontend
  Dependencies: Story 18

Story 20: Time-of-day/day-of-week analysis
  Persona: frontend
  Dependencies: Story 18
```

### Phase 5: Reporting (Stories 21-22)
```
Story 21: PDF report generation
  Persona: backend
  Dependencies: Stories 7-12

Story 22: Scheduled report delivery
  Persona: backend
  Dependencies: Story 21
```

## Definition of Done

- [ ] All P0 stories completed and deployed
- [ ] Dashboard loads 1-year data in <3s
- [ ] SLA calculations accurate to 99.9%
- [ ] Scheduled reports deliver reliably
- [ ] Test coverage >85% on calculation logic
- [ ] Documentation for SLA configuration
- [ ] User acceptance testing with 3 beta customers

---

# PRD #3: Runbook Automation Engine

## Executive Summary

Build a runbook automation system that allows teams to define, execute, and track operational procedures during incident response. Move beyond documentation to executable runbooks that can perform actual remediation steps with appropriate safeguards.

**Business Case:** Runbooks reduce MTTR but are often outdated documentation. Executable runbooks ensure consistent response and enable junior engineers to handle complex incidents. Competing with Rundeck ($$$) and PagerDuty Process Automation.

**Revenue Impact:**
- Premium feature for enterprise tier
- Stickiness through operational dependency
- Reduced MTTR = quantifiable customer ROI

## Problem Statement

### Current State
- OnCallShift has basic runbook storage (text documentation)
- Runbooks are passive - engineers read and manually execute steps
- No tracking of which runbook steps were performed
- Runbooks quickly become outdated

### Pain Points
1. **Manual Execution** - Engineers copy-paste commands from runbooks, prone to errors
2. **No Audit Trail** - "Did we run the remediation? Which version?"
3. **Expertise Dependency** - Only senior engineers can handle complex runbooks
4. **Stale Documentation** - Runbooks drift from reality, cause confusion during incidents

### Desired State
- Executable runbooks with one-click step execution
- Approval workflows for dangerous operations
- Full audit trail of what was executed, by whom, with what result
- Integration with cloud providers for automated remediation

## Market Analysis

### Competitive Landscape

| Competitor | Capability | Pricing |
|------------|-----------|---------|
| PagerDuty Automation Actions | Full automation, event-driven | $$$$ |
| Rundeck | Powerful but complex | Enterprise pricing |
| Shoreline.io | AI-powered runbooks | $50k+/year |
| Manual + Wiki | Common alternative | Time cost |

### Opportunity
- Runbook automation is typically enterprise-only pricing
- OnCallShift can offer 80% of value at 20% of cost
- Natural extension of existing runbook feature

## User Personas

### Persona 1: Senior SRE - Priya
- **Role:** Designs runbooks, handles escalations
- **Goals:** Encode her expertise into runbooks others can execute
- **Frustrations:** Getting woken up for issues junior engineers could handle with guidance
- **Quote:** "If I document the exact steps, why can't the system just run them?"

### Persona 2: Junior Engineer - Alex
- **Role:** On-call, still learning the systems
- **Goals:** Handle incidents confidently without senior escalation
- **Frustrations:** Runbook says 'restart the service' but doesn't say how
- **Quote:** "I want to click a button that does what the runbook says"

### Persona 3: Security Officer - Chen
- **Role:** Ensures compliance and security
- **Goals:** Audit trail of all production changes during incidents
- **Frustrations:** No record of what commands were run during incident response
- **Quote:** "For SOC2, I need to prove who ran what commands and when"

## User Journeys

### Journey 1: SRE Creates Executable Runbook
```
Priya opens Runbook Editor
→ Creates "API High Latency" runbook
→ Adds diagnostic step: "Check database connections" (automated query)
→ Adds remediation step: "Restart API pods" (requires approval)
→ Adds verification step: "Confirm latency recovered" (automated check)
→ Sets approval requirement for restart step
→ Links runbook to "API Service"
→ Publishes runbook
```

### Journey 2: Junior Engineer Executes Runbook
```
Alert fires for API latency
→ Alex opens incident, sees linked runbook
→ Clicks "Start Runbook Execution"
→ Step 1 auto-runs: "Database connections: 450/500 (90%)"
→ Step 2 shows "Requires Approval" - Alex clicks request
→ Priya approves restart from mobile app
→ Step 2 executes: "Restarted 3 API pods"
→ Step 3 auto-runs: "Latency recovered: 45ms (target: <100ms)"
→ Runbook completes, incident updated with execution log
```

### Journey 3: Security Audit of Incident Response
```
Chen opens completed incident
→ Clicks "Execution History"
→ Sees full runbook execution:
  - 14:32:05 - Step 1 executed by system
  - 14:32:15 - Step 2 approval requested by Alex
  - 14:33:42 - Step 2 approved by Priya
  - 14:33:45 - Step 2 executed: kubectl rollout restart
  - 14:34:12 - Step 3 executed by system
→ Exports execution log for compliance
```

## Functional Requirements

### Epic 1: Runbook Editor
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 1.1 | Visual runbook step editor (drag-and-drop) | P0 | frontend |
| 1.2 | Step types: manual, automated, conditional, approval | P0 | backend |
| 1.3 | Runbook variables and parameters | P0 | backend |
| 1.4 | Runbook versioning | P1 | backend |
| 1.5 | Link runbook to services | P0 | backend |
| 1.6 | Runbook templates library | P2 | frontend |

### Epic 2: Step Execution Engine
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 2.1 | Manual step execution tracking | P0 | backend |
| 2.2 | Command execution in sandboxed environment | P0 | backend, security |
| 2.3 | API call step type (HTTP requests) | P0 | backend |
| 2.4 | Conditional step logic (if/then based on output) | P1 | backend |
| 2.5 | Step timeout and failure handling | P0 | backend |
| 2.6 | Step output capture and display | P0 | backend, frontend |

### Epic 3: Approval Workflows
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 3.1 | Mark steps as requiring approval | P0 | backend |
| 3.2 | Approval request notification | P0 | backend |
| 3.3 | Mobile-friendly approval interface | P0 | frontend |
| 3.4 | Approval timeout and escalation | P1 | backend |
| 3.5 | Approval delegation rules | P2 | backend |

### Epic 4: Cloud Integrations
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 4.1 | AWS integration (EC2, ECS, Lambda, RDS) | P1 | backend, devops |
| 4.2 | Kubernetes integration (kubectl commands) | P1 | backend, devops |
| 4.3 | Database query execution (read-only by default) | P1 | backend |
| 4.4 | Integration credential management | P0 | backend, security |
| 4.5 | GCP integration | P2 | backend, devops |

### Epic 5: Execution UI
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 5.1 | Runbook execution panel in incident view | P0 | frontend |
| 5.2 | Step progress visualization | P0 | frontend |
| 5.3 | Step output/logs display | P0 | frontend |
| 5.4 | Re-run failed step capability | P1 | frontend |
| 5.5 | Abort execution capability | P0 | frontend |

### Epic 6: Audit & Compliance
| ID | Story | Priority | Persona |
|----|-------|----------|---------|
| 6.1 | Full execution audit log | P0 | backend |
| 6.2 | Execution history viewer | P0 | frontend |
| 6.3 | Export execution log as PDF/JSON | P1 | backend |
| 6.4 | Compliance report generation | P2 | backend |

## Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Step execution latency | <5s to start | Fast response during incidents |
| Execution isolation | Container sandbox | Security - prevent lateral movement |
| Audit log retention | 7 years | Compliance requirements |
| Credential encryption | AES-256, KMS-backed | Security best practice |
| Concurrent executions | 10 per org | Prevent runaway automation |

## Security Requirements

| Requirement | Implementation |
|-------------|----------------|
| Execution sandboxing | Isolated containers with no network by default |
| Credential storage | AWS Secrets Manager, never in runbook definition |
| Least privilege | Integrations use scoped IAM roles |
| Approval logging | Immutable audit trail, tamper-evident |
| Command injection prevention | Parameterized execution, no shell interpolation |

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Runbook execution rate | 40% of incidents use runbook | Executions / incidents |
| MTTR reduction | 25% improvement | Before/after comparison |
| Junior escalation rate | 30% reduction | Escalations to senior |
| Automation adoption | 50% of steps automated | Automated / total steps |

## Story Breakdown for WorkerMill

### Phase 1: Runbook Editor (Stories 1-6)
```
Story 1: Runbook data model (steps, types, parameters)
  Persona: backend
  Dependencies: None

Story 2: Runbook CRUD API
  Persona: backend
  Dependencies: Story 1

Story 3: Visual step editor UI
  Persona: frontend
  Dependencies: Story 2

Story 4: Step type definitions (manual, command, API, conditional)
  Persona: backend
  Dependencies: Story 1

Story 5: Runbook-to-service linking
  Persona: backend
  Dependencies: Story 2

Story 6: Runbook versioning system
  Persona: backend
  Dependencies: Story 2
```

### Phase 2: Execution Engine (Stories 7-13)
```
Story 7: Execution runtime model (tracking state)
  Persona: backend
  Dependencies: Story 1

Story 8: Manual step execution tracking
  Persona: backend
  Dependencies: Story 7

Story 9: Sandboxed command execution container
  Persona: backend, security
  Dependencies: Story 7

Story 10: API call step executor
  Persona: backend
  Dependencies: Story 7

Story 11: Step output capture and storage
  Persona: backend
  Dependencies: Story 7

Story 12: Execution timeout handling
  Persona: backend
  Dependencies: Story 7

Story 13: Conditional step evaluation
  Persona: backend
  Dependencies: Story 11
```

### Phase 3: Approval System (Stories 14-17)
```
Story 14: Approval requirement model
  Persona: backend
  Dependencies: Story 1

Story 15: Approval request notification
  Persona: backend
  Dependencies: Story 14

Story 16: Approval UI (web and mobile)
  Persona: frontend
  Dependencies: Story 14

Story 17: Approval timeout and escalation
  Persona: backend
  Dependencies: Story 14
```

### Phase 4: Execution UI (Stories 18-21)
```
Story 18: Runbook execution panel in incident
  Persona: frontend
  Dependencies: Story 7

Story 19: Step progress and status visualization
  Persona: frontend
  Dependencies: Story 18

Story 20: Step output display
  Persona: frontend
  Dependencies: Story 11

Story 21: Abort execution capability
  Persona: frontend
  Dependencies: Story 7
```

### Phase 5: Cloud Integrations (Stories 22-25)
```
Story 22: Integration credential management (Secrets Manager)
  Persona: backend, security
  Dependencies: Story 9

Story 23: AWS integration (EC2, ECS actions)
  Persona: backend, devops
  Dependencies: Story 22

Story 24: Kubernetes integration
  Persona: backend, devops
  Dependencies: Story 22

Story 25: Database query execution
  Persona: backend
  Dependencies: Story 22
```

### Phase 6: Audit & Compliance (Stories 26-28)
```
Story 26: Execution audit log
  Persona: backend
  Dependencies: Story 7

Story 27: Execution history viewer
  Persona: frontend
  Dependencies: Story 26

Story 28: Compliance export (PDF/JSON)
  Persona: backend
  Dependencies: Story 26
```

## Definition of Done

- [ ] All P0 stories completed and deployed
- [ ] Command execution sandboxed and secure (pen test passed)
- [ ] Approval workflow works on mobile
- [ ] Full audit trail for compliance
- [ ] Integration with at least AWS and Kubernetes
- [ ] <5s step start latency
- [ ] Documentation for runbook authoring
- [ ] Security review approved

---

# Appendix: PRD Evaluation Criteria

## Workflow Test Coverage

| Capability | PRD #1 | PRD #2 | PRD #3 |
|-----------|--------|--------|--------|
| Multi-persona coordination | ✓ | ✓ | ✓ |
| Story dependencies | ✓ | ✓ | ✓ |
| Parallel execution | ✓ | ✓ | ✓ |
| DevOps persona | ✓ | - | ✓ |
| Security persona | - | - | ✓ |
| QA persona | - | ✓ | - |
| 20+ stories | ✓ | ✓ | ✓ |
| Branch coordination | ✓ | ✓ | ✓ |
| External integrations | ✓ | - | ✓ |

## Expected Success Rates (Hypothesis)

| PRD | Estimated Success Rate | Risk Factors |
|-----|----------------------|--------------|
| #1 Status Pages | 75-85% | CDN config complexity, subdomain routing |
| #2 Analytics | 80-90% | Lower risk - mostly CRUD + calculations |
| #3 Runbook Automation | 60-70% | Security sandboxing, cloud integrations |

## Recommended Test Order

1. **PRD #2 (Analytics)** - Lowest risk, tests core orchestration
2. **PRD #1 (Status Pages)** - Medium risk, tests devops persona
3. **PRD #3 (Runbook Automation)** - Highest risk, tests security-critical features

---

*Document generated for WorkerMill market expansion testing. Last updated: 2026-01-20*
