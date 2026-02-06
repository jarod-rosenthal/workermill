# OnCallShift Rebuild Requirements

> **"OnCallShift — Built by WorkerMill"**
>
> Complete rebuild of the OnCallShift incident management platform as the flagship showcase for WorkerMill's autonomous AI worker capabilities.

## Source of Truth

- **Current codebase**: `jarod-rosenthal/pagerduty-lite` (GitHub)
- **Target repo**: `jarod-rosenthal/oncallshift` (empty, GitHub)
- **Live product**: https://oncallshift.com

---

## Current System Inventory

### Tech Stack (As-Is)

| Layer | Technology | Details |
|-------|-----------|---------|
| **Backend API** | Express 4.18 + TypeScript 5.3 | 46 route files, REST API |
| **ORM** | TypeORM 0.3.17 | 78 model files, SQL migrations |
| **Database** | PostgreSQL 15.15 | 66 migrations, RDS on AWS |
| **Auth** | AWS Cognito | JWT tokens, SRP auth |
| **Frontend** | React 19 + Vite 7.2 + TailwindCSS 3.4 | 60 pages, Zustand + React Query |
| **Mobile** | React Native 0.81 + Expo 54 | 31 screens, Expo EAS builds |
| **Workers** | Node.js background processes | 7 workers (alert-processor, notification-worker, escalation-timer, snooze-expiry, report-scheduler, ai-recommendations, ai-worker-orchestrator) |
| **Infrastructure** | Terraform ~5.0 on AWS | ECS Fargate, RDS, CloudFront, SQS, SNS, Cognito, S3, ALB |
| **CI/CD** | GitHub Actions | 9 workflows (deploy, test, backend, frontend, mobile, mobile-ota, infra, test-api, test-e2e) |
| **Monitoring** | Sentry | Error tracking across backend/frontend/mobile |
| **AI** | Claude API (Anthropic) | Incident diagnosis, runbook automation, cloud investigation, recommendations |
| **Email** | ProtonMail (MX) | Custom domain email |
| **MCP** | @modelcontextprotocol/sdk | MCP server published to npm |
| **Terraform Provider** | Go | Custom oncallshift Terraform provider |

### Database Models (78 entities)

**Core Domain (must have for MVP):**
- Organization, User, Team, TeamMembership, TeamMemberRole
- Service, ServiceDependency, ServiceIntegration
- Incident, IncidentEvent, IncidentResponder, IncidentSubscriber, IncidentStatusUpdate
- Schedule, ScheduleMember, ScheduleLayer, ScheduleLayerMember, ScheduleOverride
- EscalationPolicy, EscalationStep, EscalationTarget
- Alert, AlertRoutingRule, AlertGroupingRule
- Notification, NotificationBundle, DeviceToken
- Runbook, RunbookExecution
- Integration, IntegrationEvent, IntegrationOAuthToken

**Extended Domain:**
- Heartbeat (service health monitoring)
- StatusPage, StatusPageService, StatusPageSubscriber, StatusPageUpdate
- Postmortem, PostmortemTemplate
- ConferenceBridge (war room bridges)
- IncidentWorkflow, WorkflowAction, WorkflowExecution
- IncidentReport, ReportExecution
- BusinessService (business-facing service catalog)
- PriorityLevel (custom priority definitions)
- Tag, EntityTag (tagging system)
- WebhookSubscription, WebhookRequest
- UserContactMethod, UserNotificationRule
- EventTransformRule, ChangeEvent
- MaintenanceWindow
- ShiftHandoffNote
- CloudCredential, CloudAccessLog
- ImportHistory, OnboardingSession
- IdempotencyKey, ObjectPermission
- OrganizationApiKey

**AI System:**
- AIConversation, AIRecommendation, AIProviderConfig
- AIWorkerTask, AIWorkerTaskRun, AIWorkerTaskLog
- AIWorkerInstance, AIWorkerApproval, AIWorkerReview
- AIWorkerConversation, AIWorkerLearningSession
- AIWorkerToolEvent, AIWorkerToolPattern

### API Routes (46 files)

| Route | Endpoints | Priority |
|-------|-----------|----------|
| auth | signup, login, refresh, verify | P0 |
| incidents | CRUD + acknowledge, resolve, reassign, escalate, snooze, merge, add responders | P0 |
| services | CRUD + integrations, dependencies | P0 |
| schedules | CRUD + layers, overrides, on-call lookup | P0 |
| escalation-policies | CRUD + multi-step, multi-target | P0 |
| teams | CRUD + membership, roles | P0 |
| users | CRUD + invite, roles | P0 |
| alerts | Ingest webhooks (PagerDuty/Opsgenie compatible) | P0 |
| alerts-compat | PagerDuty & Opsgenie compatible endpoints | P0 |
| notifications | Delivery tracking, preferences | P0 |
| devices | Push notification token registration | P0 |
| integrations | Slack, Teams, Jira, Datadog, CloudWatch, etc. | P1 |
| runbooks | CRUD + manual execution | P1 |
| runbook-automation | AI-powered automated execution | P2 |
| analytics | Overview, team, user, SLA, top responders | P1 |
| status-pages | Public/private status pages | P1 |
| postmortems | CRUD + templates | P1 |
| heartbeats | Service health monitoring | P1 |
| workflows | Incident automation workflows | P1 |
| reports | Scheduled reporting | P2 |
| conference-bridges | War room bridge management | P2 |
| routing-rules | Alert routing configuration | P1 |
| priorities | Custom priority levels | P1 |
| business-services | Business service catalog | P2 |
| tags | Entity tagging system | P2 |
| webhooks | Jira/GitHub webhook receivers | P1 |
| webhook-subscriptions | Outbound webhook subscriptions | P2 |
| import | PagerDuty/Opsgenie migration import | P1 |
| export | Data export | P2 |
| semantic-import | AI-powered screenshot/text import | P2 |
| cloud-credentials | AWS/GCP/Azure credential management | P2 |
| ai-diagnosis | Claude-powered incident analysis | P2 |
| ai-assistant | Unified AI chat with tool_use | P2 |
| ai-configuration | NL configuration | P2 |
| ai-recommendations | Proactive recommendations | P2 |
| api-keys | Org API key management | P1 |
| onboarding | AI-powered setup wizard | P2 |
| ai-workers | AI worker management | P3 (WM-specific) |
| ai-worker-tasks | AI worker task management | P3 |
| ai-worker-approvals | AI worker approval workflows | P3 |
| ai-worker-webhooks | AI worker webhook receivers | P3 |
| super-admin | Super admin control center | P3 |
| ai-config | AI provider configuration | P3 |
| setup | Initial setup/seed | P0 |
| demo | Demo dashboard | P1 |
| actions | Bulk incident actions | P1 |

### Frontend Pages (60 files)

**Core pages:** Dashboard, Incidents, IncidentDetail, Services, Schedules, ScheduleDetail, Teams, TeamDetail, EscalationPolicies, Login, Register, Profile, Account, SetupWizard

**Feature pages:** Analytics, Integrations, AdminRunbooks, AdminServices, AdminUsers, Postmortems, StatusPages, StatusPageAdmin, PublicStatusPage, StatusDashboard, Workflows, Reports, RoutingRules, Tags, BusinessServices, CloudCredentials, NotificationPreferences, ServiceConfiguration, ServiceDependencies, Availability, ImportWizard, ApiKeys, AISettings, AIWorkers, SuperAdminControlCenter

**Marketing pages:** Landing, Pricing, About, Contact, Blog, Security, Privacy, Terms, WhyOnCallShift, ForSmallTeams, PagerDutyAlternative, OpsgenieAlternative, MigrateFromPagerDuty, MigrateFromOpsgenie, Demo, ProductIncidentManagement, ProductOnCallScheduling, ProductEscalationPolicies, ProductIntegrations, ProductMobileApp, ProductAIDiagnosis

### Mobile Screens (31 files)

DashboardScreen, AlertListScreen, AlertDetailScreen, OnCallScreen, OnCallCalendarScreen, AnalyticsScreen, TeamsScreen, TeamScreen, TeamDetailScreen, ScheduleScreen, ScheduleLayersScreen, ManageSchedulesScreen, ManageServicesScreen, ManageUsersScreen, RunbooksScreen, RunbookEditorScreen, IntegrationsScreen, IntegrationDetailScreen, RoutingRulesScreen, SettingsScreen, AvailabilityScreen, InboxScreen, ContactMethodsScreen, ServiceSettingsScreen, AIChatScreen, LoginScreen, ForgotPasswordScreen, OnboardingScreen, SetupWizardScreen, MoreScreen

### Background Workers (7)

1. **alert-processor** — Consumes alerts from SQS, creates incidents, triggers escalation
2. **notification-worker** — Delivers notifications via Email (SES), Push (Expo/SNS), SMS (SNS)
3. **escalation-timer** — Checks every 30s, advances escalation steps, handles heartbeat timeouts
4. **snooze-expiry** — Processes expired incident snoozes
5. **report-scheduler** — Generates scheduled reports
6. **ai-recommendations-worker** — Proactive AI recommendation generation
7. **ai-worker-orchestrator** — Manages AI worker task lifecycle (WM-specific, may exclude)

### Infrastructure (Terraform)

**Modules:** networking, database, ecs-service, ai-workers

**Resources:**
- VPC with public/private subnets, NAT gateway, VPC endpoints
- ALB with HTTP→HTTPS redirect, TLS 1.3
- RDS PostgreSQL 15.15 with RDS Proxy, Performance Insights
- ECS Fargate cluster with Spot support, auto-scaling
- 6 ECS services (API, notification-worker, alert-processor, escalation-timer, aiw-orchestrator, snooze-expiry)
- CloudFront distribution (S3 origin for SPA + ALB origin for API)
- SQS queues (alerts, notifications, ai-worker) + DLQs
- SNS platform applications (FCM, APNS) + push events topic
- Cognito User Pool + mobile client
- S3 buckets (web static, uploads)
- ACM certificate (wildcard)
- Route53 (A records, CNAME, MX for ProtonMail, DKIM, DMARC, SPF)
- Secrets Manager (8+ secrets)
- GitHub Actions OIDC + IAM role (5 scoped policies)
- CloudFront Function (SPA routing)

### CI/CD Workflows (9)

1. `deploy.yml` — Orchestrator (manual + PR merge trigger)
2. `_backend.yml` — Docker → ECR → ECS with migrations
3. `_frontend.yml` — Build → S3 → CloudFront invalidation
4. `_mobile.yml` — Expo EAS build
5. `_mobile-ota.yml` — Expo EAS OTA update
6. `_infra.yml` — Terraform plan/apply with approval
7. `_test-api.yml` — Backend tests
8. `_test-e2e.yml` — Playwright E2E tests
9. `test.yml` — Test orchestrator

---

## Rebuild Strategy

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Monorepo vs multi-repo** | Monorepo (like current) | Workers can work across stack in one repo |
| **Backend framework** | Express + TypeScript (same) | Proven stack, no unnecessary risk |
| **ORM** | TypeORM (same) | 78 models already defined, pattern established |
| **Database** | PostgreSQL 15+ (same) | No reason to change |
| **Frontend** | React 19 + Vite + TailwindCSS (same) | Current stack is modern |
| **Mobile** | React Native + Expo (same) | Same as current |
| **Auth** | AWS Cognito (real, from day 1) | No throwaway local auth — same code path in dev and prod |
| **Cloud services** | Real AWS services from local dev | Connect to real Cognito, SQS, SES, SNS, S3 — no stubs, no adapters, no throwaway work |
| **Database** | Docker PostgreSQL (local), RDS (prod) | Only thing that differs between local and cloud |
| **Development environment** | Local processes + real AWS managed services | Sub-second code iteration; real service behavior; pennies in AWS cost |
| **Cloud deployment** | Terraform on AWS, phased | Phase 0: lightweight managed services. Phase 13: compute/networking infrastructure |
| **CI/CD** | GitHub Actions, deferred to Phase 13 | Write workflow files during dev, activate at deploy time |
| **AI Workers system** | EXCLUDE from rebuild | This is WorkerMill-specific, not OnCallShift |
| **MCP Server** | Include | Good showcase of MCP capability |
| **Terraform Provider** | Defer to later phase | Nice-to-have, not critical for showcase |

### What's New/Better in the Rebuild

1. **Clean schema** — Single migration instead of 66 incremental ones
2. **Modern patterns** — RFC 9457 Problem Details from day 1
3. **Full test suite** — Every phase includes tests (unit + integration + E2E)
4. **"Built by WorkerMill" branding** — Footer, about page, landing page
5. **Local-first development** — Local processes + Docker PostgreSQL + real AWS managed services from day 1
6. **No throwaway work** — No service adapters, no stubs. One code path from first commit to production.
7. **Better CI/CD** — Streamlined from the start, not bolted on (written during dev, activated at deploy)
8. **Documentation** — API docs (Swagger), architecture docs
9. **Seed data** — Rich demo data for immediate showcase value

### What to Exclude

- AI Worker system (ai-workers, ai-worker-tasks, ai-worker-approvals, ai-worker-webhooks, super-admin, ai-worker-orchestrator) — This is WorkerMill internals, not OnCallShift product
- Semantic import (AI screenshot import) — Novel but not core
- AI recommendations worker — Nice-to-have, defer
- ProtonMail DNS records — Infrastructure-specific, not code

---

## Development & Deployment Strategy

### Principle: No Throwaway Work

Every line of code written during development runs identically in production. No service adapters, no local stubs, no mock implementations that get replaced later. The only difference between local dev and production is where PostgreSQL runs.

### Local Dev Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Your Machine (WorkerMill Local Mode)                           │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐                  │
│  │ Frontend │  │ Backend  │  │ PostgreSQL   │                  │
│  │ Vite HMR │  │ tsx watch│  │ (Docker)     │                  │
│  │ :5173    │  │ :3000    │  │ :5433        │                  │
│  └──────────┘  └──────────┘  └──────────────┘                  │
│       ↕              ↕  ↕           ↕                           │
│  Instant         Instant │      Persistent                      │
│  reload          reload  │                                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │   AWS       │  (real managed services)
                    │             │
                    │  Cognito    │  ← Auth (JWT tokens)
                    │  SQS        │  ← Alert/notification queues
                    │  SES        │  ← Email delivery
                    │  SNS        │  ← Push notifications
                    │  S3         │  ← File uploads
                    └─────────────┘
                    Cost: ~$5/month at dev volumes
```

**Worker iteration loop (sub-second):**
```
Worker writes code
    ├── Backend: tsx watch → instant reload
    ├── Frontend: Vite HMR → instant reload
    ├── PostgreSQL: Docker container (persistent)
    ├── AWS services: real Cognito/SQS/SES/SNS/S3 (always connected)
    ├── npm run typecheck → seconds
    ├── npm run test → seconds
    └── Done. Zero deployment. Zero CI wait.
```

### Why Real AWS Services From Day 1

| Concern | Answer |
|---------|--------|
| **Cost** | Cognito free tier: 50K MAU. SQS free tier: 1M requests. SES: $0.10/1K emails. SNS free tier: 1M publishes. S3: pennies. Total dev cost: ~$5/month. |
| **Complexity** | One `terraform apply` in Phase 0 creates all managed services. No VPC, no compute — just the services themselves. Takes 5 minutes. |
| **Credentials** | Backend reads from `.env` file: `COGNITO_USER_POOL_ID`, `SQS_ALERTS_URL`, etc. Same env vars in production. |
| **Risk** | None of these services require networking infrastructure (VPC, NAT, ALB). They're standalone managed services accessible via public endpoints + IAM credentials. |

### What Differs Between Local and Production

| Component | Local Dev | Production |
|-----------|----------|------------|
| **PostgreSQL** | Docker container on `:5433` | RDS in private subnet |
| **Backend** | `tsx watch` process | ECS Fargate container |
| **Frontend** | Vite dev server on `:5173` | S3 + CloudFront |
| **Cognito** | Same | Same |
| **SQS** | Same | Same |
| **SES** | Same | Same |
| **SNS** | Same | Same |
| **S3** | Same | Same |
| **Workers** | Run as local Node.js processes | ECS Fargate tasks |

Only the **compute layer** changes. All application code, service calls, and business logic are identical.

### Phased Infrastructure

**Phase 0 (day 1):** Lightweight Terraform — just the managed services
```
terraform apply → creates:
  - Cognito User Pool + Client
  - SQS queues (alerts, notifications) + DLQs
  - S3 buckets (uploads)
  - Secrets Manager (for credential encryption key)

  Does NOT create: VPC, RDS, ECS, ALB, CloudFront, Route53
  Cost: ~$5/month
```

**Phase 13 (go live):** Full Terraform — add compute/networking
```
terraform apply → adds:
  - VPC with public/private subnets, NAT
  - RDS PostgreSQL (migrates from Docker)
  - ECS Fargate cluster + services
  - ALB with HTTPS
  - CloudFront distribution
  - Route53 DNS records
  - GitHub Actions OIDC
```

### Local Dev Environment Setup

```bash
# docker-compose.dev.yml — just PostgreSQL
services:
  postgres:
    image: postgres:15
    ports:
      - "5433:5432"
    environment:
      POSTGRES_DB: oncallshift
      POSTGRES_USER: oncallshift
      POSTGRES_PASSWORD: localdev
    volumes:
      - oncallshift_data:/var/lib/postgresql/data

# .env (same env vars as production, different DATABASE_URL)
DATABASE_URL=postgresql://oncallshift:localdev@localhost:5433/oncallshift
COGNITO_USER_POOL_ID=us-east-1_xxxxx
COGNITO_CLIENT_ID=xxxxx
ALERTS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/593971626975/oncallshift-dev-alerts
NOTIFICATIONS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/593971626975/oncallshift-dev-notifications
AWS_REGION=us-east-1

# bin/dev — start everything
#!/bin/bash
docker compose -f docker-compose.dev.yml up -d
cd backend && npm run migrate && npm run seed &
cd backend && npm run dev &     # tsx watch on :3000
cd frontend && npm run dev &    # vite on :5173
wait
```

### CI/CD Strategy

GitHub Actions workflows are **written during development** (as code in `.github/workflows/`) but **not used until Phase 13**. This means:

- Workers write and commit workflow YAML files during Phase 0
- Workflows aren't triggered because there's no compute infrastructure to deploy to
- When ready to go live, the workflows are already there — just add secrets and run

---

## Phased Rebuild Plan

### Phase 0: Repository Bootstrap & Local Dev Environment
**Estimated stories: 3 | Personas: devops_engineer**

Sets up the empty repo with project scaffolding, local dev environment, and Terraform for AWS managed services.

#### Phase 0.1 — Repository Scaffolding & Local Dev
```
Create monorepo structure:
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   ├── swagger.ts
│   │   │   ├── app.ts
│   │   │   └── server.ts
│   │   ├── shared/
│   │   │   ├── db/
│   │   │   │   ├── connection.ts
│   │   │   │   ├── migrate.ts
│   │   │   │   └── migrations/
│   │   │   ├── models/
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── rate-limiter.ts
│   │   │   │   ├── idempotency.ts
│   │   │   │   ├── request-id.ts
│   │   │   │   └── etag.ts
│   │   │   ├── services/
│   │   │   │   ├── queue.ts       (SQS)
│   │   │   │   ├── email.ts       (SES)
│   │   │   │   ├── push.ts        (SNS)
│   │   │   │   ├── storage.ts     (S3)
│   │   │   │   └── auth.ts        (Cognito)
│   │   │   ├── utils/
│   │   │   │   ├── logger.ts (winston)
│   │   │   │   └── problem-details.ts (RFC 9457)
│   │   │   └── config/
│   │   │       └── sentry.ts
│   │   └── workers/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── stores/ (Zustand)
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── App.tsx
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
├── mobile/
│   ├── src/
│   │   ├── screens/
│   │   ├── components/
│   │   ├── services/
│   │   ├── navigation/
│   │   └── config/
│   ├── app.json
│   ├── eas.json
│   └── package.json
├── infrastructure/
│   └── terraform/
│       ├── environments/dev/    ← Applied in Phase 0 (managed services only)
│       ├── environments/prod/   ← Applied in Phase 13 (full stack)
│       └── modules/ (networking, database, ecs-service)
├── e2e/
│   ├── tests/
│   ├── page-objects/
│   └── playwright.config.ts
├── packages/
│   └── oncallshift-mcp/
├── .github/workflows/           ← Written during dev, activated in Phase 13
├── docker-compose.dev.yml       ← LOCAL DEV: PostgreSQL only
├── bin/dev                      ← LOCAL DEV: start everything
├── deploy.sh
├── CLAUDE.md
└── README.md
```

**Acceptance criteria:**
- Repository has full directory structure
- All package.json files with correct dependencies
- TypeScript configs for backend, frontend, mobile
- Dockerfile for backend (multi-stage build)
- `docker-compose.dev.yml` starts PostgreSQL on port 5433
- `bin/dev` starts PostgreSQL + backend + frontend
- AWS managed services created via Terraform (Cognito, SQS, S3)
- `.env` configured with real AWS service URLs/IDs
- Backend connects to real Cognito, SQS, S3 from local dev
- `.env.example` with all required variables documented
- `.gitignore`, `.eslintrc`, `.prettierrc`
- CLAUDE.md with local dev instructions
- `npm install` succeeds in all three directories
- `npm run dev` starts the backend against local PostgreSQL
- `npm run dev` starts the frontend with Vite

#### Phase 0.2 — Seed Data & Dev Tooling
- Database seed script (`npm run seed`) with realistic demo data:
  - 1 organization ("Contoso Engineering")
  - 5 users with different roles (admin, members)
  - 3 teams (Platform, Backend, Frontend)
  - 5 services (API Gateway, Auth Service, Payment Service, Database, CDN)
  - 3 schedules with layers and rotations
  - 3 escalation policies (P1 Critical, P2 High, P3 Standard)
  - 10 sample incidents across all states (triggered, acknowledged, resolved)
  - Timeline events for each incident
- Health check endpoint (`GET /health`)
- Version endpoint (`GET /version`)

**Acceptance criteria:**
- `npm run seed` populates database with demo data
- `GET /health` returns 200
- Application runs end-to-end locally: frontend → backend → PostgreSQL

---

### Phase 1: Core Backend — Auth, Org, Users, Teams
**Estimated stories: 8 | Personas: backend_developer**

The foundation. Every subsequent phase depends on this.

#### Phase 1.1 — Database Schema (Core)
Create consolidated migration with core tables:
- `organizations` (id, name, status, plan, settings, timezone)
- `users` (id, org_id, email, cognito_sub, full_name, role [admin/member/super_admin], status, phone_number, settings)
- `teams` (id, org_id, name, description, slug)
- `team_memberships` (user_id, team_id, role [manager/responder/observer])
- `team_member_roles` (granular permissions)

Plus infrastructure tables:
- `idempotency_keys` (for request deduplication)
- `organization_api_keys` (org API key authentication)

**Acceptance criteria:**
- Migration runs successfully
- All tables created with proper indexes
- Foreign key constraints in place
- `updated_at` triggers working

#### Phase 1.2 — Auth Middleware & Routes
Implement authentication using real AWS Cognito from day 1:

- Cognito JWT verification (`aws-jwt-verify`)
- Auth routes: signup (Cognito + create user in DB), login (Cognito SRP), forgot password, verify email, refresh token
- Multi-method auth middleware (`authenticateRequest`): Cognito JWT, org API key (`org_*`), service API key (`svc_*`)
- Role-based authorization (admin, member, super_admin)
- Request ID middleware (tracing)
- Rate limiting (tiered: base, expensive, bulk)
- ETag/conditional request support

**Acceptance criteria:**
- Users can sign up, log in, refresh tokens via real Cognito
- Org API keys authenticate correctly
- Rate limiting enforced
- Tests for all auth flows
- Same auth code works locally and in production (same Cognito pool)

#### Phase 1.3 — Organization & User Management
Routes:
- `GET/PUT /api/v1/users` (list, update profile)
- `POST /api/v1/users/invite` (invite by email)
- `PUT /api/v1/users/:id/role` (change role)
- `GET /api/v1/users/me` (current user)
- Organization settings CRUD

**Acceptance criteria:**
- CRUD operations for users
- Invite flow works (sends real email via SES)
- Role changes persist
- Multi-tenant isolation (org_id scoping)

#### Phase 1.4 — Teams
Routes:
- `CRUD /api/v1/teams`
- `POST/DELETE /api/v1/teams/:id/members`
- `PUT /api/v1/teams/:id/members/:userId/role`

**Acceptance criteria:**
- Teams CRUD with org scoping
- Member management with roles (manager, responder, observer)
- Team detail includes member list

---

### Phase 2: Core Backend — Services, Schedules, Escalation
**Estimated stories: 10 | Personas: backend_developer**

The heart of incident management — service catalog, on-call scheduling, and escalation.

#### Phase 2.1 — Services
Models: `Service`, `ServiceDependency`, `ServiceIntegration`

Routes:
- `CRUD /api/v1/services`
- `GET /api/v1/services/:id/dependencies`
- `PUT /api/v1/services/:id/status` (active/inactive/maintenance)
- Service API key generation for alert ingestion
- Email integration address generation

**Acceptance criteria:**
- Services CRUD with API key auto-generation
- Service status transitions
- Dependency graph (service A depends on B)
- Service linked to schedule and escalation policy

#### Phase 2.2 — Schedules & On-Call
Models: `Schedule`, `ScheduleMember`, `ScheduleLayer`, `ScheduleLayerMember`, `ScheduleOverride`

Routes:
- `CRUD /api/v1/schedules`
- `GET /api/v1/schedules/:id/oncall` (who's on call now?)
- `POST /api/v1/schedules/:id/overrides` (temporary override)
- Schedule layers with rotation (daily, weekly, custom)
- Timezone-aware scheduling

**Acceptance criteria:**
- Multiple rotation types (daily, weekly, custom)
- Layer-based scheduling (primary, secondary, etc.)
- Override support with time bounds
- Current on-call resolution (considers layers, overrides, rotations)
- Timezone handling correct

#### Phase 2.3 — Escalation Policies
Models: `EscalationPolicy`, `EscalationStep`, `EscalationTarget`

Routes:
- `CRUD /api/v1/escalation-policies`
- Multi-step policies with multiple targets per step
- Target types: user, schedule, team
- Configurable timeout per step

**Acceptance criteria:**
- Multi-step escalation with configurable delays
- Multiple targets per step (user + schedule + team)
- Policy linked to services
- Auto-escalation on timeout

---

### Phase 3: Core Backend — Incidents & Alerts
**Estimated stories: 12 | Personas: backend_developer**

The incident lifecycle — alert ingestion, incident creation, actions, and notifications.

#### Phase 3.1 — Alert Ingestion
Models: `Alert`, `AlertRoutingRule`, `AlertGroupingRule`

Routes:
- `POST /api/v1/alerts/webhook` (service API key auth)
- PagerDuty Events API v2 compatible format
- OpsGenie compatible format (`/alerts-compat`)
- Alert deduplication (dedup_key)
- Alert grouping (time-based, content-based)
- Alert routing rules (route to service based on conditions)

Workers:
- **alert-processor** — Polls SQS queue, creates/updates incidents
  - Same SQS queue used locally and in production
  - Worker runs as local Node.js process in dev, ECS task in production

**Acceptance criteria:**
- Alerts ingested via webhook, published to real SQS queue
- Dedup key prevents duplicate incidents
- Alert grouping merges related alerts
- alert-processor worker consumes from SQS and creates incidents
- PagerDuty and OpsGenie payload formats accepted
- Full flow testable locally: POST alert → SQS → worker → incident created → visible in DB

#### Phase 3.2 — Incident CRUD & Actions
Models: `Incident`, `IncidentEvent`, `IncidentResponder`, `IncidentSubscriber`, `IncidentStatusUpdate`

Routes:
- `CRUD /api/v1/incidents`
- `POST /api/v1/incidents/:id/acknowledge`
- `POST /api/v1/incidents/:id/resolve`
- `POST /api/v1/incidents/:id/escalate`
- `POST /api/v1/incidents/:id/reassign`
- `POST /api/v1/incidents/:id/snooze`
- `POST /api/v1/incidents/:id/merge`
- `POST /api/v1/incidents/:id/responders` (add responders)
- `POST /api/v1/incidents/:id/notes` (add timeline notes)
- `POST /api/v1/incidents/:id/status-updates`
- `POST /api/v1/incidents/:id/subscribe`
- Incident timeline (all events ordered by time)
- Incident number auto-increment per org

**Acceptance criteria:**
- Full incident lifecycle (triggered → acknowledged → resolved)
- All actions create timeline events
- Responder management
- Subscriber notifications on status changes
- Incident merge (combine duplicates)
- Snooze with auto-wake

#### Phase 3.3 — Notification System
Models: `Notification`, `NotificationBundle`, `DeviceToken`, `UserContactMethod`, `UserNotificationRule`

Workers:
- **notification-worker** — Delivers notifications via real AWS services
  - Email: SES (same in local and production)
  - Push: Expo/SNS (same in local and production)
  - SMS: SNS (same in local and production)

Routes:
- `CRUD /api/v1/devices` (push token registration)
- `GET /api/v1/notifications` (delivery history)
- `PUT /api/v1/users/:id/notification-rules`
- `PUT /api/v1/users/:id/contact-methods`

**Acceptance criteria:**
- Notification records created in DB with correct delivery status tracking
- Email sends via real SES
- Push/SMS sends via real SNS
- Notification bundling (don't spam)
- User contact methods (email, phone, push)
- Custom notification rules per user
- Delivery status tracking (pending, sent, delivered, failed)
- Full flow testable locally: incident → notification record → SES/SNS delivery

#### Phase 3.4 — Escalation Timer Worker

Worker:
- **escalation-timer** — Runs every 30s, checks for unacknowledged incidents past timeout, advances to next escalation step, triggers notifications

**Acceptance criteria:**
- Unacknowledged incidents auto-escalate after step timeout
- All escalation steps execute in order
- Final step loops or resolves based on policy
- Heartbeat monitoring (service health checks)

---

### Phase 4: Frontend — Core UI
**Estimated stories: 15 | Personas: frontend_developer**

Build the web dashboard for all Phase 1-3 backend features.

#### Phase 4.1 — App Shell & Auth
- Login, Register, Forgot Password pages
- Protected route wrapper
- Sidebar navigation layout
- Auth store (Zustand)
- API client (Axios with interceptors)
- Theme setup (TailwindCSS)
- Responsive layout

#### Phase 4.2 — Dashboard
- Incident overview (triggered/acknowledged/resolved counts)
- Recent incidents list
- On-call status (who's on call now)
- Service health summary

#### Phase 4.3 — Incidents UI
- Incident list with filters (status, severity, service, date range)
- Incident detail page with:
  - Timeline (all events chronologically)
  - Action buttons (acknowledge, resolve, escalate, reassign, snooze)
  - Responder management
  - Notes/comments
  - Status updates
- Create incident form
- Bulk actions (acknowledge all, resolve selected)

#### Phase 4.4 — Services, Schedules, Teams UI
- Services list + detail + configuration
- Service dependency graph (visual)
- Schedules list + detail with calendar view
- Schedule layer editor
- Override management
- Current on-call display
- Teams list + detail + member management
- Escalation policy editor (drag-and-drop steps)

#### Phase 4.5 — Settings & User Management
- Profile page (name, avatar, contact methods)
- Account settings (password, 2FA)
- Notification preferences
- Admin: User management (invite, roles)
- Admin: Service management
- Setup wizard (first-time org setup)

**Acceptance criteria (all Phase 4):**
- All pages render and are functional
- Forms validate with Zod + React Hook Form
- Real-time data via React Query
- Responsive (desktop + tablet)
- TypeScript compiles clean
- Consistent TailwindCSS styling

---

### Phase 5: Mobile App — Core
**Estimated stories: 10 | Personas: frontend_developer (mobile)**

React Native app mirroring core web functionality.

#### Phase 5.1 — App Shell & Auth
- Login, Forgot Password, Onboarding screens
- Bottom tab navigation (Dashboard, Alerts, On-Call, More)
- Auth service (Cognito via `amazon-cognito-identity-js`)
- API service (Axios)
- Push notification setup (Expo)
- Deep linking configuration

#### Phase 5.2 — Core Screens
- Dashboard (incident counts, on-call status, recent alerts)
- Alert list + detail (with actions: acknowledge, resolve, escalate)
- On-call screen (current schedule, calendar view)
- Teams screen + team detail
- Schedule screen + layers
- Settings (profile, notifications, contact methods)
- Inbox (notification history)

#### Phase 5.3 — Advanced Mobile
- Biometric auth (fingerprint/face)
- Background refresh (check for new incidents)
- Sound alerts for critical incidents
- Haptic feedback for actions
- Offline mode (queue actions when offline)

**Acceptance criteria:**
- App builds with `eas build`
- Push notifications work on physical device
- All core actions available (ack, resolve, escalate)
- TypeScript compiles clean

---

### Phase 6: Extended Features — Integrations
**Estimated stories: 8 | Personas: backend_developer, frontend_developer**

#### Phase 6.1 — Integration Framework
Models: `Integration`, `IntegrationEvent`, `IntegrationOAuthToken`

Routes:
- `CRUD /api/v1/integrations`
- Integration types: slack, teams, jira, servicenow, datadog, cloudwatch, prometheus, github, email
- Integration event logging
- OAuth token management

#### Phase 6.2 — Key Integrations
Priority integrations to implement:
1. **Slack** — Incident alerts, acknowledge from Slack
2. **Jira/ServiceNow** — Create tickets from incidents
3. **Datadog/CloudWatch/Prometheus** — Alert ingestion
4. **GitHub** — Deployment events
5. **Email** — Email integration (inbound/outbound)

#### Phase 6.3 — Integration UI
- Integrations settings page
- Integration setup wizard per type
- Integration status/health display
- Integration event log

---

### Phase 7: Extended Features — Runbooks, Status Pages, Postmortems
**Estimated stories: 10 | Personas: backend_developer, frontend_developer**

#### Phase 7.1 — Runbooks
Models: `Runbook`, `RunbookExecution`

Routes:
- `CRUD /api/v1/runbooks`
- `POST /api/v1/runbooks/:id/execute`
- Step types: action, decision, escalation, notification, manual
- Runbook linked to services

UI:
- Runbook editor (step builder)
- Runbook execution viewer
- Mobile: Runbook screen + editor

#### Phase 7.2 — Status Pages
Models: `StatusPage`, `StatusPageService`, `StatusPageSubscriber`, `StatusPageUpdate`

Routes:
- `CRUD /api/v1/status-pages`
- `GET /api/v1/status-pages/:slug` (public, no auth)
- Status updates timeline
- Subscriber notification on updates

UI:
- Status page admin (create/manage)
- Public status page (branded, shareable URL)
- Status dashboard (internal view)

#### Phase 7.3 — Postmortems
Models: `Postmortem`, `PostmortemTemplate`

Routes:
- `CRUD /api/v1/postmortems`
- Link to incident
- Template-based creation
- Timeline auto-populated from incident events

UI:
- Postmortem editor (markdown)
- Postmortem list + detail
- Template management

---

### Phase 8: Extended Features — Analytics, Reports, Workflows
**Estimated stories: 8 | Personas: backend_developer, frontend_developer**

#### Phase 8.1 — Analytics
Routes:
- `GET /api/v1/analytics/overview` (MTTA, MTTR, incident counts)
- `GET /api/v1/analytics/team/:teamId` (team performance)
- `GET /api/v1/analytics/user/:userId` (user performance)
- `GET /api/v1/analytics/sla` (SLA compliance)
- `GET /api/v1/analytics/top-responders`

UI:
- Analytics dashboard with charts
- Team analytics view
- SLA compliance view
- Mobile: Analytics screen

#### Phase 8.2 — Reports
Models: `IncidentReport`, `ReportExecution`

Workers: **report-scheduler**

Routes:
- `CRUD /api/v1/reports` (scheduled reports)
- Report types: daily digest, weekly summary, SLA report

#### Phase 8.3 — Workflows
Models: `IncidentWorkflow`, `WorkflowAction`, `WorkflowExecution`

Routes:
- `CRUD /api/v1/workflows`
- Trigger types: incident created, acknowledged, resolved, severity change
- Action types: notify, escalate, create ticket, run runbook

UI:
- Workflow builder
- Workflow execution log

---

### Phase 9: AI Features
**Estimated stories: 6 | Personas: backend_developer, frontend_developer**

#### Phase 9.1 — AI Incident Diagnosis
Routes:
- `POST /api/v1/incidents/:id/diagnose`
- Claude-powered root cause analysis
- Cloud investigation (query AWS/GCP/Azure when credentials configured)

UI:
- AI diagnosis panel in incident detail
- Cloud credential management page

#### Phase 9.2 — AI Assistant
Routes:
- `POST /api/v1/incidents/:id/assistant`
- Conversational AI with tool_use
- Can acknowledge, resolve, escalate, add notes via tools
- Context-aware (knows incident details, service config, recent changes)

UI:
- AI chat interface in incident detail
- Mobile: AI chat screen

#### Phase 9.3 — AI Runbook Automation
Routes:
- `POST /api/v1/runbooks/:id/automate`
- AI executes runbook steps in sandboxed environment
- Approval workflow for destructive actions

#### Phase 9.4 — AI Onboarding
Routes:
- `POST /api/v1/onboarding`
- Conversational setup wizard
- AI configures services, schedules, escalation policies from natural language

---

### Phase 10: Marketing & Polish
**Estimated stories: 8 | Personas: frontend_developer**

#### Phase 10.1 — Landing Page & Marketing
Pages:
- Landing page (hero, features, pricing, testimonials)
- Pricing page (tiers)
- About, Contact, Blog
- Product pages (Incident Management, On-Call Scheduling, Escalation Policies, Integrations, Mobile App, AI Diagnosis)
- Competitor pages (PagerDuty Alternative, Opsgenie Alternative)
- Migration pages (Migrate from PagerDuty, Migrate from Opsgenie)
- For Small Teams page
- Security, Privacy, Terms pages
- **"Built by WorkerMill" branding** throughout

#### Phase 10.2 — Data Import/Export
Routes:
- `POST /api/v1/import/pagerduty` (PagerDuty config import)
- `POST /api/v1/import/opsgenie` (Opsgenie config import)
- `POST /api/v1/export` (full data export)

UI:
- Import wizard (step-by-step)
- Export page

#### Phase 10.3 — Demo & Seed Data
- Rich seed data (org, users, teams, services, schedules, incidents, escalation policies)
- Demo dashboard page (`/demo`)
- Demo mode (read-only public access)

---

### Phase 11: MCP Server & API Docs
**Estimated stories: 4 | Personas: backend_developer**

#### Phase 11.1 — MCP Server
Package: `packages/oncallshift-mcp/`

Tools:
- Incident management (create, list, acknowledge, resolve, escalate, add note)
- Service management (create, list, update)
- Schedule management (create, list, who's on call)
- Team management (create, list, add/remove members)
- Escalation policy management
- Analytics queries
- Integration management

Prompts:
- Incident triage
- On-call handoff
- Runbook execution

#### Phase 11.2 — API Documentation
- Swagger/OpenAPI spec via `swagger-jsdoc`
- Interactive docs at `/api-docs`
- Comprehensive endpoint documentation

---

### Phase 12: Advanced Infrastructure & Hardening
**Estimated stories: 5 | Personas: devops_engineer, security_engineer**

#### Phase 12.1 — Production Hardening
- Snooze expiry worker
- Heartbeat monitoring
- Maintenance windows
- Conference bridges
- Webhook subscriptions (outbound)
- Business services catalog
- Priority levels
- Tags/entity tagging

#### Phase 12.2 — Security Hardening
- Helmet.js security headers (CSP, HSTS, X-Frame-Options)
- CORS strict origin list
- Webhook signature verification (HMAC)
- Input validation (express-validator)
- Request idempotency
- Audit logging

#### Phase 12.3 — E2E Tests
- Playwright test suite
- Auth flows
- Incident lifecycle
- Schedule management
- Integration setup

---

### Phase 13: Cloud Deployment — Infrastructure, CI/CD, Go Live
**Estimated stories: 8 | Personas: devops_engineer**

This phase takes the fully working local application and deploys it to AWS. All Terraform and workflow files are written during development (Phase 0+), but nothing is applied until this phase.

#### Phase 13.1 — Terraform Infrastructure (Compute & Networking)

Phase 0 already created the managed services (Cognito, SQS, S3, Secrets Manager). This phase adds the compute and networking layer for production.

```
Modules to create:
- networking (VPC, subnets, NAT, security groups, VPC endpoints)
- database (RDS PostgreSQL, Secrets Manager for DB URL, RDS Proxy)
- ecs-service (reusable ECS service module)

New resources (not yet created):
- VPC with 2 AZ public/private subnets
- ALB with HTTPS (ACM wildcard cert for oncallshift.com)
- ECS Fargate cluster with Spot support
- RDS PostgreSQL 15 (db.t4g.small) — replaces Docker PostgreSQL
- S3 bucket (web static) — uploads bucket already exists from Phase 0
- CloudFront distribution (S3 origin for SPA + ALB origin for API)
- SNS platform applications (FCM for Android push)
- Route53 records (A, CNAME, wildcard)
- GitHub Actions OIDC + IAM role (scoped policies)
- CloudFront Function (SPA routing)
- ECR repositories (backend, workers)

Already exists from Phase 0:
- Cognito User Pool + client
- SQS queues (alerts, notifications) + DLQs
- S3 bucket (uploads)
- Secrets Manager (credential encryption key)
```

**Acceptance criteria:**
- `terraform plan` succeeds with no errors
- `terraform apply` creates compute/networking resources alongside existing managed services
- All modules properly parameterized
- RDS accessible from ECS tasks
- OIDC role scoped to `jarod-rosenthal/oncallshift`

#### Phase 13.2 — CI/CD Pipelines
```
Workflows (files already written, now tested):
- deploy.yml (orchestrator — manual + PR merge trigger)
- _backend.yml (Docker → ECR → ECS + run migrations)
- _frontend.yml (Build → S3 → CloudFront invalidation)
- _infra.yml (Terraform plan → approval → apply)
- _test-api.yml (Jest backend tests)
- _test-e2e.yml (Playwright E2E)
```

**Acceptance criteria:**
- GitHub Actions secrets configured (AWS OIDC role ARN)
- Manual dispatch deploys backend + frontend successfully
- PR merge to main triggers automated deployment
- Terraform plan runs on infrastructure changes
- Smoke tests pass post-deploy (`/health`, `/version`)

#### Phase 13.3 — Go Live Checklist
1. DNS: oncallshift.com A record → CloudFront
2. ACM certificate validated (wildcard *.oncallshift.com)
3. Database migrated (`npm run migrate` via ECS exec)
4. Seed data loaded (or fresh start with setup wizard)
5. Cognito User Pool already in use (same pool as local dev)
6. DATABASE_URL updated to point to RDS (only env var that changes)
7. Sentry DSN configured for error tracking
8. Health checks passing on all ECS services
9. Frontend loads at oncallshift.com
10. API responds at oncallshift.com/api/v1/health

**Acceptance criteria:**
- oncallshift.com serves the frontend
- API is reachable and authenticated requests work
- At least one full flow works end-to-end: create incident → acknowledge → resolve
- "Built by WorkerMill" visible in footer

---

## Phase Execution Order

```
Phase 0 ─── Phase 1 ─── Phase 2 ─── Phase 3 ─── Phase 4 ─── Phase 5
 (local      (auth)     (svc/sched)  (incidents)  (web UI)    (mobile)
  dev env)
                                          │
                                          ├── Phase 6 (integrations)
                                          ├── Phase 7 (runbooks/status/postmortems)
                                          ├── Phase 8 (analytics/reports/workflows)
                                          ├── Phase 9 (AI features)
                                          ├── Phase 10 (marketing/polish)
                                          ├── Phase 11 (MCP/docs)
                                          ├── Phase 12 (hardening)
                                          │
                                          └── Phase 13 (cloud deployment) ← WHEN READY
```

**Phases 0-5 are sequential** (each depends on the previous). All run locally.
**Phases 6-12 can run in parallel** once Phase 3 (incidents) is complete. All run locally.
**Phase 13 (cloud deployment)** can happen anytime after Phase 4 — the product needs to be usable enough to be worth deploying. Realistically, after Phases 0-4 are complete you have a working web app that can go live.

**Terraform and CI/CD workflow files** are written throughout development (committed to the repo), but `terraform apply` and workflow execution only happen in Phase 13.

---

## Estimated Scale

| Metric | Count |
|--------|-------|
| Total phases | 14 (0-13) |
| Total sub-phases | ~38 |
| Total estimated stories | ~110 |
| Database tables | ~75 |
| API routes | ~46 |
| Frontend pages | ~60 |
| Mobile screens | ~31 |
| Background workers | 5 (excl. AI-worker-specific) |
| AWS managed services | 5 (Cognito, SQS, SES, SNS, S3) — created in Phase 0 |
| Terraform modules | 3 (networking, database, ecs-service) — created in Phase 13 |
| CI/CD workflows | 6 |

---

## Mapping to WorkerMill Tasks

Each sub-phase becomes a WorkerMill task (GitHub issue). Within each task, the planning agent decomposes it into stories for parallel expert execution.

**Task template:**
```
Title: [Phase X.Y] — Description
Labels: workermill, opus
Repository: jarod-rosenthal/oncallshift

Description:
<Full requirements from this document for the sub-phase>
<Includes: models, routes, UI pages, tests, acceptance criteria>

Definition of Done:
- [ ] TypeScript compiles clean (`npx tsc --noEmit` in backend + frontend)
- [ ] All acceptance criteria met
- [ ] Unit tests pass (`npm run test`)
- [ ] Application runs locally (`bin/dev` → backend + frontend + PostgreSQL)
- [ ] Feature testable end-to-end in local dev environment
```

**Note:** No CI/CD pipeline requirement during development. Workers validate locally. CI/CD validation happens in Phase 13.

**Example task sequence:**
1. `[Phase 0.1] Repository scaffolding, local dev environment, Terraform managed services`
2. `[Phase 0.2] Seed data & dev tooling`
3. `[Phase 1.1] Database schema — core tables`
4. `[Phase 1.2] Auth middleware & routes (Cognito)`
5. `[Phase 1.3] Organization & user management`
6. `[Phase 1.4] Teams`
7. `[Phase 2.1] Services`
8. `[Phase 2.2] Schedules & on-call`
9. `[Phase 2.3] Escalation policies`
10. `[Phase 3.1] Alert ingestion & processing`
11. `[Phase 3.2] Incident CRUD & actions`
12. `[Phase 3.3] Notification system`
13. `[Phase 3.4] Escalation timer worker`
14. `[Phase 4.1] Frontend app shell & auth`
15. ... and so on through Phase 12
16. `[Phase 13.1] Terraform infrastructure`
17. `[Phase 13.2] CI/CD pipelines`
18. `[Phase 13.3] Go live`

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Schema drift from original | Lost features | Phase 1.1 creates consolidated schema from all 66 migrations |
| Notification reliability | Silent failures | Notification records tracked in DB; delivery status always persisted; real SES/SNS from day 1 |
| Mobile build complexity | EAS build failures | Phase 5 deferred until web is stable; mobile is a nice-to-have |
| Scope creep from 78 models | Never-ending rebuild | Priority-based phasing; P3 items can be cut |
| First cloud deploy is complex | Many things to configure at once | Phase 13 only adds compute/networking — managed services already running from Phase 0 |
| AWS costs during development | Unexpected charges | Managed services only; all on free tier or pennies (~$5/month) |
| SES sandbox mode | Can only send to verified emails during dev | Verify team email addresses; request production access in Phase 13 |

---

## Success Criteria

### Local Development Complete (Phases 0-12)

1. **All P0 features work locally** — Auth, incidents, services, schedules, escalation, alerts, notifications
2. **Web dashboard is functional** — All core pages render and work against local backend
3. **Demo data seeded** — Rich, realistic demo data via `npm run seed`
4. **TypeScript clean** — `npx tsc --noEmit` passes in backend and frontend
5. **Tests pass** — Unit tests for core business logic
6. **"Built by WorkerMill" visible** — Branding in footer, about page, landing page
7. **MCP server works** — Functional with Claude Code against local API
8. **API docs available** — Swagger docs at `localhost:3000/api-docs`

### Cloud Deployment Complete (Phase 13)

9. **Infrastructure deployed** — Running on AWS via Terraform
10. **CI/CD operational** — Push-to-deploy working via GitHub Actions
11. **Production verified** — oncallshift.com serves frontend, API is authenticated, core flow works
12. **Mobile app builds** — Core screens available on Android (if Phase 5 complete)
13. **E2E tests pass** — Core flows covered against production
