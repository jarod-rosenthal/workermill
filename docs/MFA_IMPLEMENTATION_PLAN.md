# WorkerMill MFA Implementation Plan

## Executive Summary

This document outlines the plan to implement Multi-Factor Authentication (MFA) for WorkerMill. The goal is to provide enterprise-grade security while maintaining a smooth user experience.

## Current State

WorkerMill uses **AWS Cognito** for authentication with the following configuration:

| Feature | Status |
|---------|--------|
| MFA Setting | `OPTIONAL` (users can enable but not required) |
| TOTP Support | Enabled in Cognito (software token) |
| SMS MFA | Not configured |
| MFA UI | **Not implemented** |
| Org-level enforcement | **Not implemented** |
| Backup codes | **Not implemented** |

**Key insight**: Cognito already supports TOTP MFA - we just need to build the UI and enforcement layer.

---

## Recommended Approach

### MFA Method: TOTP (Time-based One-Time Password)

**Why TOTP over SMS:**

| Factor | TOTP | SMS |
|--------|------|-----|
| Security | Strong (cryptographic) | Weak (SIM swap, SS7 attacks) |
| Cost | Free | ~$0.01-0.05 per message |
| Reliability | Always works offline | Dependent on carrier |
| Compliance | Preferred by SOC 2/ISO 27001 | Acceptable but discouraged |
| User experience | Requires app setup | Easier initial setup |

**Recommendation**: TOTP-only for initial implementation. SMS can be added later as a fallback option if customer demand exists.

### Supported Authenticator Apps

- Google Authenticator
- Microsoft Authenticator
- Authy
- 1Password
- Any TOTP-compatible app (RFC 6238)

---

## Feature Requirements

### Phase 1: User Self-Service MFA (MVP)

**Goal**: Allow users to enable/disable MFA for their own account.

#### User Stories

1. **As a user**, I can enable MFA from my profile settings
2. **As a user**, I can scan a QR code to set up my authenticator app
3. **As a user**, I can enter a TOTP code to verify setup
4. **As a user**, I can disable MFA (with password confirmation)
5. **As a user**, I must enter a TOTP code during login when MFA is enabled

#### Technical Components

**Backend (API)**:
- `POST /api/profile/mfa/setup` - Generate TOTP secret and QR code URI
- `POST /api/profile/mfa/verify` - Verify TOTP and enable MFA
- `POST /api/profile/mfa/disable` - Disable MFA (requires password)
- `GET /api/profile/mfa/status` - Get current MFA status

**Frontend**:
- MFA setup modal with QR code display
- Manual secret code entry option (accessibility)
- 6-digit TOTP input component
- MFA challenge screen during login flow
- Settings toggle for MFA status

**Cognito API Calls**:
- `AssociateSoftwareToken` - Generate TOTP secret
- `VerifySoftwareToken` - Validate TOTP during setup
- `SetUserMFAPreference` - Enable/disable MFA for user
- `RespondToAuthChallenge` (SOFTWARE_TOKEN_MFA) - Handle MFA during login

---

### Phase 2: Organization-Level MFA Enforcement

**Goal**: Allow org admins to require MFA for all members.

#### User Stories

1. **As an org admin**, I can require MFA for all organization members
2. **As an org admin**, I can see which members have MFA enabled
3. **As a member**, I am prompted to set up MFA if my org requires it
4. **As a member**, I cannot access the dashboard until MFA is set up (when required)

#### Technical Components

**Database Changes**:
```sql
-- Add to organizations table
ALTER TABLE organizations ADD COLUMN mfa_required BOOLEAN DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN mfa_grace_period_days INTEGER DEFAULT 7;

-- Add to users table
ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN mfa_enabled_at TIMESTAMP;
```

**Backend**:
- `PUT /api/settings` - Add `mfaRequired` and `mfaGracePeriodDays` fields
- `GET /api/org/members` - Include MFA status for each member
- Middleware to enforce MFA setup when required

**Frontend**:
- Settings page toggle for "Require MFA for all members"
- Grace period configuration (days before enforcement)
- Member list showing MFA status badges
- Forced MFA setup flow for non-compliant users

---

### Phase 3: Recovery & Admin Controls

**Goal**: Handle lost devices and provide admin override capabilities.

#### User Stories

1. **As a user**, I can generate backup codes when enabling MFA
2. **As a user**, I can use a backup code if I lose my device
3. **As an org admin**, I can reset MFA for a member who lost their device
4. **As a user**, I receive an email notification when MFA is reset

#### Technical Components

**Database Changes**:
```sql
-- Backup codes table
CREATE TABLE user_backup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  code_hash VARCHAR(255) NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Backend**:
- `POST /api/profile/mfa/backup-codes` - Generate 10 backup codes
- `POST /api/auth/mfa/backup` - Verify backup code during login
- `POST /api/org/members/:userId/reset-mfa` - Admin reset MFA (audit logged)

**Frontend**:
- Backup codes display (download/print option)
- "Use backup code" option on MFA challenge screen
- Admin action to reset member MFA

---

## Implementation Details

### Login Flow with MFA

```
User enters email/password
         │
         ▼
    Cognito validates
         │
         ▼
  ┌──────┴──────┐
  │ MFA enabled?│
  └──────┬──────┘
         │
    Yes  │  No
    ▼    │   ▼
MFA Challenge  │  Login Success
    │          │
    ▼          │
User enters    │
TOTP code      │
    │          │
    ▼          │
Cognito        │
validates      │
    │          │
    ▼          ◄──────
Login Success
```

### Cognito Challenge Response

When MFA is enabled, Cognito returns `SOFTWARE_TOKEN_MFA` challenge:

```typescript
// Login response when MFA required
{
  ChallengeName: "SOFTWARE_TOKEN_MFA",
  Session: "...", // Required for challenge response
  ChallengeParameters: {
    USER_ID_FOR_SRP: "user-sub-id"
  }
}

// Frontend responds with TOTP
RespondToAuthChallenge({
  ChallengeName: "SOFTWARE_TOKEN_MFA",
  Session: "...",
  ChallengeResponses: {
    USERNAME: "user@example.com",
    SOFTWARE_TOKEN_MFA_CODE: "123456"
  }
})
```

### QR Code Generation

```typescript
// Generate TOTP URI for QR code
const totpUri = `otpauth://totp/WorkerMill:${email}?secret=${secretCode}&issuer=WorkerMill&algorithm=SHA1&digits=6&period=30`;
```

**Important**: Cognito only supports HMAC-SHA1 for TOTP. SHA-256 codes will fail.

---

## API Specification

### POST /api/profile/mfa/setup

Initiates MFA setup by generating a TOTP secret.

**Request**: None (uses authenticated user)

**Response**:
```json
{
  "secretCode": "JBSWY3DPEHPK3PXP",
  "qrCodeUri": "otpauth://totp/WorkerMill:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=WorkerMill"
}
```

### POST /api/profile/mfa/verify

Verifies TOTP code and enables MFA.

**Request**:
```json
{
  "code": "123456"
}
```

**Response**:
```json
{
  "success": true,
  "backupCodes": ["abc123", "def456", ...] // 10 codes, shown once
}
```

### POST /api/profile/mfa/disable

Disables MFA for the user.

**Request**:
```json
{
  "password": "currentPassword",
  "code": "123456" // Current TOTP code
}
```

**Response**:
```json
{
  "success": true
}
```

### GET /api/profile/mfa/status

Returns current MFA status.

**Response**:
```json
{
  "enabled": true,
  "enabledAt": "2025-01-15T10:30:00Z",
  "backupCodesRemaining": 8
}
```

---

## UI Components

### 1. MFA Setup Modal

```
┌─────────────────────────────────────────────┐
│  Set Up Two-Factor Authentication           │
├─────────────────────────────────────────────┤
│                                             │
│  1. Install an authenticator app            │
│     (Google Authenticator, Authy, etc.)     │
│                                             │
│  2. Scan this QR code:                      │
│                                             │
│     ┌─────────────┐                         │
│     │  [QR CODE]  │                         │
│     └─────────────┘                         │
│                                             │
│  Or enter this code manually:               │
│  JBSWY3DPEHPK3PXP                          │
│                                             │
│  3. Enter the 6-digit code from your app:   │
│                                             │
│     ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐               │
│     │ │ │ │ │ │ │ │ │ │ │ │               │
│     └─┘ └─┘ └─┘ └─┘ └─┘ └─┘               │
│                                             │
│            [Cancel]  [Verify & Enable]      │
└─────────────────────────────────────────────┘
```

### 2. MFA Login Challenge

```
┌─────────────────────────────────────────────┐
│  Two-Factor Authentication                  │
├─────────────────────────────────────────────┤
│                                             │
│  Enter the 6-digit code from your           │
│  authenticator app:                         │
│                                             │
│     ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐               │
│     │ │ │ │ │ │ │ │ │ │ │ │               │
│     └─┘ └─┘ └─┘ └─┘ └─┘ └─┘               │
│                                             │
│  [Use backup code instead]                  │
│                                             │
│                          [Verify]           │
└─────────────────────────────────────────────┘
```

### 3. Backup Codes Display

```
┌─────────────────────────────────────────────┐
│  Save Your Backup Codes                     │
├─────────────────────────────────────────────┤
│                                             │
│  ⚠️ Save these codes in a secure location.  │
│  Each code can only be used once.           │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  1. abc123-def456                   │   │
│  │  2. ghi789-jkl012                   │   │
│  │  3. mno345-pqr678                   │   │
│  │  4. stu901-vwx234                   │   │
│  │  5. yza567-bcd890                   │   │
│  │  6. efg123-hij456                   │   │
│  │  7. klm789-nop012                   │   │
│  │  8. qrs345-tuv678                   │   │
│  │  9. wxy901-zab234                   │   │
│  │  10. cde567-fgh890                  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [Download]  [Copy]         [I've saved]    │
└─────────────────────────────────────────────┘
```

### 4. Settings Page Section

```
┌─────────────────────────────────────────────┐
│  Security                                   │
├─────────────────────────────────────────────┤
│                                             │
│  Two-Factor Authentication                  │
│  ────────────────────────────────────────   │
│  Add an extra layer of security to your     │
│  account using an authenticator app.        │
│                                             │
│  Status: ● Enabled (since Jan 15, 2025)     │
│  Backup codes remaining: 8 of 10            │
│                                             │
│  [Regenerate Backup Codes]  [Disable MFA]   │
│                                             │
├─────────────────────────────────────────────┤
│  Organization MFA Policy (Admin only)       │
│  ────────────────────────────────────────   │
│                                             │
│  [x] Require MFA for all members            │
│                                             │
│  Grace period: [7 days ▼]                   │
│  (New members have this long to set up MFA) │
│                                             │
│  Members without MFA: 2 of 5                │
│  [View members →]                           │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Security Considerations

### Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `/api/auth/login` (MFA challenge) | 5 attempts per 15 min |
| `/api/profile/mfa/verify` | 5 attempts per 15 min |
| `/api/auth/mfa/backup` | 3 attempts per hour |

### Audit Logging

All MFA events should be logged to `audit_logs`:

- `mfa.setup.initiated`
- `mfa.setup.completed`
- `mfa.disabled`
- `mfa.challenge.success`
- `mfa.challenge.failed`
- `mfa.backup_code.used`
- `mfa.admin_reset` (includes admin user ID)

### Email Notifications

Send email notifications for:

- MFA enabled on account
- MFA disabled on account
- MFA reset by admin
- Backup code used
- Multiple failed MFA attempts

---

## Terraform Changes

Update Cognito configuration in `infrastructure/terraform/modules/cognito/main.tf`:

```hcl
resource "aws_cognito_user_pool" "main" {
  # ... existing config ...

  # MFA Configuration (already set, verify these values)
  mfa_configuration = "OPTIONAL"  # Keep optional, enforce at app level

  software_token_mfa_configuration {
    enabled = true
  }

  # Consider enabling for Phase 3+
  # account_recovery_setting {
  #   recovery_mechanism {
  #     name     = "verified_email"
  #     priority = 1
  #   }
  # }
}
```

---

## Migration Strategy

### Phase 1 Rollout

1. Deploy backend MFA endpoints
2. Deploy frontend MFA setup UI
3. Add MFA section to Settings page
4. Announce feature availability (optional opt-in)

### Phase 2 Rollout

1. Add org-level enforcement setting (default: off)
2. Deploy enforcement middleware
3. Notify admins of new capability
4. Admins can enable at their discretion

### Phase 3 Rollout

1. Add backup codes generation
2. Add admin reset capability
3. Full MFA feature parity

---

## Estimated Effort

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1 | User self-service MFA | Medium |
| Phase 2 | Org-level enforcement | Medium |
| Phase 3 | Recovery & admin controls | Small-Medium |

---

## Alternatives Considered

### 1. AWS Amplify Auth

**Pros**: Pre-built UI components, handles MFA automatically
**Cons**: Adds dependency, less control over UX, requires migration

**Decision**: Not recommended - too invasive for existing codebase

### 2. Third-party Auth (Auth0, WorkOS)

**Pros**: Enterprise features out-of-box, SSO, MFA
**Cons**: Cost ($$$), migration effort, vendor lock-in

**Decision**: Consider for future if Cognito limitations become blocking

### 3. SMS MFA

**Pros**: Familiar to users, no app required
**Cons**: Security risks (SIM swap), cost per message, delivery reliability

**Decision**: Not for MVP, consider as optional fallback later

### 4. Passkeys/WebAuthn

**Pros**: Phishing-resistant, passwordless future
**Cons**: Browser/device support varies, complex implementation

**Decision**: Future enhancement after TOTP is stable

---

## Success Metrics

- **Adoption**: % of users with MFA enabled
- **Enforcement**: % of orgs requiring MFA
- **Security**: Reduction in account compromise incidents
- **UX**: MFA setup completion rate (start → finish)
- **Support**: MFA-related support tickets

---

## References

- [AWS Cognito MFA Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html)
- [TOTP Software Token MFA](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html)
- [AWS Amplify MFA Guide](https://docs.amplify.aws/react/build-a-backend/auth/concepts/multi-factor-authentication/)
- [MFA Best Practices - WorkOS](https://workos.com/blog/mfa-best-practices)
- [B2B Authentication Best Practices - Frontegg](https://frontegg.com/blog/b2b-authentication)
- [MFA for SaaS - LoginRadius](https://www.loginradius.com/blog/identity/mfa-strategies-saas-platforms/)
