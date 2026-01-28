# Escalation Rules

This document defines when and how to escalate support tickets to human support staff.

## Golden Rule

**When in doubt, escalate.** It's better to involve a human than to provide incorrect information or leave a customer frustrated.

## Mandatory Escalation (Always Escalate)

These categories MUST be escalated immediately. Do not attempt to resolve.

### 1. Billing & Payments

- Payment method issues
- Invoice questions
- Refund requests
- Usage overage disputes
- Pricing questions beyond public info
- Subscription changes
- Discount or promo codes
- Enterprise pricing

**Why:** Financial matters require human judgment and access to billing systems.

### 2. Account Security

- Account access issues
- Password reset problems
- Suspicious activity reports
- Unauthorized access claims
- Two-factor authentication issues
- Session hijacking concerns

**Why:** Security issues need immediate human attention and may require account lockdown.

### 3. Data & Privacy

- Data deletion requests (GDPR, CCPA)
- Data export requests
- Privacy concerns
- Compliance questions
- Audit log requests

**Why:** Legal and compliance requirements need human oversight.

### 4. Legal & Contractual

- Terms of service questions
- SLA disputes
- Contract modifications
- Legal threats or notices
- Regulatory inquiries

**Why:** Legal matters require appropriate human handling.

### 5. Explicit Human Request

Any message containing:
- "speak to a human"
- "talk to a person"
- "real person"
- "human support"
- "escalate this"
- "manager"
- "supervisor"

**Why:** Customer explicitly requested human interaction.

## Conditional Escalation (Evaluate First)

These situations may require escalation based on context.

### 1. Priority Level

| Priority | Action |
|----------|--------|
| `urgent` | Escalate immediately |
| `high` | Attempt response, escalate if confidence < 80% |
| `medium` | Standard handling |
| `low` | Standard handling |

### 2. Ticket Age

| Age | Action |
|-----|--------|
| < 4 hours | Standard handling |
| 4-24 hours | Flag for review, prioritize response |
| > 24 hours | Escalate with urgency note |

### 3. Conversation Length

| Messages | Action |
|----------|--------|
| 1-3 | Standard handling |
| 4-5 | Consider escalation, add internal note |
| > 5 | Escalate - issue not being resolved |

### 4. Confidence Score

| Confidence | Action |
|------------|--------|
| > 80% | Respond directly |
| 60-80% | Respond with disclaimer, flag for review |
| < 60% | Escalate - insufficient confidence |

### 5. Technical Complexity

Escalate if issue involves:
- Multiple interconnected systems
- Infrastructure-level problems
- Performance issues requiring log analysis
- Bugs requiring code fixes
- Database or data integrity issues

## Category-Based Routing

### General Inquiries
- **Auto-respond:** Yes
- **Escalation triggers:** None specific
- **Examples:** How does X work? What can WorkerMill do?

### Technical Issues
- **Auto-respond:** Yes, with troubleshooting steps
- **Escalation triggers:** Unresolved after troubleshooting, infrastructure issues
- **Examples:** Task failed, PR not created, logs not appearing

### Feature Requests
- **Auto-respond:** Yes, acknowledge and document
- **Escalation triggers:** Enterprise feature requests, custom development
- **Examples:** Can you add X feature? I wish Y worked differently

### Bug Reports
- **Auto-respond:** Yes, triage and document
- **Escalation triggers:** Data loss, security bugs, critical functionality
- **Examples:** Found a bug where X happens

### Billing (Always Escalate)
- **Auto-respond:** No
- **Escalation triggers:** All tickets in this category
- **Examples:** Any payment, invoice, pricing question

## Escalation Process

### Step 1: Determine Escalation Needed

Run through this checklist:
```
[ ] Is this billing/payment related? → ESCALATE
[ ] Is this account security? → ESCALATE
[ ] Is this data/privacy? → ESCALATE
[ ] Is this legal/contractual? → ESCALATE
[ ] Did customer request human? → ESCALATE
[ ] Is priority urgent? → ESCALATE
[ ] Is ticket age > 24 hours? → ESCALATE
[ ] Are there > 5 messages? → ESCALATE
[ ] Is my confidence < 60%? → ESCALATE
```

### Step 2: Add Internal Note

Before escalating, add an internal note with:

```markdown
## AI Support Agent Escalation

**Escalation Reason:** [Primary reason from checklist]

**Ticket Summary:**
- Category: [category]
- Priority: [priority]
- Age: [hours since creation]
- Messages: [count]

**AI Analysis:**
[Your understanding of the issue]

**Attempted Actions:**
[What you've done or considered]

**Confidence Score:** [0-100]%

**Recommendation:**
[What you think human support should do]

**Customer Sentiment:**
[Frustrated / Neutral / Positive]
```

### Step 3: Notify Customer

Send a brief message:

```
Hi [Name],

Thank you for your patience. I'm escalating your request to our support team
for priority handling. A team member will follow up with you shortly.

In the meantime, is there anything else I can help clarify?

Best regards,
WorkerMill Support
```

### Step 4: Update Ticket

- Set status to `in_progress`
- Set `assignedTo` to support team
- Add appropriate priority if not already set
- Output marker: `::escalate::[reason]`

## De-escalation (Human → AI)

Human support may de-escalate tickets back to AI when:
- Initial concern resolved, follow-up is routine
- Customer confirmed satisfied with resolution
- Remaining questions are FAQ-level

## Escalation Metrics

Track these metrics to improve:
- Escalation rate by category
- False escalation rate (human resolves with simple answer)
- Time to escalation
- Customer satisfaction post-escalation

Target: < 40% escalation rate overall, < 5% false escalation rate.

## Examples

### Example 1: Should Escalate

**Ticket:** "I was charged twice for my subscription last month"

**Decision:** ESCALATE
- Category: Billing
- Mandatory escalation rule applies
- Add internal note with billing details customer provided

### Example 2: Should NOT Escalate

**Ticket:** "My task has been running for 2 hours, is this normal?"

**Decision:** Do not escalate
- Category: Technical
- Standard troubleshooting applies
- Provide explanation of task execution and diagnostic steps

### Example 3: Conditional Escalation

**Ticket:** "I keep getting errors when I try to connect GitHub"

**Message count:** 4 (customer has tried multiple times)

**Decision:** Attempt one more response with detailed steps, but flag for human review. If next message indicates continued failure, escalate.

### Example 4: Confidence-Based Escalation

**Ticket:** "Can WorkerMill integrate with our internal GitLab Enterprise server?"

**Analysis:** WorkerMill supports GitLab, but enterprise self-hosted may have specific requirements.

**Confidence:** 65%

**Decision:** Respond with general GitLab support info, note that enterprise self-hosted may need configuration, and flag for human follow-up to confirm enterprise capabilities.
