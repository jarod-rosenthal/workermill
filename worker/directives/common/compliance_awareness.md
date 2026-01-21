***REMOVED*** Compliance Awareness

Standard Operating Procedure for regulatory compliance across all WorkerMill AI Workers.

***REMOVED******REMOVED*** Overview

When working on regulated systems, be aware of these common compliance frameworks and their requirements. This guide provides quick reference - consult with compliance teams for detailed implementation.

---

***REMOVED******REMOVED*** GDPR (General Data Protection Regulation)

**Applies to:** Any system processing EU residents' personal data

***REMOVED******REMOVED******REMOVED*** Core Principles

| Principle | Implementation |
|-----------|----------------|
| **Lawful Basis** | Document why you're processing data (consent, contract, legitimate interest) |
| **Purpose Limitation** | Only use data for stated purposes |
| **Data Minimization** | Collect only what's necessary |
| **Accuracy** | Keep data up-to-date |
| **Storage Limitation** | Delete data when no longer needed |
| **Security** | Protect data with appropriate measures |

***REMOVED******REMOVED******REMOVED*** Personal Data Categories

```typescript
// PII that requires GDPR compliance
interface PersonalData {
  // Direct identifiers
  email: string;
  name: string;
  phone: string;
  address: string;
  ipAddress: string;
  deviceId: string;

  // Sensitive data (requires explicit consent)
  healthData?: never;      // Don't store unless absolutely necessary
  biometricData?: never;   // Don't store unless absolutely necessary
  politicalOpinions?: never;
  religiousBeliefs?: never;
}
```

***REMOVED******REMOVED******REMOVED*** DSAR (Data Subject Access Request) Requirements

Users can request:
1. **Access** - What data do you have on me?
2. **Rectification** - Fix incorrect data
3. **Erasure** - Delete my data ("Right to be Forgotten")
4. **Portability** - Export my data
5. **Restriction** - Stop processing my data

```typescript
// DSAR support implementation
interface DSARService {
  // Access request - export all user data
  async exportUserData(userId: string): Promise<UserDataExport>;

  // Erasure request - delete all user data
  async deleteUserData(userId: string): Promise<DeletionResult>;

  // Rectification - update user data
  async updateUserData(userId: string, corrections: Partial<UserData>): Promise<void>;

  // Portability - export in machine-readable format
  async exportPortableData(userId: string): Promise<Buffer>; // JSON or CSV
}

// Example implementation
async function handleDSARExport(userId: string): Promise<UserDataExport> {
  // Collect data from all systems
  const userData = await db.query(`
    SELECT * FROM users WHERE id = $1
  `, [userId]);

  const activityData = await db.query(`
    SELECT * FROM user_activities WHERE user_id = $1
  `, [userId]);

  const preferences = await db.query(`
    SELECT * FROM user_preferences WHERE user_id = $1
  `, [userId]);

  return {
    requestedAt: new Date(),
    userId,
    data: {
      profile: userData,
      activities: activityData,
      preferences: preferences,
    },
  };
}
```

***REMOVED******REMOVED******REMOVED*** Consent Management

```typescript
interface ConsentRecord {
  userId: string;
  consentType: 'marketing' | 'analytics' | 'essential';
  granted: boolean;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  version: string; // Consent form version
}

// Always get explicit consent before processing
async function processMarketingEmail(userId: string) {
  const consent = await getConsent(userId, 'marketing');

  if (!consent?.granted) {
    throw new Error('Marketing consent not granted');
  }

  await sendMarketingEmail(userId);
}
```

***REMOVED******REMOVED******REMOVED*** Data Retention

```typescript
// Define retention periods
const RETENTION_PERIODS = {
  userAccounts: { days: -1, description: 'Until account deletion' },
  activityLogs: { days: 90, description: '90 days' },
  auditLogs: { days: 365 * 7, description: '7 years (legal requirement)' },
  marketingData: { days: 365 * 2, description: '2 years or until consent withdrawn' },
  sessionData: { days: 30, description: '30 days' },
};

// Automated cleanup job
async function cleanupExpiredData() {
  for (const [dataType, retention] of Object.entries(RETENTION_PERIODS)) {
    if (retention.days > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retention.days);

      await db.query(`
        DELETE FROM ${dataType}
        WHERE created_at < $1
      `, [cutoffDate]);

      logger.info({ dataType, cutoffDate }, 'Cleaned up expired data');
    }
  }
}
```

---

***REMOVED******REMOVED*** SOC 2 Type II

**Applies to:** SaaS companies handling customer data

***REMOVED******REMOVED******REMOVED*** Trust Service Criteria

| Category | Key Controls |
|----------|--------------|
| **Security** | Access controls, encryption, vulnerability management |
| **Availability** | Uptime SLAs, disaster recovery, incident response |
| **Processing Integrity** | Data validation, error handling, quality assurance |
| **Confidentiality** | Data classification, access restrictions, encryption |
| **Privacy** | Consent, data minimization, retention policies |

***REMOVED******REMOVED******REMOVED*** Required Audit Logging

```typescript
interface AuditLogEntry {
  timestamp: Date;
  actor: {
    userId: string;
    email: string;
    ipAddress: string;
    userAgent: string;
  };
  action: string;
  resource: {
    type: string;
    id: string;
  };
  changes?: {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  result: 'success' | 'failure';
  reason?: string;
}

// Log all security-relevant actions
const AUDITABLE_ACTIONS = [
  'user.login',
  'user.logout',
  'user.password_change',
  'user.mfa_enable',
  'user.mfa_disable',
  'user.role_change',
  'user.create',
  'user.delete',
  'data.export',
  'data.delete',
  'settings.change',
  'api_key.create',
  'api_key.revoke',
  'permission.grant',
  'permission.revoke',
];

async function auditLog(entry: AuditLogEntry) {
  // Write to immutable audit log (append-only)
  await auditDb.insert('audit_logs', entry);

  // Send to SIEM for monitoring
  await siem.send(entry);
}
```

***REMOVED******REMOVED******REMOVED*** Access Control Requirements

```typescript
// Role-Based Access Control (RBAC)
interface Permission {
  resource: string;
  action: 'read' | 'write' | 'delete' | 'admin';
}

interface Role {
  name: string;
  permissions: Permission[];
}

const ROLES: Record<string, Role> = {
  viewer: {
    name: 'Viewer',
    permissions: [
      { resource: 'tasks', action: 'read' },
      { resource: 'reports', action: 'read' },
    ],
  },
  editor: {
    name: 'Editor',
    permissions: [
      { resource: 'tasks', action: 'read' },
      { resource: 'tasks', action: 'write' },
      { resource: 'reports', action: 'read' },
    ],
  },
  admin: {
    name: 'Admin',
    permissions: [
      { resource: '*', action: 'admin' },
    ],
  },
};

// Check permissions before every action
function requirePermission(resource: string, action: string) {
  return (req, res, next) => {
    const userRole = ROLES[req.user.role];
    const hasPermission = userRole.permissions.some(p =>
      (p.resource === resource || p.resource === '*') &&
      (p.action === action || p.action === 'admin')
    );

    if (!hasPermission) {
      auditLog({
        actor: req.user,
        action: `${resource}.${action}`,
        resource: { type: resource, id: req.params.id },
        result: 'failure',
        reason: 'Permission denied',
      });
      return res.status(403).json({ error: 'Permission denied' });
    }

    next();
  };
}
```

---

***REMOVED******REMOVED*** HIPAA (Healthcare)

**Applies to:** Systems handling Protected Health Information (PHI)

***REMOVED******REMOVED******REMOVED*** PHI Categories

```typescript
// These require HIPAA compliance when related to healthcare
const PHI_IDENTIFIERS = [
  'name',
  'address',
  'dates', // birth, admission, discharge, death
  'phone',
  'fax',
  'email',
  'ssn',
  'medical_record_number',
  'health_plan_beneficiary_number',
  'account_number',
  'certificate_number',
  'vehicle_identifiers',
  'device_identifiers',
  'web_urls',
  'ip_address',
  'biometric_identifiers',
  'photos',
  'any_unique_code',
];
```

***REMOVED******REMOVED******REMOVED*** Required Safeguards

| Safeguard | Implementation |
|-----------|----------------|
| **Administrative** | Security officer, workforce training, risk assessment |
| **Physical** | Facility access controls, workstation security |
| **Technical** | Access controls, audit logs, encryption, integrity controls |

***REMOVED******REMOVED******REMOVED*** Encryption Requirements

```typescript
// PHI must be encrypted at rest and in transit

// At rest - AES-256
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function encryptPHI(data: string, key: Buffer): EncryptedData {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return {
    ciphertext: encrypted,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

// In transit - TLS 1.2+
// Verify TLS configuration
if (process.env.NODE_ENV === 'production') {
  const tlsVersion = process.version;
  // Enforce TLS 1.2 minimum
}
```

---

***REMOVED******REMOVED*** PCI-DSS (Payment Cards)

**Applies to:** Systems handling payment card data

***REMOVED******REMOVED******REMOVED*** Cardholder Data Environment (CDE)

**Never store:**
- Full track data
- CVV/CVC
- PIN

**If you must store (encrypted):**
- PAN (Primary Account Number)
- Cardholder name
- Expiration date
- Service code

***REMOVED******REMOVED******REMOVED*** Best Practice: Tokenization

```typescript
// DON'T handle card data directly
// Use tokenization via Stripe, Braintree, etc.

// BAD - handling card data
async function processPayment(cardNumber: string, cvv: string) {
  // This makes you PCI-DSS compliant
}

// GOOD - use tokenization
async function processPayment(stripeToken: string) {
  // Stripe handles the card data
  const charge = await stripe.charges.create({
    amount: 1000,
    currency: 'usd',
    source: stripeToken, // Token, not card data
  });
}
```

---

***REMOVED******REMOVED*** Privacy by Design Principles

Apply these principles when building any system:

***REMOVED******REMOVED******REMOVED*** 1. Proactive Not Reactive

```typescript
// Plan privacy into the design
interface FeatureSpec {
  name: string;
  dataCollected: string[];
  purpose: string;
  retention: string;
  accessControls: string[];
  encryptionRequired: boolean;
}
```

***REMOVED******REMOVED******REMOVED*** 2. Privacy as Default

```typescript
// Default to most private option
const defaultUserSettings = {
  analyticsEnabled: false,      // Opt-in, not opt-out
  marketingEmails: false,
  publicProfile: false,
  dataSharing: false,
};
```

***REMOVED******REMOVED******REMOVED*** 3. Data Minimization

```typescript
// Only collect what you need
interface UserRegistration {
  email: string;    // Required for login
  password: string; // Required for auth

  // DON'T collect unless necessary:
  // phone?: string;
  // address?: string;
  // dateOfBirth?: string;
}
```

***REMOVED******REMOVED******REMOVED*** 4. End-to-End Security

```typescript
// Encrypt sensitive data throughout lifecycle
class SecureDataHandler {
  // Encrypted at collection
  async collectData(data: SensitiveData): Promise<string> {
    return this.encrypt(data);
  }

  // Encrypted in storage
  async store(encryptedData: string): Promise<void> {
    await db.insert({ data: encryptedData });
  }

  // Encrypted in transit (TLS)
  async transmit(encryptedData: string): Promise<void> {
    await secureApi.send(encryptedData);
  }

  // Secure deletion
  async delete(id: string): Promise<void> {
    await db.secureDelete(id); // Overwrite, not just mark deleted
  }
}
```

***REMOVED******REMOVED******REMOVED*** 5. Visibility and Transparency

```typescript
// Provide clear privacy notices
const privacyNotice = {
  dataCollected: ['email', 'usage patterns', 'device info'],
  purpose: 'To provide and improve our service',
  sharing: 'We do not sell your data',
  retention: 'Data is retained for 2 years after account deletion',
  rights: 'You can request access, correction, or deletion at any time',
  contact: 'privacy@example.com',
};
```

---

***REMOVED******REMOVED*** Compliance Checklist for New Features

Before implementing a feature that handles user data:

- [ ] What personal data is being collected?
- [ ] What is the lawful basis for processing?
- [ ] How long will data be retained?
- [ ] Who has access to the data?
- [ ] Is the data encrypted at rest and in transit?
- [ ] Are audit logs in place?
- [ ] Can users access/delete their data?
- [ ] Is consent required and obtained?
- [ ] Has a privacy impact assessment been done?
- [ ] Are third-party processors compliant?

---

***REMOVED******REMOVED*** Quick Reference

| Regulation | Key Requirement | Penalty |
|------------|-----------------|---------|
| GDPR | Consent, DSAR, breach notification | Up to 4% global revenue |
| SOC 2 | Audit logs, access controls | Loss of certification |
| HIPAA | PHI encryption, audit trails | $100-$50,000 per violation |
| PCI-DSS | Tokenization, no CVV storage | Fines, loss of card processing |

***REMOVED******REMOVED*** Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
