# Product Requirements Document
## Remote Asset Monitoring Platform (RAMP)

**Version:** 2.0
**Date:** February 2026
**Reference:** Eaton Brightlayer / PredictPulse

---

## Project Configuration

| Setting | Value |
|---------|-------|
| **Repository** | `github.com/jarod-rosenthal/remote-monitoring` |
| **Cloud Provider** | Microsoft Azure (credentials provided separately) |
| **Project Type** | Greenfield - new repository, no existing code |
| **Jira Project** | `RAMP` |
| **Primary Language** | TypeScript (Node.js 20+) |
| **Device Simulator** | Provided separately by project owner |

---

## WorkerMill Execution Model

### Autonomous Validation System

This project uses **fully autonomous validation** with self-healing iteration. No human intervention required for normal operation.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AUTONOMOUS VALIDATION LOOP                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐               │
│   │   Worker     │────▶│   Commits    │────▶│   CI Runs    │               │
│   │   Executes   │     │   + PR       │     │   All Tests  │               │
│   └──────────────┘     └──────────────┘     └──────┬───────┘               │
│          ▲                                         │                        │
│          │                                         ▼                        │
│          │                              ┌────────────────────┐              │
│          │                              │   All Pass?        │              │
│          │                              └─────────┬──────────┘              │
│          │                                        │                         │
│          │                    ┌───────────────────┴───────────────────┐     │
│          │                    │                                       │     │
│          │                    ▼                                       ▼     │
│          │           ┌────────────────┐                    ┌────────────┐   │
│          │           │   YES: Auto-   │                    │  NO: Auto- │   │
│          │           │   merge PR     │                    │  create    │   │
│          │           │   Mark Done    │                    │  fix ticket│   │
│          │           │   Unblock deps │                    │  + context │   │
│          │           └────────────────┘                    └─────┬──────┘   │
│          │                                                       │          │
│          │                                                       ▼          │
│          │                                              ┌────────────────┐  │
│          │                                              │  Add label:    │  │
│          │                                              │  `workermill`  │  │
│          └──────────────────────────────────────────────┴────────────────┘  │
│                                                                              │
│   Loop continues autonomously until all stories complete                    │
│   Circuit breaker triggers human review after 3 failed fix attempts        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Validation Layers

Every story must pass ALL validation layers before completion:

| Layer | When | What | Failure Action |
|-------|------|------|----------------|
| **Static** | Every commit | TypeScript, ESLint, Prisma validate | Block PR |
| **Unit** | Every commit | Vitest with 80% coverage | Block PR |
| **Integration** | Every PR | API + real database | Block PR |
| **Contract** | Every PR | API matches OpenAPI spec | Block PR |
| **Phase Gate** | After phase | Critical flows work E2E | Block next phase |
| **E2E** | After deploy | Full user journeys | Create fix ticket |

### Story State Machine

```
┌─────────┐    Worker      ┌─────────────┐    CI Pass    ┌──────────┐
│ BLOCKED │───claims──────▶│ IN PROGRESS │──────────────▶│   DONE   │
└────┬────┘                └──────┬──────┘               └────┬─────┘
     │                            │                           │
     │                            │ CI Fail                   │
     │                            ▼                           │
     │                     ┌─────────────┐                    │
     │                     │ FIX TICKET  │◀───Fail (< 3x)─────┤
     │                     │  CREATED    │                    │
     │                     └──────┬──────┘                    │
     │                            │ Worker fixes              │
     │                            │ Push same branch          │
     │                            ▼                           │
     │                     ┌─────────────┐                    │
     │                     │  CI RERUN   │────Pass───────────▶│
     │                     └──────┬──────┘                    │
     │                            │ Fail (>= 3x)              │
     │                            ▼                           │
     │                     ┌─────────────┐                    │
     │                     │   NEEDS     │  ← Human review    │
     │                     │   HUMAN     │    required        │
     │                     └─────────────┘                    │
     │                                                        │
     └───────────Dependency Done──────────────────────────────┘
```

### Automatic Fix Ticket Creation

When CI fails, the system automatically creates a fix ticket with full context:

```typescript
// scripts/create-fix-ticket.ts
interface ValidationFixTicket {
  project: 'RAMP';
  issueType: 'Bug';
  summary: string;           // "Fix: RAMP-XX validation failures"
  description: string;       // Full test output, stack traces, instructions
  labels: ['workermill', 'validation-fix', 'auto-generated'];
  components: string[];      // Same as original story (determines persona)
  priority: 'High';
  linkedIssues: {
    blocks: string;          // Original story ID
  };
  customFields: {
    originalStory: string;   // "RAMP-XX"
    fixAttempt: number;      // 1, 2, or 3 (circuit breaker at 3)
    failedTests: string[];   // List of failing test names
    prUrl: string;           // Link to failed PR
  };
}
```

### Circuit Breaker

After 3 failed fix attempts:
- `workermill` label removed from story and fix tickets
- `needs-human-review` label added
- Story marked highest priority
- Slack notification sent to #ramp-alerts

### Dependency Auto-Unblocking

When a story is marked Done:
1. Find all stories blocked by this one
2. Check if ALL their blockers are now Done
3. If yes, add `workermill` label to trigger worker pickup

### Required Jira Configuration

**Custom Fields:**

| Field Name | Field ID | Type | Purpose |
|------------|----------|------|---------|
| Original Story | customfield_10040 | Text | Links fix ticket to source |
| Fix Attempt | customfield_10050 | Number | Circuit breaker counter |

**Components (for persona assignment):**

| Component | Persona |
|-----------|---------|
| backend | backend_developer |
| frontend | frontend_developer |
| infrastructure | devops_engineer |
| security | security_engineer |
| testing | qa_engineer |
| documentation | tech_writer |

### CI Secrets Required

| Secret | Purpose |
|--------|---------|
| `JIRA_HOST` | Jira instance URL |
| `JIRA_EMAIL` | Service account email |
| `JIRA_API_TOKEN` | API token for authentication |
| `SLACK_WEBHOOK_URL` | Circuit breaker notifications |
| `AZURE_CREDENTIALS` | Azure deployment |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Product Overview](#3-product-overview)
4. [Demo-Ready Milestone](#4-demo-ready-milestone)
5. [Jira Epic & Story Breakdown](#5-jira-epic--story-breakdown)
6. [Persona Assignments](#6-persona-assignments)
7. [JWT Multi-Tenant Token Structure](#7-jwt-multi-tenant-token-structure)
8. [Functional Requirements](#8-functional-requirements)
9. [Database Schema](#9-database-schema)
10. [API Specification](#10-api-specification)
11. [Frontend Architecture](#11-frontend-architecture)
12. [Azure Infrastructure](#12-azure-infrastructure)
13. [E2E Testing Strategy](#13-e2e-testing-strategy)
14. [Device Simulator Integration](#14-device-simulator-integration)
15. [Deployment Pipeline](#15-deployment-pipeline)

---

## 4. Demo-Ready Milestone

### What Can Be Built Without the Simulator

The device simulator is **not required** for the majority of the platform. This section defines a "Demo-Ready" milestone that delivers a fully functional system with seeded data.

### Simulator Dependency Analysis

| Component | Needs Simulator? | Demo Alternative |
|-----------|------------------|------------------|
| Azure Infrastructure | No | Full deployment |
| Authentication & RBAC | No | Complete system |
| Multi-tenancy | No | Full isolation |
| Asset CRUD | No | Full functionality |
| Site/Zone hierarchy | No | Full hierarchy |
| Alert Rules (config) | No | Create/edit rules |
| Alert Display & Actions | No | Seed test alerts |
| Command Queue (submit) | No | Queue commands |
| Command Audit Log | No | Full audit trail |
| Dashboard UI | No | Full UI with seeded data |
| Reporting | No | Generate from seeded data |
| User Management | No | Full user CRUD |
| API Key Management | No | Full key lifecycle |
| **Telemetry Ingestion** | **Yes** | Mock data injection |
| **Live WebSocket Updates** | **Yes** | Polling fallback |
| **Alert Auto-Triggering** | **Yes** | Manual/seeded alerts |
| **Command Execution** | **Yes** | Status stays "pending" |

### Demo-Ready Scope (~75% of platform)

```
DEMO-READY MILESTONE
├── ✅ Full Azure infrastructure deployed
├── ✅ Authentication with Azure AD B2C
├── ✅ Multi-tenant organization support
├── ✅ Complete RBAC permission system
├── ✅ Asset management (CRUD + hierarchy)
├── ✅ Site and zone management
├── ✅ Alert rule configuration
├── ✅ Alert center (view, acknowledge, resolve)
├── ✅ Command queue (submit, view history)
├── ✅ Full dashboard with seeded data
├── ✅ Reporting with PDF/Excel export
├── ✅ Settings and admin pages
├── ✅ 70%+ E2E test coverage
│
├── 🔶 Telemetry display (mock data)
├── 🔶 Real-time updates (polling, not WebSocket)
│
├── ❌ Live device telemetry (needs simulator)
├── ❌ Automatic alert triggering (needs simulator)
└── ❌ Command execution response (needs simulator)
```

### Mock Data Strategy

To demonstrate the platform without real devices:

#### 1. Database Seeding Script

```typescript
// prisma/seed.ts - Creates demo data for all entities

const DEMO_ORG = {
  name: 'Acme Corporation',
  slug: 'acme',
  plan: 'PROFESSIONAL',
};

const DEMO_SITES = [
  { name: 'Headquarters', city: 'New York', state: 'NY' },
  { name: 'Data Center East', city: 'Ashburn', state: 'VA' },
  { name: 'Data Center West', city: 'San Jose', state: 'CA' },
];

const DEMO_ASSETS = [
  { name: 'UPS-DC-001', type: 'UPS_THREE_PHASE', status: 'ONLINE', healthScore: 95 },
  { name: 'UPS-DC-002', type: 'UPS_THREE_PHASE', status: 'WARNING', healthScore: 72 },
  { name: 'PDU-RACK-A1', type: 'PDU_INTELLIGENT', status: 'ONLINE', healthScore: 100 },
  { name: 'PDU-RACK-A2', type: 'PDU_INTELLIGENT', status: 'ALARM', healthScore: 45 },
  // ... 50+ assets across sites
];

const DEMO_ALERTS = [
  { severity: 'CRITICAL', title: 'Battery capacity below 20%', status: 'ACTIVE' },
  { severity: 'WARNING', title: 'Temperature approaching threshold', status: 'ACKNOWLEDGED' },
  { severity: 'INFO', title: 'Scheduled maintenance reminder', status: 'RESOLVED' },
  // ... 20+ alerts in various states
];
```

#### 2. Mock Telemetry API

For demo purposes, inject historical telemetry data:

```typescript
// src/modules/telemetry/mock-telemetry.service.ts

@Injectable()
export class MockTelemetryService {
  /**
   * Generate realistic historical telemetry for an asset
   * Used for demos and E2E tests when simulator unavailable
   */
  async generateHistoricalData(assetId: string, hours: number = 24) {
    const now = Date.now();
    const dataPoints = [];

    for (let i = hours * 60; i >= 0; i--) {
      const timestamp = new Date(now - i * 60 * 1000);
      dataPoints.push({
        assetId,
        timestamp,
        metrics: {
          'power.inputVoltage': 120 + Math.random() * 5,
          'power.outputVoltage': 120 + Math.random() * 2,
          'power.loadPercent': 45 + Math.random() * 20,
          'battery.chargeLevel': 85 + Math.random() * 15,
          'battery.temperature': 25 + Math.random() * 5,
          'environment.temperature': 20 + Math.random() * 3,
          'environment.humidity': 45 + Math.random() * 10,
        },
      });
    }

    await this.adxClient.ingest('telemetry', dataPoints);
  }
}
```

#### 3. Polling Fallback for Real-Time

Without WebSocket from devices, use polling for demo:

```typescript
// frontend/src/hooks/use-telemetry.ts

export function useTelemetry(assetId: string) {
  // In demo mode, poll API every 5 seconds instead of WebSocket
  const { data, isLoading } = useQuery({
    queryKey: ['telemetry', assetId],
    queryFn: () => api.get(`/assets/${assetId}/telemetry/latest`),
    refetchInterval: 5000, // Poll every 5 seconds
  });

  return { telemetry: data, isLoading };
}
```

### Demo-Ready Epic Structure

Reorder epics to prioritize demo-ready features:

```
PHASE 1: Foundation (Week 1)
├── RAMP-2: Repository Setup & CI/CD
├── RAMP-3: Azure Infrastructure (Terraform)
├── RAMP-4: Database Schema & Migrations
├── RAMP-5: Development Environment
└── RAMP-90: Test Infrastructure Setup ← NEW

PHASE 2: Authentication (Week 2)
├── RAMP-11: Azure AD B2C Integration
├── RAMP-12: JWT Token Implementation
├── RAMP-13: Multi-Tenant Middleware
├── RAMP-14: RBAC Permission System
├── RAMP-15: API Key Management
└── RAMP-91: Phase 2 Gate Tests ← NEW

PHASE 3: Core API - Demo Ready (Week 3-4)
├── RAMP-21: Asset CRUD API
├── RAMP-22: Site & Zone Hierarchy
├── RAMP-23: Asset Search & Filtering
├── RAMP-24: Bulk Import/Export
├── RAMP-25: Asset Lifecycle States
├── RAMP-41: Alert Rule Engine
├── RAMP-42: Threshold Configuration (no auto-trigger)
├── RAMP-43: Notification Channels
├── RAMP-44: Escalation Policies
├── RAMP-45: Alert Acknowledgment Flow
├── RAMP-51: Command Queue System
├── RAMP-53: Command Audit Logging
├── RAMP-54: Permission Validation
├── RAMP-93: Database Seeding Script ← NEW
└── RAMP-92: Phase 3 Gate Tests ← NEW

PHASE 4: Frontend - Demo Ready (Week 5-6)
├── RAMP-61: React App Scaffold
├── RAMP-62: Authentication UI
├── RAMP-63: Dashboard Overview
├── RAMP-64: Asset Management UI
├── RAMP-65: Alert Center UI
├── RAMP-66: Telemetry Charts (mock data)
├── RAMP-67: Settings & Admin UI
├── RAMP-71: Report Generator Service
├── RAMP-72: Scheduled Reports
├── RAMP-73: PDF/Excel Export
└── RAMP-94: Phase 4 Gate Tests ← NEW

🎯 DEMO-READY MILESTONE (End of Week 6)

PHASE 5: Real-Time Integration (Week 7+, requires simulator)
├── RAMP-31: IoT Hub Integration
├── RAMP-32: Telemetry Ingestion Pipeline
├── RAMP-33: Azure Data Explorer Setup
├── RAMP-34: WebSocket Gateway
├── RAMP-35: Live Dashboard Updates
├── RAMP-52: IoT Hub Direct Methods
└── RAMP-95: Full E2E Test Suite ← NEW
```

### Demo-Ready Acceptance Criteria

The Demo-Ready milestone is complete when:

- [ ] Azure infrastructure fully deployed and healthy
- [ ] User can sign up, log in, and manage their session
- [ ] Multi-tenant isolation verified (Org A cannot see Org B data)
- [ ] All RBAC roles work correctly (Viewer, Operator, Technician, Admin, Owner)
- [ ] Assets can be created, viewed, updated, deleted
- [ ] Site/Zone hierarchy works correctly
- [ ] Alert rules can be configured
- [ ] Alerts can be viewed, acknowledged, resolved
- [ ] Commands can be submitted and viewed in history
- [ ] Dashboard displays all widgets with seeded data
- [ ] Reports generate successfully as PDF/Excel
- [ ] 70%+ E2E test coverage passing
- [ ] System handles 100 concurrent users (load test)

### Demo Script

For demonstrating the platform:

```markdown
1. **Login** - Show Azure AD B2C authentication
2. **Dashboard** - Overview with health scores, alert counts, asset status
3. **Assets** - Navigate hierarchy: Sites → Zones → Assets
4. **Asset Detail** - Show telemetry charts (mock data), health score
5. **Create Asset** - Add new UPS, show it appears in list
6. **Alert Center** - View active alerts, acknowledge one, resolve another
7. **Create Alert Rule** - Set up threshold for battery level
8. **Issue Command** - Queue a self-test command, show audit log
9. **Reports** - Generate uptime report, download PDF
10. **Admin** - User management, API keys, settings
```

---

## 1. Executive Summary

**Product Name:** Remote Asset Monitoring Platform (RAMP)

**Vision:** A cloud-based remote monitoring and predictive analytics platform that provides 24/7 visibility into critical infrastructure assets (UPS systems, PDUs, industrial equipment) across distributed locations, enabling proactive maintenance and minimizing downtime.

**Target Repository:** `github.com/jarod-rosenthal/remote-monitoring`

**Cloud Platform:** Microsoft Azure (greenfield deployment)

---

## 2. Problem Statement

Organizations with critical power infrastructure and industrial equipment face:

| Challenge | Impact |
|-----------|--------|
| **Unplanned downtime** | Equipment failures causing business disruption |
| **Reactive maintenance** | Costly emergency repairs instead of predictive approaches |
| **Limited visibility** | No unified view across geographically distributed assets |
| **Siloed data** | Multiple vendors and locations with disconnected monitoring |
| **Delayed response** | Critical alerts missed when staff aren't on-site |
| **Compliance gaps** | Inadequate monitoring and reporting for audits |

---

## 3. Product Overview

### 3.1 Core Value Propositions

| Value | Description |
|-------|-------------|
| **24/7 Monitoring** | Continuous cloud-based monitoring of all connected assets |
| **Predictive Analytics** | AI/ML-driven failure prediction to prevent downtime |
| **Unified Dashboard** | Single pane of glass across all assets, locations, vendors |
| **Proactive Alerting** | Real-time notifications before issues become critical |
| **Remote Diagnostics** | Troubleshoot and control equipment without on-site visits |
| **Automated Reporting** | Scheduled reports for stakeholders and compliance |

### 3.2 Technology Stack (Azure-Native)

| Layer | Technology | Azure Service |
|-------|------------|---------------|
| **Runtime** | Node.js 20+ / TypeScript | Azure Container Apps |
| **API Framework** | NestJS 10+ | - |
| **Database ORM** | Prisma 5+ | Azure Database for PostgreSQL |
| **Time-Series** | - | Azure Data Explorer (Kusto) |
| **Cache** | - | Azure Cache for Redis |
| **Auth** | Passport.js + JWT | Azure AD B2C |
| **IoT** | - | Azure IoT Hub + DPS |
| **Messaging** | - | Azure Service Bus |
| **Storage** | - | Azure Blob Storage |
| **CDN** | - | Azure Front Door |
| **Secrets** | - | Azure Key Vault |
| **Monitoring** | - | Azure Monitor + App Insights |

---

## 5. Jira Epic & Story Breakdown

### Epic Structure (Ordered by Demo-Ready Priority)

```
RAMP-1: Project Foundation
├── RAMP-2: Repository Setup & CI/CD
├── RAMP-3: Azure Infrastructure (Terraform)
├── RAMP-4: Database Schema & Migrations
├── RAMP-5: Development Environment
└── RAMP-90: Test Infrastructure & Validation Setup ← NEW

RAMP-10: Authentication & Multi-Tenancy
├── RAMP-11: Azure AD B2C Integration
├── RAMP-12: JWT Token Implementation
├── RAMP-13: Multi-Tenant Middleware
├── RAMP-14: RBAC Permission System
├── RAMP-15: API Key Management
└── RAMP-91: Phase Gate Tests - Auth ← NEW

RAMP-20: Asset Management
├── RAMP-21: Asset CRUD API
├── RAMP-22: Site & Zone Hierarchy
├── RAMP-23: Asset Search & Filtering
├── RAMP-24: Bulk Import/Export
└── RAMP-25: Asset Lifecycle States

RAMP-40: Alerting System (Demo-Ready - no auto-trigger)
├── RAMP-41: Alert Rule Engine
├── RAMP-42: Threshold Configuration UI
├── RAMP-43: Notification Channels
├── RAMP-44: Escalation Policies
└── RAMP-45: Alert Acknowledgment Flow

RAMP-50: Remote Commands (Demo-Ready - queue only)
├── RAMP-51: Command Queue System
├── RAMP-53: Command Audit Logging
├── RAMP-54: Permission Validation
└── RAMP-92: Phase Gate Tests - API ← NEW

RAMP-60: Frontend Dashboard (Demo-Ready)
├── RAMP-61: React App Scaffold
├── RAMP-62: Authentication UI
├── RAMP-63: Dashboard Overview
├── RAMP-64: Asset Management UI
├── RAMP-65: Alert Center UI
├── RAMP-66: Telemetry Charts (Mock Data)
└── RAMP-67: Settings & Admin UI

RAMP-70: Reporting
├── RAMP-71: Report Generator Service
├── RAMP-72: Scheduled Reports
├── RAMP-73: PDF/Excel Export
└── RAMP-74: Report Templates

RAMP-93: Demo Data & Seeding ← NEW
├── RAMP-93a: Organization & User Seeding
├── RAMP-93b: Asset & Hierarchy Seeding
├── RAMP-93c: Alert & Command History Seeding
└── RAMP-93d: Mock Telemetry Generation

RAMP-94: Demo-Ready Validation ← NEW
├── RAMP-94a: Phase Gate Tests - Frontend
├── RAMP-94b: Load Testing (100 users)
└── RAMP-94c: Demo Script Walkthrough Test

────────────────────────────────────────────────────
🎯 DEMO-READY MILESTONE (Stories above this line)
────────────────────────────────────────────────────

RAMP-30: Telemetry & Real-Time (Requires Simulator)
├── RAMP-31: IoT Hub Integration
├── RAMP-32: Telemetry Ingestion Pipeline
├── RAMP-33: Azure Data Explorer Setup
├── RAMP-34: WebSocket Gateway
└── RAMP-35: Live Dashboard Updates

RAMP-52: IoT Hub Direct Methods (Requires Simulator)

RAMP-95: Full E2E Test Suite ← NEW
├── RAMP-95a: Live Telemetry Tests
├── RAMP-95b: Alert Auto-Trigger Tests
└── RAMP-95c: Command Execution Tests
```

### New Stories Detail

#### RAMP-90: Test Infrastructure & Validation Setup

**Summary:** Configure automated testing and validation pipeline

**Acceptance Criteria:**
- [ ] Vitest configured for API with 80% coverage threshold
- [ ] Playwright configured for E2E tests
- [ ] GitHub Actions workflow validates all layers
- [ ] Auto-merge on success, auto-fix-ticket on failure
- [ ] Circuit breaker triggers at 3 failed attempts
- [ ] Dependency unblocking script works

**Persona:** devops_engineer

---

#### RAMP-91: Phase Gate Tests - Auth

**Summary:** E2E tests that validate authentication phase

**Acceptance Criteria:**
- [ ] Test: Health endpoint responds 200
- [ ] Test: Can register new user
- [ ] Test: Can log in and receive JWT
- [ ] Test: Protected routes reject unauthenticated requests
- [ ] Test: Token refresh works
- [ ] Test: Logout invalidates session
- [ ] All tests pass before Phase 3 stories unblock

**Persona:** qa_engineer

---

#### RAMP-92: Phase Gate Tests - API

**Summary:** E2E tests that validate core API phase

**Acceptance Criteria:**
- [ ] Test: Asset CRUD operations work
- [ ] Test: Site/Zone hierarchy works
- [ ] Test: Alert rules can be created
- [ ] Test: Alerts can be acknowledged/resolved
- [ ] Test: Commands can be queued
- [ ] Test: Audit log captures all actions
- [ ] All tests pass before Phase 4 stories unblock

**Persona:** qa_engineer

---

#### RAMP-93: Demo Data & Seeding

**Summary:** Create realistic demo data for demonstrations

**Acceptance Criteria:**
- [ ] Seed script creates demo organization "Acme Corporation"
- [ ] Creates 5 users with different roles
- [ ] Creates 3 sites with zones
- [ ] Creates 50+ assets across sites
- [ ] Creates 20+ alerts in various states
- [ ] Creates command history
- [ ] Generates 7 days of mock telemetry
- [ ] Seed is idempotent (can run multiple times)
- [ ] `npm run seed:demo` command works

**Persona:** backend_developer

---

#### RAMP-94: Demo-Ready Validation

**Summary:** Comprehensive tests proving demo-ready milestone

**Acceptance Criteria:**
- [ ] All Phase Gate tests pass
- [ ] Load test: 100 concurrent users
- [ ] Demo script walkthrough automated test
- [ ] All dashboard widgets render correctly
- [ ] Reports generate successfully
- [ ] No console errors in frontend

**Persona:** qa_engineer

### Story Template

Each Jira story follows this structure:

```markdown
## Summary
[One-line description]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Technical Notes
[Implementation guidance]

## E2E Test Requirements
- Test file: `e2e/[area]/[feature].spec.ts`
- Test scenarios:
  - [ ] Happy path
  - [ ] Error handling
  - [ ] Edge cases

## Persona
[Assigned WorkerMill persona]

## Dependencies
- Blocked by: [ticket IDs]
- Blocks: [ticket IDs]
```

---

## 6. Persona Assignments

### Persona → Task Mapping

| Epic/Area | Primary Persona | Secondary Persona |
|-----------|-----------------|-------------------|
| **RAMP-1: Foundation** | `devops_engineer` | - |
| **RAMP-10: Auth** | `backend_developer` | `security_engineer` |
| **RAMP-20: Assets** | `backend_developer` | - |
| **RAMP-30: Telemetry** | `backend_developer` | `devops_engineer` |
| **RAMP-40: Alerting** | `backend_developer` | - |
| **RAMP-50: Commands** | `backend_developer` | `security_engineer` |
| **RAMP-60: Frontend** | `frontend_developer` | - |
| **RAMP-70: Reporting** | `backend_developer` | `frontend_developer` |
| **RAMP-80: E2E Tests** | `qa_engineer` | - |
| **Infrastructure** | `devops_engineer` | - |
| **Security Review** | `security_engineer` | - |
| **Documentation** | `tech_writer` | - |

### Persona Capabilities

```yaml
backend_developer:
  expertise:
    - NestJS API development
    - Prisma ORM
    - Azure services integration
    - Real-time systems (WebSocket/SSE)
    - Queue processing (BullMQ)
  tools:
    - TypeScript
    - PostgreSQL
    - Redis
    - Azure SDK

frontend_developer:
  expertise:
    - React 18+ with hooks
    - TailwindCSS
    - Zustand state management
    - React Query
    - Real-time UI updates
  tools:
    - Vite
    - TypeScript
    - Recharts
    - Radix UI

devops_engineer:
  expertise:
    - Terraform for Azure
    - GitHub Actions CI/CD
    - Azure Container Apps
    - Azure IoT Hub
    - Monitoring & observability
  tools:
    - Terraform
    - Docker
    - Azure CLI
    - GitHub Actions

security_engineer:
  expertise:
    - OAuth 2.0 / OIDC
    - JWT security
    - RBAC implementation
    - Input validation
    - Security headers
  tools:
    - Azure AD B2C
    - OWASP guidelines
    - Security scanning

qa_engineer:
  expertise:
    - E2E testing with Playwright
    - Test automation
    - CI/CD test integration
    - Test data management
  tools:
    - Playwright
    - Vitest
    - Test fixtures
```

---

## 7. JWT Multi-Tenant Token Structure

### 6.1 Access Token Structure

```typescript
// src/auth/types/jwt-payload.ts

/**
 * JWT Access Token Payload
 *
 * This token is issued after successful authentication and contains
 * all claims needed for authorization decisions.
 */
export interface JwtAccessTokenPayload {
  // Standard JWT Claims (RFC 7519)
  iss: string;          // Issuer: "https://ramp.example.com"
  sub: string;          // Subject: User ID (CUID)
  aud: string[];        // Audience: ["https://api.ramp.example.com"]
  exp: number;          // Expiration: Unix timestamp
  iat: number;          // Issued At: Unix timestamp
  nbf: number;          // Not Before: Unix timestamp
  jti: string;          // JWT ID: Unique token identifier

  // Multi-Tenant Claims
  tenant: {
    id: string;         // Organization ID (CUID)
    slug: string;       // Organization slug for URLs
    plan: TenantPlan;   // FREE | STARTER | PROFESSIONAL | ENTERPRISE
  };

  // User Identity Claims
  user: {
    id: string;         // User ID (CUID)
    email: string;      // User email
    name: string | null;// Display name
    role: UserRole;     // VIEWER | OPERATOR | TECHNICIAN | ADMIN | OWNER
  };

  // Authorization Claims
  permissions: string[];  // Derived from role: ["read:assets", "write:alerts", ...]

  // Scope Restrictions (optional)
  scope?: {
    siteIds?: string[]; // Limit access to specific sites
    assetTypes?: string[]; // Limit access to specific asset types
  };

  // Session Metadata
  session: {
    id: string;         // Session ID for revocation
    deviceId?: string;  // Device fingerprint
    ipAddress?: string; // Original IP (for audit)
  };
}

export type TenantPlan = 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';

export type UserRole = 'VIEWER' | 'OPERATOR' | 'TECHNICIAN' | 'ADMIN' | 'OWNER';

// Role → Permissions mapping
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  VIEWER: [
    'read:assets',
    'read:alerts',
    'read:telemetry',
    'read:reports',
  ],
  OPERATOR: [
    'read:assets',
    'read:alerts',
    'read:telemetry',
    'read:reports',
    'write:alerts:acknowledge',
  ],
  TECHNICIAN: [
    'read:assets',
    'read:alerts',
    'read:telemetry',
    'read:reports',
    'write:alerts:acknowledge',
    'write:alerts:resolve',
    'write:commands',
    'write:assets',
  ],
  ADMIN: [
    'read:assets',
    'read:alerts',
    'read:telemetry',
    'read:reports',
    'write:alerts:acknowledge',
    'write:alerts:resolve',
    'write:commands',
    'write:assets',
    'write:users',
    'write:settings',
    'write:integrations',
  ],
  OWNER: ['*'], // Full access
};
```

### 6.2 Token Generation & Validation

```typescript
// src/auth/services/token.service.ts

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import {
  JwtAccessTokenPayload,
  ROLE_PERMISSIONS,
  UserRole,
} from '../types/jwt-payload';

@Injectable()
export class TokenService {
  private readonly accessTokenTtl: number;
  private readonly refreshTokenTtl: number;
  private readonly issuer: string;
  private readonly audience: string[];

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    this.accessTokenTtl = this.config.get<number>('JWT_ACCESS_TTL', 900); // 15 min
    this.refreshTokenTtl = this.config.get<number>('JWT_REFRESH_TTL', 604800); // 7 days
    this.issuer = this.config.get<string>('JWT_ISSUER', 'https://ramp.example.com');
    this.audience = [this.config.get<string>('JWT_AUDIENCE', 'https://api.ramp.example.com')];
  }

  /**
   * Generate access token for authenticated user
   */
  async generateAccessToken(
    user: { id: string; email: string; name: string | null; role: UserRole },
    organization: { id: string; slug: string; plan: string },
    sessionId: string,
    options?: { siteIds?: string[]; ipAddress?: string },
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    const payload: JwtAccessTokenPayload = {
      // Standard claims
      iss: this.issuer,
      sub: user.id,
      aud: this.audience,
      exp: now + this.accessTokenTtl,
      iat: now,
      nbf: now,
      jti: uuidv4(),

      // Multi-tenant claims
      tenant: {
        id: organization.id,
        slug: organization.slug,
        plan: organization.plan as any,
      },

      // User claims
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },

      // Permissions derived from role
      permissions: this.getPermissionsForRole(user.role),

      // Scope restrictions
      scope: options?.siteIds ? { siteIds: options.siteIds } : undefined,

      // Session metadata
      session: {
        id: sessionId,
        ipAddress: options?.ipAddress,
      },
    };

    return this.jwtService.signAsync(payload);
  }

  /**
   * Generate refresh token (opaque, stored in database)
   */
  async generateRefreshToken(
    userId: string,
    sessionId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + this.refreshTokenTtl * 1000);

    // Note: Store hash of token in database, not the token itself
    return { token, expiresAt };
  }

  /**
   * Validate and decode access token
   */
  async validateAccessToken(token: string): Promise<JwtAccessTokenPayload> {
    return this.jwtService.verifyAsync<JwtAccessTokenPayload>(token, {
      issuer: this.issuer,
      audience: this.audience,
    });
  }

  /**
   * Get permissions for a given role
   */
  private getPermissionsForRole(role: UserRole): string[] {
    return ROLE_PERMISSIONS[role] ?? [];
  }

  /**
   * Check if token has specific permission
   */
  hasPermission(payload: JwtAccessTokenPayload, permission: string): boolean {
    if (payload.permissions.includes('*')) return true;
    return payload.permissions.includes(permission);
  }

  /**
   * Check if token can access specific tenant resource
   */
  canAccessTenant(payload: JwtAccessTokenPayload, tenantId: string): boolean {
    return payload.tenant.id === tenantId;
  }

  /**
   * Check if token can access specific site (if scope restricted)
   */
  canAccessSite(payload: JwtAccessTokenPayload, siteId: string): boolean {
    if (!payload.scope?.siteIds) return true; // No restriction
    return payload.scope.siteIds.includes(siteId);
  }
}
```

### 6.3 Multi-Tenant Middleware

```typescript
// src/common/middleware/tenant.middleware.ts

import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtAccessTokenPayload } from '@/auth/types/jwt-payload';

// Extend Express Request to include tenant context
declare global {
  namespace Express {
    interface Request {
      tenantId: string;
      tenantSlug: string;
      tenantPlan: string;
      userId: string;
      userRole: string;
      permissions: string[];
      jwtPayload: JwtAccessTokenPayload;
    }
  }
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const payload = req.jwtPayload;

    if (!payload) {
      throw new UnauthorizedException('No authentication context');
    }

    // Extract tenant context from JWT
    req.tenantId = payload.tenant.id;
    req.tenantSlug = payload.tenant.slug;
    req.tenantPlan = payload.tenant.plan;
    req.userId = payload.user.id;
    req.userRole = payload.user.role;
    req.permissions = payload.permissions;

    next();
  }
}
```

### 6.4 Tenant-Scoped Prisma Extension

```typescript
// src/database/prisma/tenant-prisma.service.ts

import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { Request } from 'express';

/**
 * Request-scoped Prisma client that automatically filters by tenant
 *
 * All queries through this service are automatically scoped to the
 * current request's tenant, preventing cross-tenant data access.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private readonly prisma: PrismaClient;
  private readonly tenantId: string;

  constructor(@Inject(REQUEST) private readonly request: Request) {
    this.tenantId = request.tenantId;

    // Create extended Prisma client with automatic tenant filtering
    this.prisma = new PrismaClient().$extends({
      query: {
        $allModels: {
          async findMany({ model, operation, args, query }) {
            // Add organizationId filter to all findMany queries
            if (this.hasOrganizationId(model)) {
              args.where = { ...args.where, organizationId: this.tenantId };
            }
            return query(args);
          },
          async findFirst({ model, operation, args, query }) {
            if (this.hasOrganizationId(model)) {
              args.where = { ...args.where, organizationId: this.tenantId };
            }
            return query(args);
          },
          async findUnique({ model, operation, args, query }) {
            // For findUnique, we validate after fetch
            const result = await query(args);
            if (result && this.hasOrganizationId(model)) {
              if ((result as any).organizationId !== this.tenantId) {
                return null; // Hide cross-tenant results
              }
            }
            return result;
          },
          async create({ model, operation, args, query }) {
            // Automatically set organizationId on create
            if (this.hasOrganizationId(model)) {
              args.data = { ...args.data, organizationId: this.tenantId };
            }
            return query(args);
          },
          async update({ model, operation, args, query }) {
            // Ensure update is scoped to tenant
            if (this.hasOrganizationId(model)) {
              args.where = { ...args.where, organizationId: this.tenantId };
            }
            return query(args);
          },
          async delete({ model, operation, args, query }) {
            // Ensure delete is scoped to tenant
            if (this.hasOrganizationId(model)) {
              args.where = { ...args.where, organizationId: this.tenantId };
            }
            return query(args);
          },
        },
      },
    }) as PrismaClient;
  }

  private hasOrganizationId(model: string): boolean {
    // Models that have organizationId field
    const tenantedModels = [
      'User', 'Site', 'Zone', 'Asset', 'AlertRule', 'Alert',
      'Command', 'Report', 'Integration', 'ApiKey', 'AuditLog',
    ];
    return tenantedModels.includes(model);
  }

  get client(): PrismaClient {
    return this.prisma;
  }
}
```

---

## 8. Functional Requirements

### 7.1 Asset Management

| ID | Requirement | Priority | Persona |
|----|-------------|----------|---------|
| AM-1 | Register and onboard assets via serial number, QR code, or manual entry | P0 | backend_developer |
| AM-2 | Support hierarchical organization: Organization → Site → Zone → Asset | P0 | backend_developer |
| AM-3 | Store asset metadata: model, serial, firmware, install date, warranty | P0 | backend_developer |
| AM-4 | Track asset lifecycle states: active, maintenance, decommissioned | P1 | backend_developer |
| AM-5 | Bulk import/export assets via CSV | P1 | backend_developer |
| AM-6 | Asset search and filtering by type, location, status, health | P0 | backend_developer |
| AM-7 | Asset grouping and tagging for custom organization | P2 | backend_developer |

### 7.2 Real-Time Monitoring

| ID | Requirement | Priority | Persona |
|----|-------------|----------|---------|
| RT-1 | Display real-time telemetry: voltage, current, power, temperature, humidity | P0 | backend_developer |
| RT-2 | Show asset health status with color-coded indicators | P0 | frontend_developer |
| RT-3 | Support configurable polling intervals (1s to 5min) | P1 | backend_developer |
| RT-4 | Live data streaming via WebSocket for dashboard updates | P0 | backend_developer |
| RT-5 | Display battery status: charge level, runtime remaining, health score | P0 | frontend_developer |
| RT-6 | Show load levels and capacity utilization percentages | P0 | frontend_developer |
| RT-7 | Geographic map view showing all sites with status indicators | P1 | frontend_developer |

### 7.3 Alerting & Notifications

| ID | Requirement | Priority | Persona |
|----|-------------|----------|---------|
| AL-1 | Configurable alert thresholds per metric per asset | P0 | backend_developer |
| AL-2 | Multi-severity levels: Info, Warning, Critical, Emergency | P0 | backend_developer |
| AL-3 | Notification channels: Email, SMS, Push, Webhook | P0 | backend_developer |
| AL-4 | Escalation policies with time-based escalation | P1 | backend_developer |
| AL-5 | Alert acknowledgment and resolution tracking | P0 | backend_developer |
| AL-6 | Alert suppression windows for maintenance | P1 | backend_developer |
| AL-7 | Alert history and audit log | P0 | backend_developer |

### 7.4 Remote Control

| ID | Requirement | Priority | Persona |
|----|-------------|----------|---------|
| RC-1 | Remote UPS self-test initiation | P0 | backend_developer |
| RC-2 | Remote outlet control (on/off/cycle) for managed PDUs | P0 | backend_developer |
| RC-3 | View detailed diagnostics and event logs | P0 | backend_developer |
| RC-4 | Remote firmware update initiation | P1 | backend_developer |
| RC-5 | Command audit logging | P0 | security_engineer |
| RC-6 | Role-based access for control operations | P0 | security_engineer |

---

## 9. Database Schema

### 8.1 Prisma Schema (Complete)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// ORGANIZATION & MULTI-TENANCY
// ============================================

model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  plan      Plan     @default(FREE)

  // Azure AD B2C tenant configuration
  azureTenantId     String?   @map("azure_tenant_id")
  azureClientId     String?   @map("azure_client_id")

  // Settings stored as JSON
  settings  Json     @default("{}")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Relations
  users        User[]
  sites        Site[]
  assets       Asset[]
  alertRules   AlertRule[]
  alerts       Alert[]
  commands     Command[]
  integrations Integration[]
  apiKeys      ApiKey[]
  reports      Report[]
  auditLogs    AuditLog[]

  @@index([slug])
  @@map("organizations")
}

enum Plan {
  FREE
  STARTER
  PROFESSIONAL
  ENTERPRISE
}

// ============================================
// USER & AUTHENTICATION
// ============================================

model User {
  id             String    @id @default(cuid())
  email          String
  name           String?
  avatarUrl      String?   @map("avatar_url")
  role           UserRole  @default(VIEWER)

  organizationId String    @map("organization_id")

  // Azure AD B2C object ID
  externalId     String?   @map("external_id")

  // MFA status
  mfaEnabled     Boolean   @default(false) @map("mfa_enabled")

  // Activity tracking
  lastLoginAt    DateTime? @map("last_login_at")
  lastLoginIp    String?   @map("last_login_ip")

  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  // Relations
  organization         Organization           @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  acknowledgedAlerts   Alert[]                @relation("AlertAcknowledgedBy")
  resolvedAlerts       Alert[]                @relation("AlertResolvedBy")
  issuedCommands       Command[]
  auditLogs            AuditLog[]
  sessions             Session[]
  notificationPrefs    NotificationPreference[]

  @@unique([email, organizationId])
  @@index([organizationId])
  @@index([externalId])
  @@map("users")
}

enum UserRole {
  VIEWER
  OPERATOR
  TECHNICIAN
  ADMIN
  OWNER
}

model Session {
  id           String   @id @default(cuid())
  userId       String   @map("user_id")

  // Refresh token (hashed)
  tokenHash    String   @map("token_hash")

  // Session metadata
  userAgent    String?  @map("user_agent")
  ipAddress    String?  @map("ip_address")
  deviceId     String?  @map("device_id")

  expiresAt    DateTime @map("expires_at")
  createdAt    DateTime @default(now()) @map("created_at")
  lastUsedAt   DateTime @default(now()) @map("last_used_at")

  // Revocation
  revokedAt    DateTime? @map("revoked_at")
  revokedBy    String?   @map("revoked_by")

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([tokenHash])
  @@map("sessions")
}

model ApiKey {
  id             String    @id @default(cuid())
  name           String

  // API key (hashed with SHA-256)
  keyHash        String    @unique @map("key_hash")

  // Prefix for identification (first 8 chars)
  keyPrefix      String    @map("key_prefix")

  // Scopes define what the key can access
  scopes         String[]

  organizationId String    @map("organization_id")
  createdById    String    @map("created_by_id")

  lastUsedAt     DateTime? @map("last_used_at")
  expiresAt      DateTime? @map("expires_at")
  revokedAt      DateTime? @map("revoked_at")

  createdAt      DateTime  @default(now()) @map("created_at")

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([keyHash])
  @@index([organizationId])
  @@map("api_keys")
}

// ============================================
// SITE HIERARCHY
// ============================================

model Site {
  id             String   @id @default(cuid())
  name           String

  // Location
  address        String?
  city           String?
  state          String?
  country        String?
  postalCode     String?  @map("postal_code")
  timezone       String   @default("UTC")
  latitude       Float?
  longitude      Float?

  organizationId String   @map("organization_id")

  // Extended metadata
  metadata       Json     @default("{}")

  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  zones          Zone[]
  assets         Asset[]

  @@index([organizationId])
  @@map("sites")
}

model Zone {
  id        String   @id @default(cuid())
  name      String
  type      ZoneType @default(OTHER)
  floor     String?

  siteId    String   @map("site_id")
  parentId  String?  @map("parent_id")

  metadata  Json     @default("{}")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  site      Site     @relation(fields: [siteId], references: [id], onDelete: Cascade)
  parent    Zone?    @relation("ZoneHierarchy", fields: [parentId], references: [id])
  children  Zone[]   @relation("ZoneHierarchy")
  assets    Asset[]

  @@index([siteId])
  @@index([parentId])
  @@map("zones")
}

enum ZoneType {
  DATA_HALL
  ELECTRICAL_ROOM
  MECHANICAL_ROOM
  IT_CLOSET
  OFFICE
  WAREHOUSE
  OTHER
}

// ============================================
// ASSETS
// ============================================

model Asset {
  id              String       @id @default(cuid())
  name            String

  // Identification
  serialNumber    String?      @map("serial_number")
  model           String?
  manufacturer    String?
  assetType       AssetType    @map("asset_type")

  // Status
  status          AssetStatus  @default(OFFLINE)
  healthScore     Int?         @map("health_score")

  // Firmware
  firmwareVersion String?      @map("firmware_version")

  // Lifecycle
  installDate     DateTime?    @map("install_date")
  warrantyExpiry  DateTime?    @map("warranty_expiry")

  // Hierarchy
  organizationId  String       @map("organization_id")
  siteId          String       @map("site_id")
  zoneId          String?      @map("zone_id")
  parentAssetId   String?      @map("parent_asset_id")

  // IoT Hub connection
  deviceId        String?      @unique @map("device_id")
  connectionType  ConnectionType? @map("connection_type")
  ipAddress       String?      @map("ip_address")
  lastSeenAt      DateTime?    @map("last_seen_at")

  // Organization
  tags            String[]
  metadata        Json         @default("{}")

  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")

  // Relations
  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  site            Site         @relation(fields: [siteId], references: [id], onDelete: Cascade)
  zone            Zone?        @relation(fields: [zoneId], references: [id])
  parentAsset     Asset?       @relation("AssetHierarchy", fields: [parentAssetId], references: [id])
  childAssets     Asset[]      @relation("AssetHierarchy")

  alerts          Alert[]
  commands        Command[]
  maintenanceRecords MaintenanceRecord[]

  @@index([organizationId])
  @@index([siteId])
  @@index([zoneId])
  @@index([serialNumber])
  @@index([deviceId])
  @@index([assetType, status])
  @@map("assets")
}

enum AssetType {
  UPS_SINGLE_PHASE
  UPS_THREE_PHASE
  UPS_MODULAR
  PDU_BASIC
  PDU_METERED
  PDU_MONITORED
  PDU_SWITCHED
  PDU_INTELLIGENT
  BATTERY_CABINET
  GENERATOR
  ATS
  SWITCHGEAR
  TRANSFORMER
  SENSOR_TEMPERATURE
  SENSOR_HUMIDITY
  SENSOR_LEAK
  SENSOR_CONTACT
  SENSOR_DOOR
  HVAC_CRAC
  HVAC_CHILLER
  METER_POWER
  OTHER
}

enum AssetStatus {
  ONLINE
  OFFLINE
  ALARM
  WARNING
  MAINTENANCE
  DECOMMISSIONED
}

enum ConnectionType {
  DIRECT_CLOUD
  GATEWAY
  SNMP
  MODBUS_TCP
  MODBUS_RTU
  BACNET
}

// ============================================
// ALERTS
// ============================================

model AlertRule {
  id              String        @id @default(cuid())
  name            String
  description     String?
  enabled         Boolean       @default(true)

  organizationId  String        @map("organization_id")

  // Targeting
  assetTypes      AssetType[]   @map("asset_types")
  siteIds         String[]      @map("site_ids")
  assetIds        String[]      @map("asset_ids")

  // Condition
  metric          String
  operator        RuleOperator
  threshold       Float
  duration        Int?          // Seconds before alert triggers

  // Alert configuration
  severity        AlertSeverity @default(WARNING)
  message         String        // Template with {{variables}}

  // Notification
  notifyChannels  String[]      @map("notify_channels")
  notifyUserIds   String[]      @map("notify_user_ids")
  escalationPolicy Json?        @map("escalation_policy")

  cooldownMinutes Int           @default(15) @map("cooldown_minutes")

  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  organization    Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  alerts          Alert[]

  @@index([organizationId])
  @@index([enabled])
  @@map("alert_rules")
}

enum RuleOperator {
  GREATER_THAN
  GREATER_THAN_OR_EQUAL
  LESS_THAN
  LESS_THAN_OR_EQUAL
  EQUAL
  NOT_EQUAL
  CONTAINS
  NOT_CONTAINS
}

enum AlertSeverity {
  INFO
  WARNING
  CRITICAL
  EMERGENCY
}

model Alert {
  id               String        @id @default(cuid())

  assetId          String        @map("asset_id")
  ruleId           String?       @map("rule_id")
  organizationId   String        @map("organization_id")

  severity         AlertSeverity
  status           AlertStatus   @default(ACTIVE)

  title            String
  message          String
  details          Json?

  // Metric that triggered the alert
  metricName       String?       @map("metric_name")
  metricValue      Float?        @map("metric_value")
  threshold        Float?

  // Timestamps
  triggeredAt      DateTime      @default(now()) @map("triggered_at")
  acknowledgedAt   DateTime?     @map("acknowledged_at")
  acknowledgedById String?       @map("acknowledged_by_id")
  resolvedAt       DateTime?     @map("resolved_at")
  resolvedById     String?       @map("resolved_by_id")
  resolution       String?

  // Notification tracking
  notificationsSent Json?        @map("notifications_sent")

  // Relations
  asset            Asset         @relation(fields: [assetId], references: [id], onDelete: Cascade)
  rule             AlertRule?    @relation(fields: [ruleId], references: [id])
  organization     Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  acknowledgedBy   User?         @relation("AlertAcknowledgedBy", fields: [acknowledgedById], references: [id])
  resolvedBy       User?         @relation("AlertResolvedBy", fields: [resolvedById], references: [id])

  @@index([assetId])
  @@index([ruleId])
  @@index([organizationId])
  @@index([status])
  @@index([severity])
  @@index([triggeredAt])
  @@map("alerts")
}

enum AlertStatus {
  ACTIVE
  ACKNOWLEDGED
  RESOLVED
  SUPPRESSED
}

// ============================================
// COMMANDS
// ============================================

model Command {
  id           String        @id @default(cuid())

  assetId      String        @map("asset_id")
  issuedById   String        @map("issued_by_id")
  organizationId String      @map("organization_id")

  type         CommandType
  parameters   Json?

  status       CommandStatus @default(PENDING)

  // Timestamps
  issuedAt     DateTime      @default(now()) @map("issued_at")
  sentAt       DateTime?     @map("sent_at")
  completedAt  DateTime?     @map("completed_at")

  // Result
  result       Json?
  errorMessage String?       @map("error_message")

  // Relations
  asset        Asset         @relation(fields: [assetId], references: [id], onDelete: Cascade)
  issuedBy     User          @relation(fields: [issuedById], references: [id])
  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([assetId])
  @@index([organizationId])
  @@index([status])
  @@index([issuedAt])
  @@map("commands")
}

enum CommandType {
  UPS_SELF_TEST
  UPS_BATTERY_TEST
  UPS_REBOOT
  UPS_SHUTDOWN
  UPS_BYPASS_ENABLE
  UPS_BYPASS_DISABLE
  PDU_OUTLET_ON
  PDU_OUTLET_OFF
  PDU_OUTLET_CYCLE
  PDU_REBOOT
  DEVICE_REBOOT
  DEVICE_CONFIG_UPDATE
  FIRMWARE_UPDATE
  DIAGNOSTIC_RUN
}

enum CommandStatus {
  PENDING
  SENT
  ACKNOWLEDGED
  COMPLETED
  FAILED
  TIMEOUT
  CANCELLED
}

// ============================================
// MAINTENANCE
// ============================================

model MaintenanceRecord {
  id            String            @id @default(cuid())
  assetId       String            @map("asset_id")

  type          MaintenanceType
  status        MaintenanceStatus @default(SCHEDULED)

  scheduledDate DateTime          @map("scheduled_date")
  completedDate DateTime?         @map("completed_date")

  description   String
  notes         String?
  performedBy   String?           @map("performed_by")
  cost          Float?

  createdAt     DateTime          @default(now()) @map("created_at")
  updatedAt     DateTime          @updatedAt @map("updated_at")

  asset         Asset             @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@index([assetId])
  @@index([scheduledDate])
  @@index([status])
  @@map("maintenance_records")
}

enum MaintenanceType {
  PREVENTIVE
  CORRECTIVE
  PREDICTIVE
  BATTERY_REPLACEMENT
  FIRMWARE_UPDATE
  CALIBRATION
  INSPECTION
}

enum MaintenanceStatus {
  SCHEDULED
  IN_PROGRESS
  COMPLETED
  CANCELLED
  OVERDUE
}

// ============================================
// NOTIFICATIONS
// ============================================

model NotificationPreference {
  id          String              @id @default(cuid())
  userId      String              @map("user_id")

  channel     NotificationChannel
  enabled     Boolean             @default(true)

  // Channel-specific destination
  destination String?

  // Filters
  severities  AlertSeverity[]
  siteIds     String[]            @map("site_ids")
  assetTypes  AssetType[]         @map("asset_types")

  // Quiet hours
  quietHoursStart String?         @map("quiet_hours_start")
  quietHoursEnd   String?         @map("quiet_hours_end")
  timezone        String          @default("UTC")

  createdAt   DateTime            @default(now()) @map("created_at")
  updatedAt   DateTime            @updatedAt @map("updated_at")

  user        User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, channel])
  @@index([userId])
  @@map("notification_preferences")
}

enum NotificationChannel {
  EMAIL
  SMS
  PUSH
  WEBHOOK
  SLACK
  TEAMS
}

// ============================================
// INTEGRATIONS
// ============================================

model Integration {
  id             String          @id @default(cuid())
  organizationId String          @map("organization_id")

  type           IntegrationType
  name           String
  enabled        Boolean         @default(true)

  // Encrypted configuration
  config         Json

  // Sync state
  lastSyncAt     DateTime?       @map("last_sync_at")
  lastSyncStatus String?         @map("last_sync_status")

  createdAt      DateTime        @default(now()) @map("created_at")
  updatedAt      DateTime        @updatedAt @map("updated_at")

  organization   Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([type])
  @@map("integrations")
}

enum IntegrationType {
  SERVICENOW
  JIRA
  PAGERDUTY
  OPSGENIE
  SLACK
  TEAMS
  WEBHOOK
  SIEM_SPLUNK
  SIEM_DATADOG
  CMDB
}

// ============================================
// REPORTS
// ============================================

model Report {
  id             String       @id @default(cuid())
  organizationId String       @map("organization_id")

  name           String
  type           ReportType

  // Scope
  siteIds        String[]     @map("site_ids")
  assetIds       String[]     @map("asset_ids")

  // Schedule
  schedule       String?      // Cron expression
  timezone       String       @default("UTC")

  // Delivery
  format         ReportFormat @default(PDF)
  recipients     String[]

  lastGeneratedAt DateTime?   @map("last_generated_at")

  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  instances      ReportInstance[]

  @@index([organizationId])
  @@map("reports")
}

enum ReportType {
  UPTIME_SUMMARY
  INCIDENT_HISTORY
  CAPACITY_UTILIZATION
  ENERGY_CONSUMPTION
  BATTERY_HEALTH
  MAINTENANCE_SCHEDULE
  EXECUTIVE_SUMMARY
  CUSTOM
}

enum ReportFormat {
  PDF
  EXCEL
  CSV
}

model ReportInstance {
  id            String   @id @default(cuid())
  reportId      String   @map("report_id")

  periodStart   DateTime @map("period_start")
  periodEnd     DateTime @map("period_end")

  status        String   // "generating", "completed", "failed"
  fileUrl       String?  @map("file_url")
  fileSizeBytes Int?     @map("file_size_bytes")
  errorMessage  String?  @map("error_message")

  generatedAt   DateTime @default(now()) @map("generated_at")

  report        Report   @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@index([reportId])
  @@index([generatedAt])
  @@map("report_instances")
}

// ============================================
// AUDIT LOG
// ============================================

model AuditLog {
  id             String   @id @default(cuid())

  userId         String?  @map("user_id")
  organizationId String?  @map("organization_id")

  action         String   // "asset.create", "command.issue", "user.login"
  resourceType   String?  @map("resource_type")
  resourceId     String?  @map("resource_id")

  // Before/after state for changes
  oldValue       Json?    @map("old_value")
  newValue       Json?    @map("new_value")

  // Request context
  ipAddress      String?  @map("ip_address")
  userAgent      String?  @map("user_agent")
  requestId      String?  @map("request_id")

  timestamp      DateTime @default(now())

  user           User?    @relation(fields: [userId], references: [id])
  organization   Organization? @relation(fields: [organizationId], references: [id])

  @@index([organizationId])
  @@index([userId])
  @@index([action])
  @@index([resourceType, resourceId])
  @@index([timestamp])
  @@map("audit_logs")
}
```

---

## 10. API Specification

### 9.1 Authentication Endpoints

```typescript
// src/auth/auth.controller.ts

import { Controller, Post, Body, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, RefreshTokenDto, LogoutDto } from './dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * User login with email/password
   * Returns JWT access token and sets refresh token as HTTP-only cookie
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/auth/refresh',
    });

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      organization: result.organization,
    };
  }

  /**
   * Azure AD B2C callback for SSO login
   */
  @Post('azure/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Azure AD B2C SSO callback' })
  async azureCallback(
    @Body() dto: { idToken: string; accessToken: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginWithAzureAD(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth/refresh',
    });

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      organization: result.organization,
    };
  }

  /**
   * Refresh access token using refresh token from cookie
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies['refreshToken'];

    const result = await this.authService.refreshToken(refreshToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Rotate refresh token
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth/refresh',
    });

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    };
  }

  /**
   * Logout - revoke session and clear cookie
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout and revoke session' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies['refreshToken'];

    if (refreshToken) {
      await this.authService.revokeSession(refreshToken);
    }

    res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  }
}
```

### 9.2 Asset Endpoints

```typescript
// src/modules/assets/assets.controller.ts

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Paginate, PaginatedResult } from '@/common/pagination';
import { AssetsService } from './assets.service';
import {
  CreateAssetDto,
  UpdateAssetDto,
  AssetQueryDto,
  AssetResponseDto,
  AssetDetailResponseDto,
} from './dto';

@ApiTags('Assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  /**
   * List assets with filtering and pagination
   */
  @Get()
  @RequirePermissions('read:assets')
  @ApiOperation({ summary: 'List assets' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'siteId', required: false })
  @ApiQuery({ name: 'zoneId', required: false })
  @ApiQuery({ name: 'type', required: false, enum: ['UPS_SINGLE_PHASE', 'PDU_METERED'] })
  @ApiQuery({ name: 'status', required: false, enum: ['ONLINE', 'OFFLINE', 'ALARM'] })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @Query() query: AssetQueryDto,
    @Paginate() pagination: { page: number; limit: number },
  ): Promise<PaginatedResult<AssetResponseDto>> {
    return this.assetsService.findAll(query, pagination);
  }

  /**
   * Get single asset with full details
   */
  @Get(':id')
  @RequirePermissions('read:assets')
  @ApiOperation({ summary: 'Get asset by ID' })
  async findOne(@Param('id') id: string): Promise<AssetDetailResponseDto> {
    return this.assetsService.findOne(id);
  }

  /**
   * Create new asset
   */
  @Post()
  @RequirePermissions('write:assets')
  @ApiOperation({ summary: 'Create asset' })
  async create(
    @Body() dto: CreateAssetDto,
    @CurrentUser() user: { id: string },
  ): Promise<AssetResponseDto> {
    return this.assetsService.create(dto, user.id);
  }

  /**
   * Update existing asset
   */
  @Patch(':id')
  @RequirePermissions('write:assets')
  @ApiOperation({ summary: 'Update asset' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: { id: string },
  ): Promise<AssetResponseDto> {
    return this.assetsService.update(id, dto, user.id);
  }

  /**
   * Delete asset
   */
  @Delete(':id')
  @RequirePermissions('write:assets')
  @ApiOperation({ summary: 'Delete asset' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    return this.assetsService.remove(id, user.id);
  }

  /**
   * Get real-time telemetry for asset
   */
  @Get(':id/telemetry')
  @RequirePermissions('read:telemetry')
  @ApiOperation({ summary: 'Get asset telemetry' })
  @ApiQuery({ name: 'from', required: true, type: String })
  @ApiQuery({ name: 'to', required: true, type: String })
  @ApiQuery({ name: 'metrics', required: false, type: String })
  @ApiQuery({ name: 'interval', required: false, enum: ['1m', '5m', '15m', '1h', '1d'] })
  async getTelemetry(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('metrics') metrics?: string,
    @Query('interval') interval?: string,
  ) {
    return this.assetsService.getTelemetry(id, {
      from: new Date(from),
      to: new Date(to),
      metrics: metrics?.split(','),
      interval: interval ?? '5m',
    });
  }

  /**
   * Issue command to asset
   */
  @Post(':id/commands')
  @RequirePermissions('write:commands')
  @ApiOperation({ summary: 'Issue command to asset' })
  async issueCommand(
    @Param('id') id: string,
    @Body() dto: { type: string; parameters?: Record<string, unknown> },
    @CurrentUser() user: { id: string },
  ) {
    return this.assetsService.issueCommand(id, dto, user.id);
  }
}
```

---

## 11. Frontend Architecture

### 10.1 Project Structure

```
frontend/
├── src/
│   ├── main.tsx                    # Application entry
│   ├── App.tsx                     # Root component with routing
│   │
│   ├── api/                        # API client layer
│   │   ├── client.ts               # Axios instance with interceptors
│   │   ├── endpoints/
│   │   │   ├── auth.api.ts
│   │   │   ├── assets.api.ts
│   │   │   ├── alerts.api.ts
│   │   │   ├── telemetry.api.ts
│   │   │   └── commands.api.ts
│   │   └── types/
│   │       └── index.ts
│   │
│   ├── components/
│   │   ├── ui/                     # Base UI (shadcn/ui style)
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── select.tsx
│   │   │   ├── card.tsx
│   │   │   ├── table.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── toast.tsx
│   │   │   └── ...
│   │   │
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   ├── header.tsx
│   │   │   ├── page-container.tsx
│   │   │   └── breadcrumbs.tsx
│   │   │
│   │   ├── assets/
│   │   │   ├── asset-card.tsx
│   │   │   ├── asset-table.tsx
│   │   │   ├── asset-status-badge.tsx
│   │   │   ├── asset-health-gauge.tsx
│   │   │   └── asset-form.tsx
│   │   │
│   │   ├── telemetry/
│   │   │   ├── telemetry-chart.tsx
│   │   │   ├── live-metric.tsx
│   │   │   └── time-range-picker.tsx
│   │   │
│   │   ├── alerts/
│   │   │   ├── alert-list.tsx
│   │   │   ├── alert-card.tsx
│   │   │   └── alert-badge.tsx
│   │   │
│   │   └── dashboard/
│   │       ├── summary-cards.tsx
│   │       ├── site-map.tsx
│   │       └── alert-summary.tsx
│   │
│   ├── pages/
│   │   ├── dashboard/
│   │   │   └── index.tsx
│   │   ├── assets/
│   │   │   ├── index.tsx           # Asset list
│   │   │   ├── [id].tsx            # Asset detail
│   │   │   └── new.tsx             # Create asset
│   │   ├── alerts/
│   │   │   ├── index.tsx
│   │   │   └── rules.tsx
│   │   ├── settings/
│   │   │   └── index.tsx
│   │   └── auth/
│   │       ├── login.tsx
│   │       └── callback.tsx
│   │
│   ├── hooks/
│   │   ├── use-assets.ts           # React Query hooks
│   │   ├── use-alerts.ts
│   │   ├── use-telemetry.ts
│   │   ├── use-websocket.ts
│   │   └── use-auth.ts
│   │
│   ├── stores/
│   │   ├── auth.store.ts           # Zustand auth state
│   │   ├── ui.store.ts             # UI state (sidebar, theme)
│   │   └── realtime.store.ts       # Live telemetry cache
│   │
│   └── lib/
│       ├── utils.ts
│       ├── constants.ts
│       └── formatters.ts
│
├── e2e/                            # Playwright E2E tests
│   ├── auth.spec.ts
│   ├── assets.spec.ts
│   ├── alerts.spec.ts
│   └── fixtures/
│
├── tailwind.config.js
├── vite.config.ts
└── package.json
```

### 10.2 Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.2+ | UI framework |
| TypeScript | 5.3+ | Type safety |
| Vite | 5.0+ | Build tool |
| React Router | 6.20+ | Routing |
| Zustand | 4.4+ | Global state |
| TanStack Query | 5.0+ | Server state |
| TailwindCSS | 3.4+ | Styling |
| Radix UI | latest | Accessible primitives |
| Recharts | 2.10+ | Charts |
| React Hook Form | 7.48+ | Forms |
| Zod | 3.22+ | Validation |
| Socket.io Client | 4.7+ | Real-time |
| Playwright | 1.40+ | E2E testing |

---

## 12. Azure Infrastructure

### 11.1 Terraform Module Structure

```
infrastructure/
├── terraform/
│   ├── environments/
│   │   ├── dev/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── terraform.tfvars
│   │   └── prod/
│   │       ├── main.tf
│   │       ├── variables.tf
│   │       └── terraform.tfvars
│   │
│   └── modules/
│       ├── container-apps/
│       │   ├── main.tf
│       │   ├── variables.tf
│       │   └── outputs.tf
│       ├── postgresql/
│       ├── redis/
│       ├── iot-hub/
│       ├── data-explorer/
│       ├── storage/
│       ├── key-vault/
│       ├── front-door/
│       ├── ad-b2c/
│       └── monitoring/
```

### 11.2 Core Infrastructure (Terraform)

```hcl
# infrastructure/terraform/environments/dev/main.tf

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.85"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.47"
    }
  }

  backend "azurerm" {
    resource_group_name  = "ramp-terraform"
    storage_account_name = "rampterraformstate"
    container_name       = "tfstate"
    key                  = "dev.terraform.tfstate"
  }
}

provider "azurerm" {
  features {}
}

# Resource Group
resource "azurerm_resource_group" "main" {
  name     = "ramp-${var.environment}-rg"
  location = var.location

  tags = local.common_tags
}

# Container Apps Environment
module "container_apps" {
  source = "../../modules/container-apps"

  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  environment         = var.environment

  api_image           = var.api_image
  api_cpu             = 1.0
  api_memory          = "2Gi"
  api_min_replicas    = 1
  api_max_replicas    = 10

  environment_variables = {
    NODE_ENV            = var.environment
    DATABASE_URL        = module.postgresql.connection_string
    REDIS_URL           = module.redis.connection_string
    AZURE_IOT_HUB_HOST  = module.iot_hub.hostname
    AZURE_ADX_CLUSTER   = module.data_explorer.uri
    AZURE_ADX_DATABASE  = module.data_explorer.database_name
  }

  tags = local.common_tags
}

# PostgreSQL Flexible Server
module "postgresql" {
  source = "../../modules/postgresql"

  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  environment         = var.environment

  sku_name            = "GP_Standard_D2s_v3"
  storage_mb          = 32768

  admin_username      = "ramp_admin"
  admin_password      = var.db_admin_password

  databases           = ["ramp"]

  tags = local.common_tags
}

# Azure Cache for Redis
module "redis" {
  source = "../../modules/redis"

  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  environment         = var.environment

  sku_name            = "Standard"
  capacity            = 1

  tags = local.common_tags
}

# Azure IoT Hub
module "iot_hub" {
  source = "../../modules/iot-hub"

  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  environment         = var.environment

  sku_name            = "S1"
  sku_capacity        = 1

  # Route telemetry to Event Hub for processing
  routes = [
    {
      name       = "telemetry"
      source     = "DeviceMessages"
      condition  = "true"
      endpoint   = module.eventhub.endpoint_name
    }
  ]

  tags = local.common_tags
}

# Azure Data Explorer
module "data_explorer" {
  source = "../../modules/data-explorer"

  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  environment         = var.environment

  sku_name            = "Standard_E2ads_v5"
  sku_capacity        = 2

  database_name       = "telemetry"

  # Ingest from Event Hub
  eventhub_connection = module.eventhub.connection_string

  tags = local.common_tags
}

# Azure Front Door (CDN + WAF)
module "front_door" {
  source = "../../modules/front-door"

  resource_group_name = azurerm_resource_group.main.name
  environment         = var.environment

  origins = {
    api = {
      host = module.container_apps.api_fqdn
      path = "/api"
    }
    frontend = {
      host = module.storage.static_web_endpoint
      path = "/"
    }
  }

  waf_policy_mode = "Prevention"

  tags = local.common_tags
}

# Key Vault
module "key_vault" {
  source = "../../modules/key-vault"

  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  environment         = var.environment

  secrets = {
    "database-url"    = module.postgresql.connection_string
    "redis-url"       = module.redis.connection_string
    "jwt-secret"      = var.jwt_secret
    "iot-hub-key"     = module.iot_hub.primary_key
  }

  tags = local.common_tags
}

# Monitoring
module "monitoring" {
  source = "../../modules/monitoring"

  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  environment         = var.environment

  # Application Insights
  app_insights_name   = "ramp-${var.environment}-insights"

  # Log Analytics
  log_analytics_sku   = "PerGB2018"
  retention_days      = 30

  # Alert rules
  alert_rules = [
    {
      name        = "high-error-rate"
      description = "API error rate > 5%"
      severity    = 1
      query       = "requests | where resultCode >= 500 | summarize count() by bin(timestamp, 5m)"
      threshold   = 10
    }
  ]

  tags = local.common_tags
}

locals {
  common_tags = {
    Project     = "RAMP"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}
```

---

## 13. E2E Testing Strategy

### 12.1 Test Structure

```
e2e/
├── fixtures/
│   ├── auth.fixture.ts           # Authentication helpers
│   ├── data.fixture.ts           # Test data factories
│   └── api.fixture.ts            # API mocking/seeding
│
├── pages/                        # Page Object Model
│   ├── login.page.ts
│   ├── dashboard.page.ts
│   ├── assets.page.ts
│   └── alerts.page.ts
│
├── specs/
│   ├── auth/
│   │   ├── login.spec.ts
│   │   ├── logout.spec.ts
│   │   └── session.spec.ts
│   │
│   ├── assets/
│   │   ├── asset-list.spec.ts
│   │   ├── asset-create.spec.ts
│   │   ├── asset-detail.spec.ts
│   │   └── asset-delete.spec.ts
│   │
│   ├── alerts/
│   │   ├── alert-list.spec.ts
│   │   ├── alert-acknowledge.spec.ts
│   │   └── alert-resolve.spec.ts
│   │
│   ├── telemetry/
│   │   ├── live-data.spec.ts
│   │   └── historical-data.spec.ts
│   │
│   └── commands/
│       ├── issue-command.spec.ts
│       └── command-history.spec.ts
│
├── playwright.config.ts
└── global-setup.ts
```

### 12.2 Example E2E Test

```typescript
// e2e/specs/assets/asset-create.spec.ts

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/login.page';
import { AssetsPage } from '../../pages/assets.page';
import { createTestAssetData } from '../../fixtures/data.fixture';

test.describe('Asset Creation', () => {
  let loginPage: LoginPage;
  let assetsPage: AssetsPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    assetsPage = new AssetsPage(page);

    // Login as technician (has write:assets permission)
    await loginPage.login('technician@example.com', 'password');
    await assetsPage.goto();
  });

  test('should create a new UPS asset with required fields', async ({ page }) => {
    const assetData = createTestAssetData({
      assetType: 'UPS_SINGLE_PHASE',
    });

    // Click create button
    await assetsPage.clickCreateAsset();

    // Fill form
    await assetsPage.fillAssetForm({
      name: assetData.name,
      assetType: assetData.assetType,
      siteId: assetData.siteId,
      serialNumber: assetData.serialNumber,
    });

    // Submit
    await assetsPage.submitAssetForm();

    // Verify success
    await expect(page.getByText('Asset created successfully')).toBeVisible();

    // Verify asset appears in list
    await expect(page.getByTestId(`asset-card-${assetData.name}`)).toBeVisible();
  });

  test('should show validation errors for missing required fields', async ({ page }) => {
    await assetsPage.clickCreateAsset();

    // Submit without filling required fields
    await assetsPage.submitAssetForm();

    // Verify validation errors
    await expect(page.getByText('Name is required')).toBeVisible();
    await expect(page.getByText('Asset type is required')).toBeVisible();
    await expect(page.getByText('Site is required')).toBeVisible();
  });

  test('should connect asset to IoT Hub device', async ({ page }) => {
    const assetData = createTestAssetData({
      assetType: 'UPS_SINGLE_PHASE',
      deviceId: 'test-device-001',
    });

    await assetsPage.clickCreateAsset();

    await assetsPage.fillAssetForm({
      name: assetData.name,
      assetType: assetData.assetType,
      siteId: assetData.siteId,
      deviceId: assetData.deviceId,
    });

    await assetsPage.submitAssetForm();

    // Verify device connection
    await page.getByTestId(`asset-card-${assetData.name}`).click();
    await expect(page.getByText('Connected to IoT Hub')).toBeVisible();
    await expect(page.getByText(assetData.deviceId)).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    // Cleanup: Delete created assets
    // This would use API to clean up test data
  });
});
```

### 12.3 E2E Failure → Jira Automation

```typescript
// ci/e2e-jira-reporter.ts

import JiraClient from 'jira-client';
import { TestResult, FullConfig } from '@playwright/test/reporter';

interface E2EFailureReport {
  testName: string;
  testFile: string;
  errorMessage: string;
  stackTrace: string;
  screenshot?: string;
  video?: string;
}

export class E2EJiraReporter {
  private jira: JiraClient;
  private config: FullConfig;

  constructor(config: FullConfig) {
    this.config = config;
    this.jira = new JiraClient({
      host: process.env.JIRA_HOST,
      basic_auth: {
        email: process.env.JIRA_EMAIL,
        api_token: process.env.JIRA_API_TOKEN,
      },
    });
  }

  async onTestEnd(test: TestResult): Promise<void> {
    if (test.status === 'failed') {
      await this.createJiraTicket({
        testName: test.title,
        testFile: test.location?.file ?? 'unknown',
        errorMessage: test.error?.message ?? 'Unknown error',
        stackTrace: test.error?.stack ?? '',
        screenshot: test.attachments.find(a => a.name === 'screenshot')?.path,
        video: test.attachments.find(a => a.name === 'video')?.path,
      });
    }
  }

  private async createJiraTicket(failure: E2EFailureReport): Promise<string> {
    // Determine persona based on test file path
    const persona = this.getPersonaForTest(failure.testFile);

    const ticket = await this.jira.addNewIssue({
      fields: {
        project: { key: 'RAMP' },
        issuetype: { name: 'Bug' },
        summary: `E2E Failure: ${failure.testName}`,
        description: this.formatDescription(failure),
        labels: ['workermill', 'e2e-failure', 'auto-generated', persona],
        priority: { name: 'High' },
        customfield_10001: failure.testFile,      // Failed Test File
        customfield_10002: failure.errorMessage,  // Error Message
        customfield_10003: failure.stackTrace,    // Stack Trace
      },
    });

    console.log(`Created Jira ticket: ${ticket.key}`);
    return ticket.key;
  }

  private getPersonaForTest(testFile: string): string {
    const mapping: Record<string, string> = {
      'auth': 'backend_developer',
      'assets': 'backend_developer',
      'alerts': 'backend_developer',
      'telemetry': 'backend_developer',
      'commands': 'backend_developer',
      'dashboard': 'frontend_developer',
      'ui': 'frontend_developer',
      'infrastructure': 'devops_engineer',
      'security': 'security_engineer',
    };

    for (const [pattern, persona] of Object.entries(mapping)) {
      if (testFile.includes(pattern)) {
        return persona;
      }
    }

    return 'backend_developer';
  }

  private formatDescription(failure: E2EFailureReport): string {
    return `
h2. E2E Test Failure

*Test Name:* ${failure.testName}
*Test File:* ${failure.testFile}

h3. Error Message
{code}
${failure.errorMessage}
{code}

h3. Stack Trace
{code}
${failure.stackTrace}
{code}

h3. Reproduction Steps
1. Run the E2E test suite
2. Execute test: ${failure.testName}
3. Observe the failure

h3. Expected Behavior
The test should pass.

h3. Actual Behavior
The test failed with the error above.

${failure.screenshot ? `h3. Screenshot\n!${failure.screenshot}!` : ''}

---
_This ticket was auto-generated by the E2E test failure handler._
_Label: workermill - Auto-assigned to WorkerMill for resolution._
`;
  }
}
```

### 12.4 GitHub Actions E2E Workflow

```yaml
# .github/workflows/e2e.yml

name: E2E Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  workflow_dispatch:

env:
  AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
  AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
  AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
  AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: |
          cd frontend
          npm ci
          npx playwright install --with-deps

      - name: Deploy to Azure Dev
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: |
          cd infrastructure/terraform/environments/dev
          terraform init
          terraform apply -auto-approve

      - name: Run E2E Tests
        id: e2e
        continue-on-error: true
        run: |
          cd frontend
          npm run test:e2e
        env:
          PLAYWRIGHT_BASE_URL: ${{ secrets.DEV_BASE_URL }}
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}

      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: frontend/playwright-report/
          retention-days: 7

      - name: Create Jira Tickets for Failures
        if: steps.e2e.outcome == 'failure'
        run: |
          cd ci
          npx ts-node e2e-jira-reporter.ts
        env:
          JIRA_HOST: ${{ secrets.JIRA_HOST }}
          JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}
          JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}

      - name: Fail if Tests Failed
        if: steps.e2e.outcome == 'failure'
        run: exit 1
```

---

## 14. Device Simulator Integration

### 13.1 Simulator Configuration

The device simulator (provided separately) connects to Azure IoT Hub and generates telemetry data for testing.

```typescript
// Expected simulator interface (provided by project owner)

interface SimulatorConfig {
  iotHubConnectionString: string;
  deviceCount: number;

  // Asset types to simulate
  assetTypes: AssetType[];

  // Telemetry generation settings
  telemetry: {
    intervalMs: number;           // How often to send telemetry
    metrics: MetricConfig[];      // Which metrics to generate
  };

  // Scenarios to run
  scenarios?: SimulatorScenario[];
}

interface MetricConfig {
  name: string;
  unit: string;
  min: number;
  max: number;
  variance: number;              // Random variance percentage
  trend?: 'stable' | 'increasing' | 'decreasing';
}

interface SimulatorScenario {
  name: string;
  trigger: 'manual' | 'scheduled' | 'random';
  actions: ScenarioAction[];
}

interface ScenarioAction {
  type: 'set_metric' | 'disconnect' | 'reconnect' | 'send_alert';
  deviceId?: string;
  metric?: string;
  value?: number;
  duration?: number;
}
```

### 13.2 Integration with E2E Tests

```typescript
// e2e/fixtures/simulator.fixture.ts

import { SimulatorClient } from '@ramp/simulator-client';

export class SimulatorFixture {
  private client: SimulatorClient;

  constructor() {
    this.client = new SimulatorClient({
      apiUrl: process.env.SIMULATOR_API_URL,
      apiKey: process.env.SIMULATOR_API_KEY,
    });
  }

  /**
   * Start simulating a device with specific characteristics
   */
  async startDevice(config: {
    deviceId: string;
    assetType: string;
    initialMetrics?: Record<string, number>;
  }): Promise<void> {
    await this.client.startDevice(config);
  }

  /**
   * Trigger a specific scenario (e.g., power failure, battery low)
   */
  async triggerScenario(
    deviceId: string,
    scenario: 'power_failure' | 'battery_low' | 'overload' | 'temp_high',
  ): Promise<void> {
    await this.client.triggerScenario(deviceId, scenario);
  }

  /**
   * Set a specific metric value
   */
  async setMetric(
    deviceId: string,
    metric: string,
    value: number,
  ): Promise<void> {
    await this.client.setMetric(deviceId, metric, value);
  }

  /**
   * Stop a simulated device
   */
  async stopDevice(deviceId: string): Promise<void> {
    await this.client.stopDevice(deviceId);
  }

  /**
   * Stop all simulated devices
   */
  async stopAll(): Promise<void> {
    await this.client.stopAll();
  }
}

// Usage in E2E test
test('should show alert when battery drops below threshold', async ({ page }) => {
  const simulator = new SimulatorFixture();

  // Start device with normal battery
  await simulator.startDevice({
    deviceId: 'test-ups-001',
    assetType: 'UPS_SINGLE_PHASE',
    initialMetrics: { 'battery.chargeLevel': 90 },
  });

  // Navigate to asset detail
  await page.goto('/assets/test-ups-001');

  // Verify normal status
  await expect(page.getByTestId('battery-status')).toHaveText('90%');
  await expect(page.getByTestId('asset-status')).toHaveText('Online');

  // Trigger low battery scenario
  await simulator.triggerScenario('test-ups-001', 'battery_low');

  // Wait for alert to appear (via WebSocket)
  await expect(page.getByTestId('alert-banner')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('alert-banner')).toContainText('Battery Low');

  // Cleanup
  await simulator.stopDevice('test-ups-001');
});
```

---

## 15. Deployment Pipeline

### 14.1 GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml

name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy to'
        required: true
        default: 'dev'
        type: choice
        options:
          - dev
          - staging
          - prod

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # Build and test
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linting
        run: npm run lint

      - name: Run type check
        run: npm run typecheck

      - name: Run unit tests
        run: npm run test

      - name: Build API
        run: npm run build:api

      - name: Build Frontend
        run: npm run build:frontend

  # Build Docker image
  docker:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push API image
        uses: docker/build-push-action@v5
        with:
          context: ./api
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/api:${{ github.sha }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/api:latest

  # Deploy to Azure
  deploy:
    needs: docker
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment || 'dev' }}

    steps:
      - uses: actions/checkout@v4

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy to Container Apps
        run: |
          az containerapp update \
            --name ramp-${{ github.event.inputs.environment || 'dev' }}-api \
            --resource-group ramp-${{ github.event.inputs.environment || 'dev' }}-rg \
            --image ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/api:${{ github.sha }}

      - name: Deploy Frontend to Storage
        run: |
          az storage blob upload-batch \
            --account-name ramp${{ github.event.inputs.environment || 'dev' }}storage \
            --destination '$web' \
            --source ./frontend/dist \
            --overwrite

      - name: Purge CDN
        run: |
          az cdn endpoint purge \
            --resource-group ramp-${{ github.event.inputs.environment || 'dev' }}-rg \
            --profile-name ramp-${{ github.event.inputs.environment || 'dev' }}-cdn \
            --name ramp-${{ github.event.inputs.environment || 'dev' }} \
            --content-paths "/*"

  # Run E2E tests after deployment
  e2e:
    needs: deploy
    uses: ./.github/workflows/e2e.yml
    with:
      environment: ${{ github.event.inputs.environment || 'dev' }}
    secrets: inherit
```

---

## Summary: Execution Checklist

### How Execution Works

1. **Stories created with blocking dependencies** - Only unblocked stories get `workermill` label
2. **Workers claim stories automatically** - Pick up labeled stories based on persona
3. **CI validates every PR** - Static analysis, unit, integration, contract tests
4. **Pass → auto-merge, mark Done, unblock dependents**
5. **Fail → auto-create fix ticket with context, same persona**
6. **Circuit breaker after 3 failures → human review required**

### Phase 1: Foundation
- [ ] RAMP-2: Repository setup, CI/CD *(devops_engineer)*
- [ ] RAMP-3: Azure infrastructure (Terraform) *(devops_engineer)*
- [ ] RAMP-4: Database schema & migrations *(backend_developer)*
- [ ] RAMP-5: Development environment *(devops_engineer)*
- [ ] RAMP-90: Test infrastructure & validation setup *(devops_engineer)*
- [ ] **Gate: Infrastructure health checks pass**

### Phase 2: Authentication
- [ ] RAMP-11: Azure AD B2C integration *(backend_developer)*
- [ ] RAMP-12: JWT token implementation *(backend_developer)*
- [ ] RAMP-13: Multi-tenant middleware *(backend_developer)*
- [ ] RAMP-14: RBAC permission system *(security_engineer)*
- [ ] RAMP-15: API key management *(backend_developer)*
- [ ] RAMP-91: Phase gate tests - auth *(qa_engineer)*
- [ ] **Gate: Auth E2E tests pass**

### Phase 3: Core API (Demo-Ready)
- [ ] RAMP-21-25: Asset management API *(backend_developer)*
- [ ] RAMP-41-45: Alerting system (config only) *(backend_developer)*
- [ ] RAMP-51,53,54: Command queue system *(backend_developer)*
- [ ] RAMP-92: Phase gate tests - API *(qa_engineer)*
- [ ] **Gate: API E2E tests pass**

### Phase 4: Frontend (Demo-Ready)
- [ ] RAMP-61-67: React dashboard *(frontend_developer)*
- [ ] RAMP-71-74: Reporting *(backend_developer + frontend_developer)*
- [ ] RAMP-93: Demo data seeding *(backend_developer)*
- [ ] RAMP-94: Demo-ready validation *(qa_engineer)*
- [ ] **Gate: Full demo script walkthrough passes**

### 🎯 DEMO-READY MILESTONE

At this point, the platform is fully demonstrable:
- Complete dashboard with seeded data
- All CRUD operations working
- Alert management (manual alerts)
- Command queue (submissions only)
- Reports generating
- 70%+ E2E coverage

**No simulator required for demo.**

---

### Phase 5: Real-Time Integration (Requires Simulator)
- [ ] RAMP-31-35: IoT Hub & telemetry *(backend_developer + devops_engineer)*
- [ ] RAMP-52: IoT Hub direct methods *(backend_developer)*
- [ ] RAMP-95: Full E2E test suite *(qa_engineer)*
- [ ] **Gate: Live telemetry E2E tests pass**

---

## Pre-Flight Checklist

Before starting WorkerMill execution:

- [ ] GitHub repository `jarod-rosenthal/remote-monitoring` created
- [ ] Jira project `RAMP` created with custom fields configured
- [ ] Jira components created (backend, frontend, infrastructure, security, testing)
- [ ] Azure credentials stored in GitHub Secrets
- [ ] Slack webhook configured for #ramp-alerts
- [ ] All stories created with blocking dependencies
- [ ] Only Phase 1 stories have `workermill` label initially

---

**This PRD is ready for WorkerMill execution.** The autonomous validation system ensures:

1. **No human intervention needed** for normal iteration
2. **Automatic fix tickets** when tests fail
3. **Circuit breaker protection** prevents infinite loops
4. **Phase gates** ensure foundations are solid before building on top
5. **Demo-ready milestone** provides value without waiting for simulator
