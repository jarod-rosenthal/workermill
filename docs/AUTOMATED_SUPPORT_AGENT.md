# Automated AI Support Agent

This document outlines the design for automating WorkerMill's support system using an AI-powered support agent that runs on the WorkerMill orchestration platform.

## Executive Summary

WorkerMill has a production-ready support ticket system with database models, API routes, email integration, and frontend UI. This design adds an AI support agent persona that automatically handles incoming support tickets, providing instant responses while escalating complex or sensitive issues to humans.

**Goals:**
- Respond to support tickets within 90 seconds (vs hours for humans)
- Auto-handle 60-70% of tickets without human intervention
- Maintain professional, courteous, and accurate responses
- Escalate appropriately when human judgment is needed

---

## Current Support System

### Data Models

**SupportTicket** (`api/src/models/SupportTicket.ts`)
- UUID primary key with human-readable `ticketKey` (SUP-001, SUP-002, etc.)
- Status workflow: `open` → `in_progress` → `waiting` → `resolved` → `closed`
- Priority levels: `low`, `medium`, `high`, `urgent`
- Categories: `general`, `billing`, `technical`, `feature_request`, `bug_report`
- Multi-tenant via `orgId`

**SupportTicketMessage** (`api/src/models/SupportTicketMessage.ts`)
- Threaded conversations with rich metadata
- `isInternal`: Internal-only notes (hidden from customers)
- `isFromSupport`: Distinguishes support responses from customer messages
- `attachments`: JSONB array of file references

### API Routes (`api/src/routes/support.ts`)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/support/tickets` | List with filtering |
| `GET /api/support/tickets/:id` | Fetch with full message thread |
| `POST /api/support/tickets` | Create new ticket |
| `PATCH /api/support/tickets/:id` | Update status/priority/assignment |
| `POST /api/support/tickets/:id/messages` | Add message/reply |
| `GET /api/support/stats` | Admin analytics |

### Email Integration

- AWS SES with branded HTML templates
- `sendSupportTicketEmail()` handles: `created`, `updated`, `reply` events
- Reply address: `support+{ticketKey}@workermill.com`

---

## Support Agent Design

### Persona Structure

Create new persona at `worker/directives/support_agent/`:

```
worker/directives/support_agent/
├── README.md                    # Role definition & context
├── categorization.md            # How to analyze ticket category
├── response-templates.md        # Standard response patterns
├── escalation-rules.md          # When to escalate to human
├── knowledge-base.md            # FAQ, common issues, troubleshooting
└── quality-checks.md            # Self-review criteria
```

### Agent Configuration

```typescript
{
  personaId: "support_agent",
  displayName: "Support Agent",
  maxConcurrentWorkers: 5,      // Handle multiple tickets in parallel
  cooldownSeconds: 0,            // No cooldown between tickets
  timeoutMinutes: 10,            // Short timeout per ticket
  models: {
    default: "claude-haiku-4-5", // Fast/cheap for support responses
    complex: "claude-sonnet-4"   // Upgrade for complex cases
  }
}
```

### Knowledge Base Context

The agent receives pre-loaded context about:

1. **Platform Overview**: Workers, personas, tasks, orchestration, log streaming
2. **Common Support Topics**:
   - Task failures (log analysis, exit codes, Spot interruptions)
   - Worker timeouts (causes and solutions)
   - PR creation issues (branch conflicts, rate limits, permissions)
   - Billing questions (always escalate)
3. **Documentation Links**: API docs, troubleshooting guide, pricing, status page
4. **Escalation Protocol**: When and how to hand off to humans

---

## Ticket Flow with AI Agent

### Trigger: New Support Ticket

```
User Creates Ticket
    ↓
API generates ticketKey (SUP-NNN)
API stores ticket + sends confirmation email
    ↓
Webhook → POST /api/webhooks/support
    ↓
Create WorkerTask:
{
  jiraIssueKey: "SUP-042",
  workerPersona: "support_agent",
  workerModel: "haiku-4-5",
  status: "queued",
  sourceType: "support_ticket",
  sourceId: "ticket-uuid",
  metadata: {
    ticketId, ticketKey, category, priority, customerEmail
  }
}
    ↓
Orchestrator claims task → Spawns ECS container
    ↓
Support Agent:
1. Fetches full ticket context
2. Analyzes category and content
3. Checks escalation criteria
4. Generates response OR escalates
5. Posts message via API
6. Updates ticket status
```

### Escalation Decision Tree

```
┌─ Ticket Created
│
├─ Category = "billing" → ESCALATE (human only)
│
├─ Customer says "need human" → ESCALATE
│
├─ Priority = "urgent" → ESCALATE
│
├─ Ticket age > 24h in "open" → ESCALATE
│
├─ Previous messages > 5 without resolution → ESCALATE
│
├─ Account-level concern (permissions, security) → ESCALATE
│
└─ Category = "general" or "technical" or "feature_request"
   │
   └─ → ATTEMPT AI RESPONSE
       │
       ├─ Confidence < 70% → FLAG + ESCALATE
       │
       └─ Confidence >= 70% → POST RESPONSE
```

### Escalation Handoff Format

When escalating, the agent adds an internal note:

```markdown
## AI Support Agent Analysis

**Escalation Reason**: [Billing question | Account-level | High priority | etc.]

**AI Assessment**:
- Ticket Category: technical
- Root Cause: [agent's analysis]
- Attempted Solutions: [what was tried]
- Confidence Score: 65%

**Recommendation**: This requires manual attention because [reason]

**Customer Context**: [relevant history from conversation]
```

---

## Response Time Expectations

### Target SLAs

| Priority | AI Response | Human Escalation |
|----------|-------------|------------------|
| Urgent | 60 seconds | Immediate |
| High | 90 seconds | 1 hour |
| Medium | 90 seconds | 4 hours |
| Low | 90 seconds | 24 hours |

### Performance Breakdown

| Phase | Duration |
|-------|----------|
| Fetch ticket context | ~2 seconds |
| Generate response | 20-60 seconds |
| Post message via API | ~2 seconds |
| **Total** | **30-90 seconds** |

---

## Implementation Plan

### Phase 1: Foundation (Week 1-2)

1. Create `support_agent` persona in `worker/directives/`
2. Build knowledge base and escalation rules
3. Add webhook at support ticket creation (`POST /api/webhooks/support`)
4. Create WorkerTask from support ticket
5. Basic error handling and logging

### Phase 2: Core Agent (Week 2-3)

1. Implement ticket analysis and categorization
2. Draft response generation for each category
3. Message API integration (POST to ticket thread)
4. Status/assignment updates
5. Escalation decision logic

### Phase 3: Refinement (Week 3-4)

1. Accuracy improvements (test against real tickets)
2. Confidence scoring mechanism
3. Human review workflow
4. Analytics dashboard integration
5. Testing with staging tickets

### Phase 4: Production (Week 4+)

1. Gradual rollout (10% of new tickets initially)
2. Monitor accuracy and escalation rates
3. Gather feedback from support team
4. Iterate on response quality
5. Expand to 100% of applicable tickets

---

## Technical Requirements

### Database Changes

```sql
ALTER TABLE support_tickets ADD COLUMN (
  auto_response_attempted BOOLEAN DEFAULT FALSE,
  ai_confidence_score NUMERIC(3,2),
  ai_escalation_reason VARCHAR(255),
  ai_model_used VARCHAR(50)
);

CREATE INDEX idx_support_auto_response
  ON support_tickets(auto_response_attempted, status);
```

### New API Endpoint

```typescript
// POST /api/webhooks/support
// Receives new ticket events, creates WorkerTask
router.post("/webhooks/support", async (req, res) => {
  const { ticketId, ticketKey, category, priority, orgId } = req.body;

  // Skip billing tickets
  if (category === "billing") {
    return res.status(200).json({ skipped: true, reason: "billing" });
  }

  // Create support agent task
  const task = await createSupportAgentTask({
    ticketId,
    ticketKey,
    category,
    priority,
    orgId
  });

  return res.status(202).json({ taskId: task.id });
});
```

### Environment Variables

```bash
# Support Agent Configuration
SUPPORT_AGENT_ENABLED=true
SUPPORT_AUTO_RESPONSE_CATEGORIES=general,technical,feature_request
SUPPORT_ESCALATION_PRIORITY=urgent
SUPPORT_ESCALATION_AGE_HOURS=24
```

---

## Success Metrics

### Efficiency KPIs

| Metric | Target |
|--------|--------|
| Response time | < 90 seconds |
| Auto-response coverage | > 60% of tickets |
| Throughput | 100+ tickets/day |

### Quality KPIs

| Metric | Target |
|--------|--------|
| Diagnosis accuracy | > 85% |
| False escalation rate | < 20% |
| Customer satisfaction | > 4.0/5.0 |

### Business KPIs

| Metric | Target |
|--------|--------|
| Support cost reduction | 40% fewer human hours |
| Mean time to resolution | 30% faster |
| First-contact resolution | > 70% |

---

## Analytics Dashboard

Add support agent metrics to analytics:

```typescript
{
  totalTickets: 157,
  autoResponded: 98,           // 62%
  escalated: 59,               // 38%
  avgResponseTimeMs: 45000,
  avgResolutionTimeH: 2.5,
  accuracyScore: 0.87,
  byCategory: {
    general: { total: 45, autoResponded: 38, escalated: 7 },
    technical: { total: 68, autoResponded: 50, escalated: 18 },
    feature_request: { total: 22, autoResponded: 8, escalated: 14 },
    billing: { total: 22, autoResponded: 0, escalated: 22 }
  }
}
```

### Alerts to Configure

- Escalation rate > 50% (agent issues)
- Accuracy score < 80% (retraining needed)
- Tickets stuck in "waiting" > 48 hours
- Queue > 10 unassigned open tickets

---

## Risk Mitigation

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Incorrect troubleshooting | Customer frustration | Confidence scoring, human review tier |
| Billing auto-response | Compliance risk | Category whitelist, strict escalation |
| Response quality varies | Reputation damage | Regular audits, model testing |
| Escalation bottleneck | Team overwhelmed | Rate limiting, analytics monitoring |

### Safety Measures

1. **Human Approval Layer** (optional for initial rollout)
   - All AI responses go to queue for review before posting
   - Support team approves/rejects within 5 minutes
   - After 95%+ approval rate for 2 weeks, enable auto-post

2. **Confidence Thresholds**
   - Only auto-post if confidence > 80%
   - Flag lower-confidence responses for human review

3. **Progressive Rollout**
   - Start with `general` category only
   - Monitor for 1 week
   - Add `technical` if < 5% escalation rate

4. **Regular Audits**
   - Weekly: Sample 10 auto-responses, check accuracy
   - Monthly: Full analytics review, retrain if needed

---

## Architecture Decision: WorkerTask vs Lambda

| Approach | Pros | Cons |
|----------|------|------|
| **WorkerTask (ECS)** | Uses existing orchestration, full logging, persona system | ~30s cold start, higher cost per ticket |
| **Lambda (serverless)** | <5s response, cheaper at scale | New infrastructure, no log streaming |

**Decision**: Start with WorkerTask approach to leverage existing infrastructure. Optimize to Lambda later if cost becomes an issue at high volume.

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `worker/directives/support_agent/README.md` | Create | Persona definition |
| `worker/directives/support_agent/knowledge-base.md` | Create | Platform knowledge |
| `worker/directives/support_agent/escalation-rules.md` | Create | Escalation criteria |
| `worker/directives/support_agent/response-templates.md` | Create | Response patterns |
| `api/src/routes/webhooks.ts` | Modify | Add support webhook handler |
| `api/src/services/orchestrator.ts` | Modify | Handle support_ticket sourceType |
| `api/src/db/migrations/xxx-AddSupportAIColumns.ts` | Create | AI tracking columns |
| `frontend/src/pages/Analytics.tsx` | Modify | Add support agent metrics |

---

## Next Steps

1. Review and approve this design
2. Create support_agent persona with initial knowledge base
3. Implement webhook trigger
4. Test with sample tickets in staging
5. Gradual production rollout
