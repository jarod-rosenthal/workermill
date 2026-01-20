# Product Requirements Document: AlertHQ

## Incident Management Platform

**Version:** 1.0
**Date:** January 2026
**Status:** Draft
**Target:** AI Worker Execution via WorkerMill

---

## 1. Executive Summary

AlertHQ is a modern incident management and on-call scheduling platform designed for DevOps teams, SREs, and engineering organizations. It provides real-time alerting, intelligent escalation, and seamless integrations with monitoring tools to minimize downtime and improve incident response times.

### Vision Statement

*Empower engineering teams to respond to incidents faster with intelligent automation, clear ownership, and actionable insights.*

### Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Mean Time to Acknowledge (MTTA) | < 5 minutes | Platform analytics |
| Mean Time to Resolve (MTTR) | 30% reduction vs. baseline | Platform analytics |
| On-call fairness score | > 85% | Load distribution analysis |
| Alert noise reduction | 40% fewer duplicate alerts | Alert deduplication stats |
| User adoption | 80% daily active users | Usage analytics |

---

## 2. User Personas

### 2.1 Primary: On-Call Engineer
- **Role:** Software engineer or SRE on rotation
- **Goals:** Get alerted quickly, understand incident context, resolve issues fast
- **Pain Points:** Alert fatigue, unclear escalation paths, lack of runbook access
- **Key Features:** Mobile alerts, incident timeline, runbook integration

### 2.2 Primary: Engineering Manager
- **Role:** Team lead managing on-call rotations
- **Goals:** Fair on-call distribution, visibility into team performance, cost control
- **Pain Points:** Manual schedule management, no insight into incident patterns
- **Key Features:** Schedule builder, analytics dashboard, team management

### 2.3 Secondary: Platform/DevOps Engineer
- **Role:** Manages integrations and platform configuration
- **Goals:** Connect monitoring tools, configure routing rules, automate workflows
- **Pain Points:** Complex integration setup, inflexible routing
- **Key Features:** Integration marketplace, event routing rules, API access

### 2.4 Secondary: Executive/Director
- **Role:** Engineering leadership overseeing reliability
- **Goals:** Understand organizational reliability posture, justify investments
- **Pain Points:** Lack of aggregated metrics, no trend visibility
- **Key Features:** Executive dashboards, SLA reporting, cost analysis

---

## 3. Core Features

### Epic 1: User & Organization Management

#### 1.1 Authentication & Authorization
**User Story:** As a user, I want to securely sign in so that my account is protected.

**Acceptance Criteria:**
- GIVEN a new user visits the platform
- WHEN they click "Sign Up"
- THEN they can create an account with email/password or SSO (Google, GitHub)

- GIVEN an authenticated user
- WHEN they access resources
- THEN permissions are enforced based on their role (Admin, Manager, Member)

**Technical Notes:**
- Implement JWT-based authentication
- Support OAuth 2.0 for SSO providers
- RBAC with roles: Owner, Admin, Manager, Member
- Session management with refresh tokens

#### 1.2 Organization Setup
**User Story:** As an admin, I want to create and configure my organization so that my team can use the platform.

**Acceptance Criteria:**
- GIVEN an authenticated user without an organization
- WHEN they complete onboarding
- THEN an organization is created with default settings

- GIVEN an org admin
- WHEN they access organization settings
- THEN they can update name, timezone, notification defaults

**Technical Notes:**
- Multi-tenant architecture with org isolation
- Organization-level settings: timezone, default escalation timeout, notification channels

#### 1.3 Team Management
**User Story:** As a manager, I want to organize users into teams so that I can assign on-call responsibilities.

**Acceptance Criteria:**
- GIVEN an org admin or manager
- WHEN they create a team
- THEN they can add members and assign team roles

- GIVEN a team exists
- WHEN services are created
- THEN they can be associated with the owning team

**Technical Notes:**
- Teams have: name, description, members[], manager
- Team membership: Manager or Member role
- Teams own Services and Schedules

#### 1.4 User Invitation
**User Story:** As an admin, I want to invite team members so that they can join the platform.

**Acceptance Criteria:**
- GIVEN an admin enters an email address
- WHEN they send an invitation
- THEN the user receives an email with a signup link

- GIVEN an invited user clicks the link
- WHEN they complete registration
- THEN they are automatically added to the organization

**Technical Notes:**
- Email invitations with secure tokens (24h expiry)
- Bulk invite via CSV upload
- Pending invitation management UI

---

### Epic 2: Service Catalog

#### 2.1 Service Definition
**User Story:** As a platform engineer, I want to define services so that incidents can be routed correctly.

**Acceptance Criteria:**
- GIVEN a user with service creation permission
- WHEN they create a service
- THEN they must specify: name, description, owning team, escalation policy

- GIVEN a service exists
- WHEN an alert is received for that service
- THEN it creates an incident and notifies per the escalation policy

**Technical Notes:**
- Service fields: id, name, description, team_id, escalation_policy_id, status (active/disabled)
- Integration keys generated per service for alert routing
- Service health status based on recent incident count

#### 2.2 Service Dependencies
**User Story:** As an engineer, I want to map service dependencies so that I understand blast radius during incidents.

**Acceptance Criteria:**
- GIVEN a service exists
- WHEN I add dependencies
- THEN the dependency graph shows upstream/downstream services

- GIVEN an incident on a service
- WHEN I view incident details
- THEN I can see potentially impacted dependent services

**Technical Notes:**
- Service dependency graph (directed acyclic)
- Dependency types: hard (blocking), soft (degraded experience)
- Visual dependency map in UI

#### 2.3 Service Maintenance Windows
**User Story:** As an engineer, I want to schedule maintenance windows so that expected outages don't page the team.

**Acceptance Criteria:**
- GIVEN a service with scheduled maintenance
- WHEN alerts arrive during the window
- THEN they are suppressed or auto-acknowledged

- GIVEN a maintenance window
- WHEN the end time passes
- THEN normal alerting resumes automatically

**Technical Notes:**
- Maintenance windows: start_time, end_time, service_id, created_by
- Option to suppress alerts or auto-acknowledge
- Recurring maintenance windows (cron-based)

---

### Epic 3: On-Call Scheduling

#### 3.1 Schedule Creation
**User Story:** As a manager, I want to create on-call schedules so that there's always someone responsible.

**Acceptance Criteria:**
- GIVEN a manager creates a schedule
- WHEN they define rotation settings
- THEN the system generates the rotation timeline

- GIVEN a schedule exists
- WHEN I view it
- THEN I see who is on-call now and in the future

**Technical Notes:**
- Schedule types: daily rotation, weekly rotation, custom
- Rotation handoff time configuration
- Multiple layers (primary, secondary, etc.)
- Timezone-aware scheduling

#### 3.2 Schedule Overrides
**User Story:** As an on-call engineer, I want to swap shifts so that I can handle personal conflicts.

**Acceptance Criteria:**
- GIVEN an engineer needs coverage
- WHEN they create an override
- THEN another user is on-call for that time period

- GIVEN an override exists
- WHEN the override period ends
- THEN the original schedule resumes

**Technical Notes:**
- Override fields: schedule_id, user_id, start_time, end_time
- Override validation (no gaps in coverage)
- Notifications to affected users

#### 3.3 On-Call Calendar View
**User Story:** As a user, I want to see my on-call schedule in a calendar so that I can plan ahead.

**Acceptance Criteria:**
- GIVEN I am on-call
- WHEN I view my calendar
- THEN I see all my upcoming on-call shifts

- GIVEN a team schedule exists
- WHEN I view the team calendar
- THEN I see the full rotation for all team members

**Technical Notes:**
- iCal feed export for external calendar sync
- Personal calendar showing all my shifts
- Team calendar with filtering options

#### 3.4 Schedule Gap Detection
**User Story:** As a manager, I want to be alerted about schedule gaps so that we always have coverage.

**Acceptance Criteria:**
- GIVEN a schedule has a gap (no one on-call)
- WHEN the gap is within 7 days
- THEN the manager receives a notification

- GIVEN a schedule is being edited
- WHEN the edit would create a gap
- THEN a warning is displayed before saving

**Technical Notes:**
- Background job checks schedules daily
- Gap detection algorithm considers all layers
- Email/Slack notifications for gaps

---

### Epic 4: Escalation Policies

#### 4.1 Policy Creation
**User Story:** As a manager, I want to define escalation policies so that incidents reach the right people.

**Acceptance Criteria:**
- GIVEN I create an escalation policy
- WHEN I define steps
- THEN each step has targets (user, schedule, or team) and a timeout

- GIVEN an incident is not acknowledged within the timeout
- WHEN the timeout expires
- THEN the next escalation step is triggered

**Technical Notes:**
- Escalation step: order, delay_minutes, targets[]
- Target types: specific user, on-call schedule, entire team
- Repeat policy after all steps exhausted

#### 4.2 Escalation Notifications
**User Story:** As an on-call engineer, I want to be notified through multiple channels so that I don't miss alerts.

**Acceptance Criteria:**
- GIVEN an escalation step triggers
- WHEN targeting a user
- THEN they are notified via their configured channels in order

- GIVEN a notification is sent
- WHEN the user doesn't respond within their channel timeout
- THEN the next channel is tried

**Technical Notes:**
- Notification channels: push notification, email, SMS, phone call, Slack DM
- Per-user channel preferences and order
- Channel-specific timeouts before trying next channel

#### 4.3 Escalation Testing
**User Story:** As an admin, I want to test escalation policies so that I know they work correctly.

**Acceptance Criteria:**
- GIVEN an escalation policy exists
- WHEN I click "Test Policy"
- THEN a test incident is created (marked as test)

- GIVEN a test incident is created
- WHEN escalation runs
- THEN I can observe the notification flow in real-time

**Technical Notes:**
- Test incidents clearly marked, don't affect metrics
- Real-time escalation visualization
- Dry-run mode (show who would be notified without sending)

---

### Epic 5: Incident Management

#### 5.1 Incident Creation
**User Story:** As a monitoring system, I want to create incidents via API so that alerts reach the on-call team.

**Acceptance Criteria:**
- GIVEN a valid integration key
- WHEN a POST request is made to /incidents
- THEN an incident is created and escalation begins

- GIVEN an incident is created
- WHEN it has a dedup_key matching an open incident
- THEN the events are merged (no duplicate incident)

**Technical Notes:**
- Incident fields: title, description, severity, service_id, dedup_key, source
- Severity levels: critical, high, medium, low, info
- Deduplication within configurable time window (default 24h)
- Rate limiting per integration key

#### 5.2 Incident Lifecycle
**User Story:** As an on-call engineer, I want to manage incident state so that the team knows the status.

**Acceptance Criteria:**
- GIVEN an incident is triggered
- WHEN I acknowledge it
- THEN escalation pauses and status changes to "acknowledged"

- GIVEN an incident is acknowledged
- WHEN I resolve it
- THEN the incident closes and metrics are recorded

**Technical Notes:**
- States: triggered → acknowledged → resolved
- Auto-resolve after configurable timeout (optional)
- Snooze: temporarily pause notifications, auto-retrigger
- Reassign: transfer to another user

#### 5.3 Incident Timeline
**User Story:** As an engineer, I want to see the incident timeline so that I understand what happened.

**Acceptance Criteria:**
- GIVEN an incident exists
- WHEN I view the detail page
- THEN I see a chronological timeline of all events

- GIVEN timeline events exist
- WHEN I review them
- THEN I see: alerts received, notifications sent, status changes, notes added

**Technical Notes:**
- Event types: alert, escalation, ack, resolve, note, reassign
- Timestamps with timezone display
- User attribution for manual actions

#### 5.4 Incident Notes
**User Story:** As an engineer, I want to add notes to incidents so that I can document investigation.

**Acceptance Criteria:**
- GIVEN an incident exists
- WHEN I add a note
- THEN it appears in the timeline with my name and timestamp

- GIVEN a note is added
- WHEN other responders view the incident
- THEN they see the note and can reply

**Technical Notes:**
- Notes support markdown formatting
- @mentions to notify specific users
- Attachments (screenshots, log snippets)

#### 5.5 Incident Merging
**User Story:** As an engineer, I want to merge related incidents so that we track them as one issue.

**Acceptance Criteria:**
- GIVEN multiple related incidents exist
- WHEN I merge them
- THEN one becomes the parent and others are linked as children

- GIVEN incidents are merged
- WHEN the parent is resolved
- THEN all children are also resolved

**Technical Notes:**
- Parent-child incident relationship
- Merged incidents retain their timelines
- Metrics attributed to parent incident

---

### Epic 6: Alerting Integrations

#### 6.1 Monitoring Tool Integrations
**User Story:** As a platform engineer, I want to connect monitoring tools so that alerts create incidents automatically.

**Acceptance Criteria:**
- GIVEN I set up a Datadog integration
- WHEN Datadog sends a webhook
- THEN an incident is created with parsed alert data

- GIVEN multiple integrations exist
- WHEN alerts arrive
- THEN they route to the correct service based on configuration

**Technical Notes:**
- Supported integrations (Phase 1):
  - Datadog
  - AWS CloudWatch
  - Prometheus/Alertmanager
  - Grafana
  - New Relic
  - Custom webhooks
- Integration-specific payload parsers
- Field mapping configuration

#### 6.2 Email Integration
**User Story:** As a user, I want to create incidents via email so that any system can alert us.

**Acceptance Criteria:**
- GIVEN a service has an integration email address
- WHEN an email is sent to that address
- THEN an incident is created with email content

- GIVEN an email arrives
- WHEN the subject matches a dedup pattern
- THEN it's added to the existing incident

**Technical Notes:**
- Unique email addresses per service: {service-key}@alerts.alerthq.com
- Email parsing: subject → title, body → description
- Attachment handling

#### 6.3 Outbound Webhooks
**User Story:** As a platform engineer, I want to send incident data to other systems so that I can automate workflows.

**Acceptance Criteria:**
- GIVEN an outbound webhook is configured
- WHEN an incident state changes
- THEN a POST request is sent to the configured URL

- GIVEN a webhook fails
- WHEN retries are exhausted
- THEN the failure is logged and admin notified

**Technical Notes:**
- Configurable event triggers (create, ack, resolve, escalate)
- Retry with exponential backoff
- Webhook signature for verification (HMAC-SHA256)
- Webhook logs for debugging

---

### Epic 7: Collaboration Integrations

#### 7.1 Slack Integration
**User Story:** As a team, I want Slack notifications so that we collaborate during incidents.

**Acceptance Criteria:**
- GIVEN Slack is connected
- WHEN an incident is created
- THEN a message is posted to the configured channel

- GIVEN an incident Slack message exists
- WHEN I click "Acknowledge" button
- THEN the incident is acknowledged and message updated

**Technical Notes:**
- Slack app with Bot Token
- Interactive message buttons (Ack, Resolve, Escalate)
- Incident channel creation (optional per-incident channel)
- Thread replies for incident updates

#### 7.2 Microsoft Teams Integration
**User Story:** As a team using Teams, I want notifications so that we stay informed.

**Acceptance Criteria:**
- GIVEN Teams is connected
- WHEN an incident is created
- THEN an Adaptive Card is posted to the configured channel

- GIVEN a Teams notification exists
- WHEN I click action buttons
- THEN the incident state is updated

**Technical Notes:**
- Teams webhook connector or full app
- Adaptive Card format for rich notifications
- Action buttons for incident management

#### 7.3 Video Conferencing
**User Story:** As a responder, I want to start a war room call so that the team can collaborate in real-time.

**Acceptance Criteria:**
- GIVEN an incident exists
- WHEN I click "Start Call"
- THEN a video conference link is created and shared

- GIVEN a conference is active
- WHEN I view the incident
- THEN I see the link to join the call

**Technical Notes:**
- Integrations: Zoom, Google Meet, Microsoft Teams
- Auto-create conference on critical incidents (optional)
- Conference link in Slack/Teams notifications

---

### Epic 8: Runbooks

#### 8.1 Runbook Creation
**User Story:** As an engineer, I want to create runbooks so that responders know how to handle incidents.

**Acceptance Criteria:**
- GIVEN I create a runbook
- WHEN I define steps
- THEN each step has instructions and optional automation

- GIVEN a runbook exists
- WHEN I associate it with a service
- THEN it appears in incidents for that service

**Technical Notes:**
- Runbook fields: name, description, steps[], service_ids[]
- Step types: manual instruction, command, link
- Markdown support for instructions
- Version history for runbooks

#### 8.2 Runbook Execution
**User Story:** As a responder, I want to follow runbook steps so that I resolve incidents consistently.

**Acceptance Criteria:**
- GIVEN an incident with an attached runbook
- WHEN I view the incident
- THEN I see runbook steps with checkboxes

- GIVEN I complete a step
- WHEN I check it off
- THEN it's logged in the incident timeline

**Technical Notes:**
- Step completion tracking per incident
- Optional time tracking per step
- Notes per step execution

#### 8.3 Automated Runbook Steps
**User Story:** As a platform engineer, I want to automate runbook steps so that common actions are faster.

**Acceptance Criteria:**
- GIVEN a runbook step has automation
- WHEN I click "Execute"
- THEN the automation runs and results are logged

- GIVEN an automation runs
- WHEN it completes
- THEN the step is marked complete with output

**Technical Notes:**
- Automation types: webhook call, Slack message, custom script
- Secure credential storage for automation
- Execution timeout and error handling

---

### Epic 9: Analytics & Reporting

#### 9.1 Incident Analytics
**User Story:** As a manager, I want to see incident metrics so that I can identify improvement areas.

**Acceptance Criteria:**
- GIVEN incidents exist
- WHEN I view the analytics dashboard
- THEN I see MTTA, MTTR, incident count, and trends

- GIVEN I apply filters
- WHEN I select service/team/date range
- THEN metrics update to reflect the filter

**Technical Notes:**
- Metrics: MTTA, MTTR, incident count, escalation rate
- Grouping: by service, team, severity, time period
- Trend charts (daily, weekly, monthly)
- Export to CSV/PDF

#### 9.2 On-Call Fairness
**User Story:** As a manager, I want to see on-call load distribution so that I can balance workload.

**Acceptance Criteria:**
- GIVEN a team has on-call history
- WHEN I view the fairness report
- THEN I see pages per person and distribution score

- GIVEN imbalanced load
- WHEN the score drops below threshold
- THEN I receive a notification

**Technical Notes:**
- Metrics: pages per person, off-hours pages, incident time
- Fairness score algorithm (0-100)
- Recommendations for schedule adjustments

#### 9.3 Service Reliability
**User Story:** As an executive, I want to see service reliability metrics so that I can track SLA performance.

**Acceptance Criteria:**
- GIVEN services have incidents
- WHEN I view the reliability dashboard
- THEN I see uptime %, incident frequency, and top offenders

- GIVEN I set an SLA target
- WHEN uptime drops below target
- THEN it's highlighted in the dashboard

**Technical Notes:**
- Uptime calculation based on incidents
- SLA configuration per service
- Top services by incident count
- Week-over-week comparisons

#### 9.4 Custom Reports
**User Story:** As a user, I want to create custom reports so that I can analyze specific metrics.

**Acceptance Criteria:**
- GIVEN I create a custom report
- WHEN I select metrics and dimensions
- THEN a report is generated with my configuration

- GIVEN a report exists
- WHEN I schedule it
- THEN it's emailed to recipients at the configured time

**Technical Notes:**
- Report builder with drag-and-drop
- Scheduled reports (daily, weekly, monthly)
- Distribution lists for reports

---

### Epic 10: Mobile Application

#### 10.1 Mobile Notifications
**User Story:** As an on-call engineer, I want push notifications so that I'm alerted anywhere.

**Acceptance Criteria:**
- GIVEN I have the mobile app installed
- WHEN an incident is assigned to me
- THEN I receive a push notification

- GIVEN I receive a notification
- WHEN I tap it
- THEN I see the incident details

**Technical Notes:**
- iOS and Android apps (React Native)
- Push notifications via APNs/FCM
- Critical alerts that bypass Do Not Disturb
- Notification preferences in app

#### 10.2 Mobile Incident Actions
**User Story:** As a responder on mobile, I want to take actions so that I can respond without a laptop.

**Acceptance Criteria:**
- GIVEN I view an incident on mobile
- WHEN I tap "Acknowledge" or "Resolve"
- THEN the incident state is updated

- GIVEN I need to add context
- WHEN I add a note
- THEN it appears in the incident timeline

**Technical Notes:**
- Full incident lifecycle management
- Voice-to-text for notes
- Quick actions from notification

#### 10.3 Mobile Schedule View
**User Story:** As a user, I want to see my schedule on mobile so that I know when I'm on-call.

**Acceptance Criteria:**
- GIVEN I open the mobile app
- WHEN I view my schedule
- THEN I see my upcoming on-call shifts

- GIVEN I need coverage
- WHEN I create an override request
- THEN it notifies potential substitutes

**Technical Notes:**
- Calendar view of on-call shifts
- Override creation and approval
- Push notification for override requests

---

### Epic 11: API & Developer Tools

#### 11.1 REST API
**User Story:** As a developer, I want a REST API so that I can automate workflows.

**Acceptance Criteria:**
- GIVEN I have an API key
- WHEN I make authenticated requests
- THEN I can CRUD all resources I have permission to access

- GIVEN I need API documentation
- WHEN I visit /api/docs
- THEN I see OpenAPI/Swagger documentation

**Technical Notes:**
- RESTful API design
- API versioning (v1, v2, etc.)
- Rate limiting per API key
- OpenAPI 3.0 specification

#### 11.2 CLI Tool
**User Story:** As an engineer, I want a CLI tool so that I can manage incidents from the terminal.

**Acceptance Criteria:**
- GIVEN I install the CLI
- WHEN I authenticate
- THEN I can run commands like `alerthq incidents list`

- GIVEN I'm on-call
- WHEN I run `alerthq ack <incident-id>`
- THEN the incident is acknowledged

**Technical Notes:**
- Languages: Go or Rust for cross-platform binary
- Commands: incidents, schedules, services, oncall
- Config file for authentication
- Shell completions (bash, zsh, fish)

#### 11.3 Terraform Provider
**User Story:** As a platform engineer, I want infrastructure as code so that I can version control AlertHQ configuration.

**Acceptance Criteria:**
- GIVEN I write Terraform config
- WHEN I apply it
- THEN AlertHQ resources are created/updated

- GIVEN resources exist in AlertHQ
- WHEN I run terraform import
- THEN they're added to state

**Technical Notes:**
- Terraform provider in Go
- Resources: services, escalation_policies, schedules, teams
- Data sources for read-only access
- Published to Terraform Registry

---

### Epic 12: Administration

#### 12.1 Audit Logging
**User Story:** As an admin, I want audit logs so that I can track who did what for compliance.

**Acceptance Criteria:**
- GIVEN any action is taken
- WHEN it modifies data
- THEN an audit log entry is created

- GIVEN I view audit logs
- WHEN I filter by user/resource/time
- THEN I see relevant entries

**Technical Notes:**
- Log fields: timestamp, user_id, action, resource_type, resource_id, details
- Retention: configurable (default 90 days)
- Export for compliance

#### 12.2 Single Sign-On (SSO)
**User Story:** As an enterprise admin, I want SSO so that users authenticate via our identity provider.

**Acceptance Criteria:**
- GIVEN SSO is configured
- WHEN a user logs in
- THEN they authenticate via the IdP

- GIVEN a user is deprovisioned in the IdP
- WHEN SCIM sync runs
- THEN their AlertHQ account is deactivated

**Technical Notes:**
- SAML 2.0 support
- OIDC support
- SCIM 2.0 for user provisioning
- JIT (Just-in-Time) provisioning

#### 12.3 Role-Based Access Control
**User Story:** As an admin, I want granular permissions so that users only access what they need.

**Acceptance Criteria:**
- GIVEN custom roles are defined
- WHEN assigned to users
- THEN they have exactly those permissions

- GIVEN a user lacks permission
- WHEN they attempt an action
- THEN they receive a 403 error

**Technical Notes:**
- Default roles: Owner, Admin, Manager, Responder, Viewer
- Custom roles with permission sets
- Team-scoped vs. org-scoped permissions

---

## 4. Technical Architecture

### 4.1 System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         Clients                                   │
├─────────────┬─────────────┬─────────────┬──────────────────────────┤
│  Web App    │ Mobile App  │    CLI      │    Terraform Provider   │
└──────┬──────┴──────┬──────┴──────┬──────┴──────────────┬──────────┘
       │             │             │                      │
       └─────────────┴─────────────┴──────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   API Gateway     │
                    │   (Rate Limit)    │
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
       ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
       │  Auth API   │ │  Core API   │ │ Webhooks API│
       │  (Cognito)  │ │  (Express)  │ │  (Express)  │
       └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
              │               │               │
              └───────────────┼───────────────┘
                              │
                    ┌─────────▼─────────┐
                    │    PostgreSQL     │
                    │    (Primary DB)   │
                    └─────────┬─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼───────┐   ┌─────────▼─────────┐   ┌───────▼───────┐
│  Redis Cache  │   │  Background Jobs  │   │  S3 Storage   │
│  (Sessions)   │   │  (Bull/BullMQ)    │   │  (Runbooks)   │
└───────────────┘   └───────────────────┘   └───────────────┘
```

### 4.2 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend | React 19, TypeScript, TailwindCSS, Zustand | Modern, performant, familiar |
| Backend API | Node.js, Express, TypeScript, TypeORM | Matches frontend, fast development |
| Database | PostgreSQL 15+ | Reliable, full-featured RDBMS |
| Cache | Redis | Session storage, job queues |
| Background Jobs | BullMQ | Redis-backed job processing |
| Authentication | AWS Cognito | Managed auth with SSO support |
| File Storage | AWS S3 | Runbook attachments, exports |
| Push Notifications | FCM/APNs | Mobile alerts |
| Real-time | Server-Sent Events | Live incident updates |
| Infrastructure | Terraform, AWS (ECS Fargate) | Reproducible, scalable |

### 4.3 Data Models

```
Organization
├── id, name, slug, settings, created_at
├── Users[] (via OrgMembership)
├── Teams[]
├── Services[]
├── EscalationPolicies[]
└── Schedules[]

User
├── id, email, name, phone, timezone
├── OrgMemberships[]
├── NotificationPreferences[]
└── ApiKeys[]

Team
├── id, name, description, org_id
├── Members[] (via TeamMembership)
├── Services[]
└── Schedules[]

Service
├── id, name, description, status
├── team_id, escalation_policy_id
├── IntegrationKeys[]
└── Incidents[]

EscalationPolicy
├── id, name, org_id, repeat_count
└── Steps[] (ordered)

EscalationStep
├── id, policy_id, order, delay_minutes
└── Targets[] (user_id or schedule_id)

Schedule
├── id, name, team_id, timezone
├── Layers[]
└── Overrides[]

ScheduleLayer
├── id, schedule_id, rotation_type
├── rotation_length, handoff_time
└── Members[] (ordered)

Incident
├── id, title, description, severity, status
├── service_id, dedup_key, source
├── acknowledged_at, resolved_at
├── Timeline[]
└── Responders[]

IncidentTimeline
├── id, incident_id, event_type
├── user_id, timestamp, data
└── (polymorphic event data)
```

### 4.4 Infrastructure Requirements

| Component | Specification | Scaling Strategy |
|-----------|---------------|------------------|
| API Servers | 2+ instances, 1 vCPU, 2GB RAM | Horizontal (ECS Service Auto Scaling) |
| Database | db.t3.medium (2 vCPU, 4GB) | Vertical initially, read replicas later |
| Redis | cache.t3.micro | Vertical |
| Background Workers | 2+ instances | Horizontal based on queue depth |

---

## 5. Non-Functional Requirements

### 5.1 Performance
- API response time: p95 < 200ms
- Alert processing: < 5 seconds from receipt to notification
- Dashboard load time: < 2 seconds
- Mobile app cold start: < 3 seconds

### 5.2 Reliability
- Availability target: 99.9% uptime
- Zero data loss for incidents
- Graceful degradation (alerts always delivered even if UI is down)
- Multi-AZ deployment

### 5.3 Security
- SOC 2 Type II compliance ready
- Data encryption at rest (AES-256) and in transit (TLS 1.3)
- API key rotation support
- IP allowlisting for API access
- MFA enforcement for admins

### 5.4 Scalability
- Support 1000+ services per organization
- Handle 10,000 alerts per minute per org
- 1M+ incidents stored per organization

---

## 6. Implementation Phases

### Phase 1: MVP (Weeks 1-8)
**Goal:** Basic incident management with manual creation and simple notifications

| Epic | Features | Priority |
|------|----------|----------|
| 1 | Auth, Org setup, Team mgmt | P0 |
| 2 | Service definition (basic) | P0 |
| 5 | Incident CRUD, lifecycle, timeline | P0 |
| 4 | Simple escalation (single step) | P0 |
| - | Email notifications | P0 |
| - | Basic dashboard | P0 |

**Deliverable:** Users can create services, manually create incidents, acknowledge/resolve them, and receive email notifications.

### Phase 2: On-Call (Weeks 9-14)
**Goal:** Full on-call scheduling and escalation

| Epic | Features | Priority |
|------|----------|----------|
| 3 | Full scheduling (rotations, overrides, calendar) | P0 |
| 4 | Multi-step escalation policies | P0 |
| 4 | Multi-channel notifications (SMS, push) | P0 |
| 9 | Basic analytics (MTTA, MTTR) | P1 |

**Deliverable:** Complete on-call management with automated escalation.

### Phase 3: Integrations (Weeks 15-20)
**Goal:** Connect to monitoring tools and collaboration platforms

| Epic | Features | Priority |
|------|----------|----------|
| 6 | Datadog, CloudWatch, Prometheus integrations | P0 |
| 7 | Slack integration | P0 |
| 6 | Email integration | P1 |
| 8 | Runbooks (basic) | P1 |

**Deliverable:** Automated alert ingestion from monitoring tools, Slack collaboration.

### Phase 4: Mobile & Advanced (Weeks 21-28)
**Goal:** Mobile app and advanced features

| Epic | Features | Priority |
|------|----------|----------|
| 10 | Mobile app (iOS/Android) | P0 |
| 9 | Advanced analytics, fairness scoring | P1 |
| 11 | REST API, CLI | P1 |
| 12 | Audit logging, SSO | P1 |

**Deliverable:** Full-featured platform with mobile access.

### Phase 5: Enterprise (Weeks 29+)
**Goal:** Enterprise-ready features

| Epic | Features | Priority |
|------|----------|----------|
| 7 | Microsoft Teams integration | P1 |
| 11 | Terraform provider | P2 |
| 2 | Service dependencies | P2 |
| 8 | Automated runbook steps | P2 |
| 12 | Custom RBAC roles | P2 |

---

## 7. Jira Epic Breakdown

Below are the recommended Jira epics for AI worker execution. Each epic should be created in the target Jira project, then broken into stories/tasks.

| Epic Name | Description | Phase |
|-----------|-------------|-------|
| ALH-AUTH | User Authentication & Organization Setup | 1 |
| ALH-TEAMS | Team Management & Invitations | 1 |
| ALH-SERVICES | Service Catalog & Configuration | 1 |
| ALH-INCIDENTS | Incident Management Core | 1 |
| ALH-ESCALATE | Escalation Policies | 1-2 |
| ALH-SCHEDULE | On-Call Scheduling | 2 |
| ALH-NOTIFY | Multi-Channel Notifications | 2 |
| ALH-INT-MONITOR | Monitoring Tool Integrations | 3 |
| ALH-INT-COLLAB | Collaboration Integrations (Slack/Teams) | 3 |
| ALH-RUNBOOKS | Runbook Management | 3 |
| ALH-ANALYTICS | Analytics & Reporting | 2-4 |
| ALH-MOBILE | Mobile Application | 4 |
| ALH-API | REST API & Developer Tools | 4 |
| ALH-ADMIN | Administration & Compliance | 4-5 |

---

## 8. Open Questions

1. **Pricing model:** Per-user, per-incident, or hybrid?
2. **Data residency:** Single region or multi-region deployment?
3. **Phone call integration:** Build vs. buy (Twilio)?
4. **Mobile app framework:** React Native vs. native iOS/Android?
5. **AI features:** Incident classification, auto-runbook suggestion?

---

## 9. Appendix

### A. Glossary

| Term | Definition |
|------|------------|
| Incident | An event requiring response, typically triggered by an alert |
| Escalation | The process of notifying additional responders when an incident isn't acknowledged |
| On-Call | A designated time period when an engineer is responsible for responding to incidents |
| Runbook | Step-by-step instructions for resolving a known incident type |
| MTTA | Mean Time to Acknowledge - average time from incident creation to acknowledgment |
| MTTR | Mean Time to Resolve - average time from incident creation to resolution |

### B. Competitive Analysis

| Feature | PagerDuty | Opsgenie | AlertHQ (Target) |
|---------|-----------|----------|------------------|
| Pricing | $21-41/user/mo | $9-35/user/mo | TBD (competitive) |
| Setup complexity | Medium | Medium | Low |
| AI features | Limited | Limited | Planned |
| Self-hosted option | No | No | Planned |
| Open source | No | No | Possible |

### C. References

- PagerDuty API Documentation
- Opsgenie REST API
- ITIL Incident Management Best Practices
- Google SRE Book: Managing Incidents
