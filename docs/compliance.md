# Compliance

WorkerMill maintains a complete audit trail of all actions taken by users, workers, and the system. Use the compliance dashboard to meet audit requirements, investigate incidents, and satisfy security reviews.

## Audit Log

Every action in WorkerMill is logged with:
- **Timestamp** — UTC timestamp of the action
- **Actor** — User, API key, or system component that performed the action
- **Action** — What was done (see categories below)
- **Resource** — What was affected (task ID, user ID, etc.)
- **IP Address** — Source IP for user-initiated actions
- **Details** — Additional context specific to the action type

## Audit Categories

### Authentication
User authentication events including login attempts, session management, and MFA changes.

**Actions:** `login`, `logout`, `password_change`, `mfa_enable`, `mfa_disable`

### Task Operations
Worker task lifecycle events from creation through completion or cancellation.

**Actions:** `task_create`, `task_cancel`, `task_retry`, `task_complete`

### API Key Management
API key operations including creation, revocation, and rotation events.

**Actions:** `api_key_create`, `api_key_revoke`, `api_key_rotate`

### User Management
User account management including invitations, removals, and role changes.

**Actions:** `user_invite`, `user_remove`, `role_change`

### Settings Changes
Organization settings and integration configuration changes.

**Actions:** `settings_update`, `integration_connect`, `integration_disconnect`

### Data Access
Sensitive data access events including exports and log downloads.

**Actions:** `export_data`, `view_sensitive`, `download_logs`

### Billing
Billing-related events including payment methods and subscription changes.

**Actions:** `payment_method_add`, `subscription_change`, `invoice_download`

### Security Events
Security-critical events requiring immediate attention.

**Actions:** `suspicious_login`, `rate_limit_exceeded`, `unauthorized_access_attempt`

## Retention

Audit logs are retained for **90 days** by default. Contact support for extended retention options (available on Enterprise plans).

## Exporting Logs

Export audit logs from the **Compliance** page:

1. Set the date range
2. Filter by category, actor, or action type
3. Click **Export CSV**

For automated exports, use the API:
```
GET /api/audit-logs?from=2026-01-01&to=2026-04-01&format=csv
```

## Access Control

Audit log access is restricted to:
- **Organization Owners** — Full access to all audit logs
- **Admins** — Access to operational logs (task operations, settings)
- **Members** — No audit log access

## Compliance Frameworks

WorkerMill's audit trail supports requirements for:

**SOC 2 Type II**
- Access controls and monitoring
- Change management logging
- Incident response tracking

**GDPR**
- Data access logging
- User management events
- Export capabilities for data subject requests

**HIPAA** (Enterprise)
- Enhanced audit retention
- Access log completeness
- Breach notification support

## Security Notes

- Audit logs are **immutable** — entries cannot be modified or deleted
- Logs are stored in a separate, append-only datastore
- Access to audit logs is itself audited
- Log integrity is verified with cryptographic checksums
