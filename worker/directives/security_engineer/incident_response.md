# Incident Response Playbook

Security Engineer reference for handling security incidents.

## Incident Severity Levels

| Severity | Description | Response Time | Examples |
|----------|-------------|---------------|----------|
| **P1 - Critical** | Active exploitation, data breach | 15 minutes | Ransomware, active intrusion, PII leak |
| **P2 - High** | Exploitable vulnerability, account compromise | 1 hour | SQL injection found, admin account compromised |
| **P3 - Medium** | Security misconfiguration, suspicious activity | 4 hours | Open S3 bucket, failed login spike |
| **P4 - Low** | Policy violation, minor misconfiguration | 24 hours | Outdated dependency, weak password |

---

## Incident Response Phases

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Detection  │ → │ Containment │ → │ Eradication │ → │  Recovery   │ → │   Lessons   │
│             │   │             │   │             │   │             │   │   Learned   │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
```

---

## Phase 1: Detection & Identification

### Initial Triage Checklist

```markdown
## Incident Triage

**Date/Time Detected:** _______________
**Detected By:** _______________
**Detection Method:** [ ] Automated Alert [ ] User Report [ ] Audit Log [ ] Other

### Initial Assessment

1. What systems are affected?
   - [ ] Production
   - [ ] Staging
   - [ ] Development
   - [ ] Internal Tools

2. What data may be compromised?
   - [ ] PII (Personal Identifiable Information)
   - [ ] Credentials/Secrets
   - [ ] Financial Data
   - [ ] Source Code
   - [ ] None/Unknown

3. Is the attack ongoing?
   - [ ] Yes - Active
   - [ ] No - Historical
   - [ ] Unknown

4. Initial Severity Assessment: P__

### Assigned To
- Incident Lead: _______________
- Technical Lead: _______________
```

### Evidence Preservation

```bash
# DO THIS FIRST - Preserve evidence before taking any action

# 1. Capture current state
aws logs describe-log-groups > incident_log_groups_$(date +%Y%m%d_%H%M%S).json

# 2. Export relevant logs (don't delete anything)
aws logs filter-log-events \
  --log-group-name /ecs/workermill/api \
  --start-time $(date -d '24 hours ago' +%s000) \
  --end-time $(date +%s000) \
  > api_logs_$(date +%Y%m%d_%H%M%S).json

# 3. Snapshot affected databases
aws rds create-db-snapshot \
  --db-instance-identifier workermill-db \
  --db-snapshot-identifier incident-$(date +%Y%m%d-%H%M%S)

# 4. Capture network flow logs
# (If enabled in VPC)

# 5. Document all actions with timestamps
echo "$(date -Iseconds) - Evidence preservation started" >> incident_timeline.log
```

---

## Phase 2: Containment

### Immediate Actions by Incident Type

#### Account Compromise

```bash
# 1. Disable compromised account immediately
aws cognito-idp admin-disable-user \
  --user-pool-id us-east-1_XXXXX \
  --username compromised-user@example.com

# 2. Revoke all sessions
aws cognito-idp admin-user-global-sign-out \
  --user-pool-id us-east-1_XXXXX \
  --username compromised-user@example.com

# 3. Rotate affected API keys
# Via API or database update

# 4. Check for unauthorized changes
git log --oneline --since="24 hours ago" --author="compromised-user"
```

#### Active Intrusion

```bash
# 1. Isolate affected systems (update security groups)
aws ec2 modify-instance-attribute \
  --instance-id i-XXXXX \
  --groups sg-isolated  # Security group with no inbound/outbound

# 2. Block suspicious IPs at WAF
aws wafv2 update-ip-set \
  --name BlockedIPs \
  --scope CLOUDFRONT \
  --id XXXXX \
  --addresses "192.0.2.0/24" "198.51.100.0/24"

# 3. Enable enhanced logging
aws ecs update-service \
  --cluster workermill-dev \
  --service api \
  --enable-execute-command

# 4. Scale up logging/monitoring resources if needed
```

#### Data Breach

```bash
# 1. Stop data exfiltration - block outbound traffic
# 2. Identify scope of breach
# 3. Preserve all evidence
# 4. Do NOT notify customers yet - follow legal process

# Check what data was accessed
SELECT user_id, table_name, action, timestamp
FROM audit_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
AND action IN ('SELECT', 'EXPORT', 'DOWNLOAD')
ORDER BY timestamp DESC;
```

### Communication Templates

#### Internal Escalation (Slack/Teams)

```markdown
🚨 **SECURITY INCIDENT - P[SEVERITY]**

**Time Detected:** [TIME]
**Current Status:** Containment in progress

**Summary:**
[Brief description of what happened]

**Impact:**
- Systems: [List affected systems]
- Data: [Type of data potentially affected]
- Users: [Number/type of users affected]

**Current Actions:**
1. [Action 1]
2. [Action 2]

**Next Update:** [TIME]

**Incident Lead:** @[NAME]
**Bridge:** [Link to video call if applicable]
```

---

## Phase 3: Eradication

### Root Cause Analysis

```typescript
// Systematic investigation checklist
const investigationSteps = {
  accessLogs: {
    question: 'Who accessed what and when?',
    sources: ['CloudTrail', 'Application Logs', 'Database Audit Logs'],
    query: `
      SELECT user_id, action, resource, timestamp
      FROM audit_logs
      WHERE timestamp BETWEEN $1 AND $2
      ORDER BY timestamp
    `,
  },

  authenticationLogs: {
    question: 'Were there unauthorized authentication attempts?',
    sources: ['Cognito Logs', 'API Gateway Logs'],
    signals: ['Multiple failed logins', 'Logins from unusual IPs', 'Token reuse'],
  },

  configurationChanges: {
    question: 'Were there unauthorized configuration changes?',
    sources: ['Terraform State', 'AWS Config', 'Parameter Store History'],
  },

  networkActivity: {
    question: 'Was there unusual network traffic?',
    sources: ['VPC Flow Logs', 'CloudFront Access Logs', 'WAF Logs'],
    signals: ['Data exfiltration', 'C2 communication', 'Lateral movement'],
  },

  vulnerabilities: {
    question: 'What vulnerability was exploited?',
    sources: ['Application code', 'Dependency audit', 'Penetration test results'],
  },
};
```

### Remediation Actions

```bash
# 1. Patch identified vulnerability
# Example: Update vulnerable dependency
npm audit fix
git commit -m "security: patch CVE-2024-XXXXX"
git push

# 2. Rotate all potentially compromised credentials
aws secretsmanager rotate-secret --secret-id workermill/dev/db-password

# 3. Update security groups/IAM policies
terraform apply -target=aws_security_group.api

# 4. Deploy fixed application
./deploy.sh --api

# 5. Verify fix
# Run security scan against fixed systems
```

---

## Phase 4: Recovery

### Recovery Checklist

```markdown
## Recovery Verification

### System Restoration
- [ ] All affected systems restored to known-good state
- [ ] All credentials rotated
- [ ] Security patches applied
- [ ] Monitoring restored and verified

### Verification Testing
- [ ] Vulnerability scan shows clean
- [ ] Penetration test of affected area
- [ ] Functional testing passed
- [ ] Performance baseline restored

### Monitoring Enhancement
- [ ] Additional alerting rules added for attack vector
- [ ] Log retention extended if needed
- [ ] IOCs (Indicators of Compromise) added to detection

### Communication
- [ ] Internal stakeholders notified of resolution
- [ ] Customer notification drafted (if required)
- [ ] Regulatory notification prepared (if required)
```

### Customer Notification Template

```markdown
Subject: Security Incident Notice - [Company Name]

Dear [Customer],

We are writing to inform you of a security incident that affected [Company Name] on [DATE].

**What Happened:**
[Clear, factual description]

**What Information Was Involved:**
[Specific data types affected]

**What We Are Doing:**
[Actions taken and ongoing]

**What You Can Do:**
[Recommended actions for customers]

**For More Information:**
[Contact details and resources]

We sincerely apologize for any concern this may cause. Protecting your data is our top priority.

Sincerely,
[Name and Title]
```

---

## Phase 5: Post-Incident Review

### Incident Report Template

```markdown
# Security Incident Report

**Incident ID:** INC-[YYYY]-[NUMBER]
**Classification:** P[1-4]
**Status:** Closed
**Date of Report:** [DATE]

## Executive Summary
[2-3 sentence summary for leadership]

## Timeline
| Time | Event |
|------|-------|
| [TIME] | Initial detection |
| [TIME] | Containment started |
| [TIME] | Root cause identified |
| [TIME] | Remediation completed |
| [TIME] | Systems restored |

## Impact Assessment

### Systems Affected
- [System 1]
- [System 2]

### Data Impact
- **Type of Data:** [PII/Credentials/etc.]
- **Records Affected:** [Number]
- **Duration of Exposure:** [Time period]

### Business Impact
- **Downtime:** [Hours/minutes]
- **Customer Impact:** [Description]
- **Financial Impact:** [If applicable]

## Root Cause Analysis

### Attack Vector
[How did the attacker gain access?]

### Vulnerability
[What vulnerability was exploited?]

### Detection Gap
[Why wasn't this detected sooner?]

## Remediation Actions Taken

1. [Action 1]
2. [Action 2]
3. [Action 3]

## Lessons Learned

### What Went Well
- [Positive observation 1]
- [Positive observation 2]

### What Could Be Improved
- [Improvement area 1]
- [Improvement area 2]

## Action Items

| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| [Action] | [Name] | [Date] | [Status] |

## Appendix

### Evidence Artifacts
- [Link to preserved logs]
- [Link to forensic images]

### Related Tickets
- [JIRA-XXX]
```

---

## Quick Reference: Common Attack Patterns

### SQL Injection Detected

```
Detection: WAF blocks or unusual DB errors
Immediate: Check for data exfiltration, block source IPs
Investigate: Review query logs, check for extracted data
Remediate: Fix vulnerable code, add parameterized queries
```

### Credential Stuffing Attack

```
Detection: High volume of failed logins
Immediate: Enable rate limiting, CAPTCHA
Investigate: Check for successful logins from attack
Remediate: Force password reset for affected accounts, add MFA
```

### API Key Leaked

```
Detection: Unusual API traffic, key in public repo
Immediate: Revoke key immediately
Investigate: Audit all actions taken with key
Remediate: Issue new key, add secret scanning, review access
```

### Dependency Vulnerability (CVE)

```
Detection: Automated scan, security advisory
Immediate: Assess exploitability, check for active exploitation
Investigate: Review dependency usage, check if exploit path exists
Remediate: Update dependency, deploy patch
```

---

## Escalation Contacts

| Role | When to Contact | Response |
|------|-----------------|----------|
| Security Lead | P1/P2 incidents | Incident command |
| Engineering Lead | Production impact | Technical decisions |
| Legal | Data breach, compliance | Regulatory guidance |
| Communications | Customer impact | External messaging |
| Executive | P1 incidents | Business decisions |

## Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
