# Multi-Tenancy Security Remediation Plan

**Created:** 2026-01-29
**Status:** Pending Approval
**Priority:** P0 - Critical Security

## Executive Summary

A security audit of the WorkerMill multi-tenancy architecture identified **8 vulnerabilities** that could expose platform credentials to tenants or allow cross-tenant data access. This document details each vulnerability and proposes industry-standard remediation approaches.

---

## Table of Contents

1. [Vulnerability Summary](#vulnerability-summary)
2. [Architecture Principles](#architecture-principles)
3. [Detailed Findings & Remediation](#detailed-findings--remediation)
4. [Implementation Plan](#implementation-plan)
5. [Testing Strategy](#testing-strategy)
6. [Rollback Plan](#rollback-plan)

---

## Vulnerability Summary

| ID | Severity | Issue | File | Lines |
|----|----------|-------|------|-------|
| MT-001 | **CRITICAL** | Platform secrets exposed via `getOrgCredentials()` | `api/src/services/orchestrator.ts` | 251-267 |
| MT-002 | **CRITICAL** | Provider credentials fallback to platform secrets | `api/src/config/index.ts` | 193-210 |
| MT-003 | **HIGH** | Provider test endpoint exposes platform credentials | `api/src/routes/settings.ts` | 2728-2742 |
| MT-004 | **HIGH** | Legacy webhooks use arbitrary org lookup | `api/src/routes/webhooks.ts` | 176-191, 1070-1084, 1420-1432, 2230-2241 |
| MT-005 | **MEDIUM** | SCM token falls back to GitHub on error | `api/src/services/orchestrator.ts` | 332-339 |
| MT-006 | **MEDIUM** | Ollama host shared across all tenants | `api/src/config/index.ts` | 226-228 |
| MT-007 | **MEDIUM** | Worker containers receive extra credentials | `api/src/services/ecs-task-runner.ts` | 310-330 |
| MT-008 | **LOW** | Misleading function name `getSecretWithFallback` | `api/src/routes/settings.ts` | 990-1010 |

---

## Architecture Principles

The remediation follows these industry-standard multi-tenancy security principles:

### 1. Tenant Isolation by Default

**Principle:** Tenant resources MUST be isolated by default. Cross-tenant access requires explicit, auditable configuration.

**Implementation:**
- All secrets stored in tenant-specific paths: `workermill/{env}/orgs/{orgId}/{secret-name}`
- No fallback to platform-wide secrets
- Fail-closed: Missing credentials = task failure, not credential substitution

### 2. Explicit Over Implicit

**Principle:** Never assume or infer tenant context. Require explicit tenant identification.

**Implementation:**
- Webhooks require org identification via URL path (`/:orgSlug/`) or verified header
- Remove `findOne({ where: {} })` patterns that select arbitrary tenants
- All database queries require `orgId` in WHERE clause

### 3. Least Privilege

**Principle:** Grant only the minimum credentials required for each operation.

**Implementation:**
- Workers receive only credentials for their configured provider
- No "fallback" credentials passed to containers
- Credentials scoped to specific integrations, not blanket access

### 4. Fail-Closed Security

**Principle:** When credentials are missing or invalid, fail the operation rather than degrading security.

**Implementation:**
- Missing org credentials = clear error message + task failure
- No silent fallback to platform credentials
- Explicit "not configured" states in UI

### 5. Defense in Depth

**Principle:** Multiple layers of protection, not single points of failure.

**Implementation:**
- Webhook signature verification + org ownership verification
- API key validation + org membership validation
- Audit logging for all credential access

---

## Detailed Findings & Remediation

### MT-001: Platform Secrets in `getOrgCredentials()` [CRITICAL]

**Location:** `api/src/services/orchestrator.ts:251-267`

**Current Behavior:**
```typescript
// Fetches PLATFORM-WIDE secrets for ALL tenants
const [anthropicSecret, githubSecret, jiraSecret] = await Promise.all([
  secretsClient.send(
    new GetSecretValueCommand({
      SecretId: `workermill/${config.environment}/anthropic-api-key`,
    }),
  ),
  // ... same pattern for github-token, jira-credentials
]);
```

**Impact:**
- All tenants use platform Anthropic API key (billing exposure)
- All tenants access platform GitHub repos (code exposure)
- All tenants access platform Jira (data exposure)

**Remediation:**

Create a new `TenantCredentialService` that enforces org-scoped credential retrieval:

```typescript
// api/src/services/tenant-credentials.ts

export class TenantCredentialService {
  private secretsClient: SecretsManagerClient;

  /**
   * Get org-specific secret. Returns null if not found.
   * NEVER falls back to platform secrets.
   */
  async getOrgSecret(orgId: string, secretName: string): Promise<string | null> {
    const secretPath = `workermill/${config.environment}/orgs/${orgId}/${secretName}`;

    try {
      const result = await this.secretsClient.send(
        new GetSecretValueCommand({ SecretId: secretPath })
      );
      return result.SecretString || null;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return null; // Not configured - this is expected
      }
      throw error; // Unexpected error - propagate
    }
  }

  /**
   * Get required org credential. Throws if not configured.
   */
  async requireOrgSecret(orgId: string, secretName: string): Promise<string> {
    const secret = await this.getOrgSecret(orgId, secretName);
    if (!secret) {
      throw new TenantCredentialError(
        `Required credential '${secretName}' not configured for organization. ` +
        `Please configure this in Settings > Integrations.`
      );
    }
    return secret;
  }

  /**
   * Get all credentials needed to spawn a worker for this org.
   * Fails if any required credential is missing.
   */
  async getWorkerCredentials(orgId: string, org: Organization): Promise<WorkerCredentials> {
    const errors: string[] = [];

    // Determine which credentials are required based on org config
    const requiredCredentials = this.determineRequiredCredentials(org);

    // Fetch all required credentials
    const credentials: Partial<WorkerCredentials> = {};

    for (const [key, secretName] of Object.entries(requiredCredentials)) {
      const value = await this.getOrgSecret(orgId, secretName);
      if (!value) {
        errors.push(`${secretName} not configured`);
      } else {
        credentials[key] = value;
      }
    }

    if (errors.length > 0) {
      throw new TenantCredentialError(
        `Missing required credentials: ${errors.join(', ')}. ` +
        `Configure these in Settings > Integrations before running workers.`
      );
    }

    return credentials as WorkerCredentials;
  }

  private determineRequiredCredentials(org: Organization): Record<string, string> {
    const required: Record<string, string> = {};

    // AI provider credential (based on org's default or task-specific provider)
    required.aiApiKey = `${org.defaultProvider || 'anthropic'}-api-key`;

    // SCM provider credential
    switch (org.scmProvider) {
      case 'gitlab':
        required.scmToken = 'gitlab-token';
        break;
      case 'bitbucket':
        required.scmToken = 'bitbucket-app-password';
        required.scmUsername = 'bitbucket-username';
        break;
      default:
        required.scmToken = 'github-token';
    }

    // Issue tracker credential (if configured)
    if (org.jiraBaseUrl) {
      required.jiraCredentials = 'jira-credentials';
    }
    if (org.linearApiKey) {
      required.linearApiKey = 'linear-api-key';
    }

    return required;
  }
}
```

**Migration Steps:**
1. Create `TenantCredentialService` class
2. Add org-specific secrets to AWS Secrets Manager for existing tenants
3. Update `getOrgCredentials()` to use new service
4. Add clear error messages when credentials missing
5. Update Settings UI to show credential configuration status

---

### MT-002: Provider Credentials Fallback [CRITICAL]

**Location:** `api/src/config/index.ts:193-210`

**Current Behavior:**
```typescript
// Tries org-specific, then FALLS BACK to platform-wide
try {
  const platformSecretPath = `workermill/${env}/${providerId}-api-key`;
  const platformSecret = await client.send(/*...*/);
  return platformSecret.SecretString; // RETURNS PLATFORM SECRET TO ANY ORG!
} catch {
  // Platform default not found
}
```

**Impact:**
- Any tenant without credentials uses platform AI credits
- Cross-tenant billing impossible to attribute
- Platform credentials exposed to all tenants

**Remediation:**

Remove the platform fallback entirely:

```typescript
// api/src/config/index.ts

export async function getProviderCredentials(
  orgId: string,
  providerId: string
): Promise<string | null> {
  const credentialService = new TenantCredentialService();

  // ONLY check org-specific path - NO FALLBACK
  const apiKey = await credentialService.getOrgSecret(orgId, `${providerId}-api-key`);

  if (!apiKey) {
    logger.info('Provider credentials not configured for org', {
      orgId,
      providerId,
      action: 'credential_lookup_failed'
    });
    return null;
  }

  return apiKey;
}
```

**Add explicit platform credential function (for internal use only):**

```typescript
/**
 * Get platform-level credentials.
 * ONLY for internal platform operations, never for tenant workloads.
 * @internal
 */
export async function getPlatformCredentials(
  providerId: string
): Promise<string | null> {
  // This should ONLY be called for platform-internal operations
  // like health checks, not for tenant workloads
  const secretPath = `workermill/${config.environment}/${providerId}-api-key`;
  // ...
}
```

---

### MT-003: Provider Test Endpoint Exposes Platform Credentials [HIGH]

**Location:** `api/src/routes/settings.ts:2728-2742`

**Current Behavior:**
```typescript
// Falls back to platform secret if org secret not found
try {
  const platformSecret = await secretsClient.send(/*...*/);
  apiKey = platformSecret.SecretString || null;
} catch {
  // No credentials found
}
```

**Impact:**
- Tenant admins can verify platform credentials exist
- Information disclosure about platform configuration

**Remediation:**

Only test org-specific credentials:

```typescript
// POST /api/settings/providers/:providerId/test
router.post('/providers/:providerId/test', async (req, res) => {
  const { providerId } = req.params;
  const orgId = req.org.id;

  const credentialService = new TenantCredentialService();
  const apiKey = await credentialService.getOrgSecret(orgId, `${providerId}-api-key`);

  if (!apiKey) {
    return res.status(400).json({
      success: false,
      error: 'not_configured',
      message: `${providerId} API key not configured for your organization. ` +
               `Please add your API key in the integration settings.`
    });
  }

  // Test the org's own credentials
  const testResult = await testProviderConnection(providerId, apiKey);
  return res.json(testResult);
});
```

---

### MT-004: Legacy Webhook Arbitrary Org Lookup [HIGH]

**Location:** `api/src/routes/webhooks.ts` (4 endpoints)

**Current Behavior:**
```typescript
// Falls back to ANY org in the database!
if (!org) {
  org = await orgRepo.findOne({ where: {} }) ?? undefined;
}
```

**Impact:**
- Webhooks could be processed under wrong tenant
- Tasks created for wrong organization
- Credentials from wrong org used

**Remediation:**

**Option A: Deprecate legacy endpoints (Recommended)**

Add deprecation warnings and sunset date:

```typescript
// Legacy endpoint - DEPRECATED
router.post('/jira', async (req, res) => {
  logger.warn('Deprecated webhook endpoint used', {
    endpoint: '/api/webhooks/jira',
    ip: req.ip,
    recommendation: 'Use /api/webhooks/:orgSlug/jira instead'
  });

  // Attempt to identify org from Jira instance URL
  const jiraBaseUrl = extractJiraBaseUrl(req.body);
  const org = await orgRepo.findOne({
    where: { jiraBaseUrl }
  });

  if (!org) {
    logger.error('Legacy webhook: cannot identify organization', {
      jiraBaseUrl,
      body: sanitizeForLogging(req.body)
    });
    return res.status(400).json({
      error: 'organization_not_found',
      message: 'Cannot identify organization. Please use org-specific webhook URL: ' +
               '/api/webhooks/{your-org-slug}/jira'
    });
  }

  // Process with identified org
  // ...
});
```

**Option B: Require org identification header**

```typescript
router.post('/jira', async (req, res) => {
  // Require explicit org identification
  const orgSlug = req.headers['x-workermill-org'] as string;

  if (!orgSlug) {
    return res.status(400).json({
      error: 'missing_org_header',
      message: 'X-WorkerMill-Org header required. ' +
               'Or use org-specific URL: /api/webhooks/{org-slug}/jira'
    });
  }

  const org = await orgRepo.findOne({ where: { slug: orgSlug } });
  if (!org) {
    return res.status(404).json({ error: 'organization_not_found' });
  }

  // Verify webhook signature using org's webhook secret
  const isValid = verifyWebhookSignature(req, org.jiraWebhookSecret);
  if (!isValid) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  // Process webhook
});
```

---

### MT-005: SCM Token Fallback [MEDIUM]

**Location:** `api/src/services/orchestrator.ts:332-339`

**Current Behavior:**
```typescript
} catch (error) {
  logger.warn(`Failed to fetch ${org.scmProvider} token, falling back to GitHub token`);
  // Keep GitHub token as fallback
}
```

**Impact:**
- Workers could operate on wrong repository
- Code changes applied to platform repos instead of tenant repos

**Remediation:**

Fail the task explicitly:

```typescript
// In orchestrator.ts
if (org.scmProvider !== 'github') {
  const scmToken = await credentialService.getOrgSecret(
    orgId,
    `${org.scmProvider}-token`
  );

  if (!scmToken) {
    throw new TaskConfigurationError(
      `${org.scmProvider} token not configured. ` +
      `Please add your ${org.scmProvider} credentials in Settings > Integrations.`
    );
  }

  credentials.scmToken = scmToken;
  credentials.scmProvider = org.scmProvider;
}
```

---

### MT-006: Ollama Host Shared [MEDIUM]

**Location:** `api/src/config/index.ts:226-228`

**Current Behavior:**
```typescript
if (providerId === "ollama") {
  return process.env.OLLAMA_HOST || "http://localhost:11434";
}
```

**Impact:**
- All tenants share platform Ollama instance
- No tenant isolation for local model inference

**Remediation:**

Check org settings first:

```typescript
if (providerId === "ollama") {
  // Check org-specific Ollama configuration first
  const orgOllamaHost = org.settings?.ollamaBaseUrl;
  if (orgOllamaHost) {
    return orgOllamaHost;
  }

  // Only use platform Ollama if explicitly allowed for this org
  if (org.settings?.allowPlatformOllama) {
    return process.env.OLLAMA_HOST || "http://localhost:11434";
  }

  throw new TenantCredentialError(
    'Ollama not configured. Please set your Ollama server URL in Settings > AI Providers, ' +
    'or contact support to enable platform Ollama access.'
  );
}
```

---

### MT-007: Extra Credentials in Worker Container [MEDIUM]

**Location:** `api/src/services/ecs-task-runner.ts:310-330`

**Current Behavior:**
```typescript
// Always passes Anthropic key as fallback
if (credentials.anthropicApiKey) {
  environment.push({
    name: "ANTHROPIC_API_KEY",
    value: credentials.anthropicApiKey,
  });
}
```

**Impact:**
- Workers have access to credentials they don't need
- Increased attack surface if worker is compromised

**Remediation:**

Only pass credentials for the configured provider:

```typescript
// In ecs-task-runner.ts
private buildWorkerEnvironment(
  task: WorkerTask,
  credentials: WorkerCredentials,
  org: Organization
): EnvironmentVariable[] {
  const environment: EnvironmentVariable[] = [];

  // Only pass the AI provider credentials needed for this task
  const provider = task.aiProvider || org.defaultProvider || 'anthropic';

  switch (provider) {
    case 'anthropic':
      if (credentials.anthropicApiKey) {
        environment.push({ name: 'ANTHROPIC_API_KEY', value: credentials.anthropicApiKey });
      }
      break;
    case 'openai':
      if (credentials.openaiApiKey) {
        environment.push({ name: 'OPENAI_API_KEY', value: credentials.openaiApiKey });
      }
      break;
    case 'google':
      if (credentials.googleApiKey) {
        environment.push({ name: 'GOOGLE_API_KEY', value: credentials.googleApiKey });
      }
      break;
    case 'ollama':
      environment.push({ name: 'OLLAMA_HOST', value: credentials.ollamaHost });
      break;
  }

  // SCM credentials - only for configured provider
  environment.push({ name: 'SCM_PROVIDER', value: org.scmProvider });
  environment.push({ name: 'SCM_TOKEN', value: credentials.scmToken });

  if (org.scmProvider === 'bitbucket') {
    environment.push({ name: 'BITBUCKET_USERNAME', value: credentials.bitbucketUsername });
  }

  return environment;
}
```

---

### MT-008: Misleading Function Name [LOW]

**Location:** `api/src/routes/settings.ts:990-1010`

**Current Behavior:**
```typescript
async function getSecretWithFallback(/*...*/) {
  // Actually does NOT have fallback - secure implementation
}
```

**Remediation:**

Rename to accurately reflect behavior:

```typescript
/**
 * Get organization-specific secret from AWS Secrets Manager.
 * Returns null if not found - does NOT fall back to platform secrets.
 */
async function getOrgSecret(
  orgId: string,
  secretName: string,
  secretPrefix: string
): Promise<string | null> {
  // ... existing secure implementation
}
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

| Task | Priority | Effort |
|------|----------|--------|
| Create `TenantCredentialService` class | P0 | 4h |
| Add `TenantCredentialError` exception class | P0 | 1h |
| Create org-specific secrets in AWS for existing tenants | P0 | 2h |
| Add credential status endpoint for UI | P1 | 2h |

### Phase 2: Critical Fixes (Week 1-2)

| Task | Priority | Effort |
|------|----------|--------|
| MT-001: Refactor `getOrgCredentials()` | P0 | 4h |
| MT-002: Remove platform fallback in `getProviderCredentials()` | P0 | 2h |
| MT-003: Fix provider test endpoint | P1 | 2h |
| Update error handling in orchestrator | P1 | 2h |

### Phase 3: High Priority Fixes (Week 2)

| Task | Priority | Effort |
|------|----------|--------|
| MT-004: Add deprecation to legacy webhooks | P1 | 2h |
| MT-004: Add org identification requirement | P1 | 3h |
| Update webhook documentation | P1 | 1h |

### Phase 4: Medium Priority Fixes (Week 3)

| Task | Priority | Effort |
|------|----------|--------|
| MT-005: Remove SCM token fallback | P2 | 2h |
| MT-006: Add org-specific Ollama config | P2 | 2h |
| MT-007: Limit worker container credentials | P2 | 3h |
| MT-008: Rename misleading function | P3 | 0.5h |

### Phase 5: UI & Documentation (Week 3-4)

| Task | Priority | Effort |
|------|----------|--------|
| Add credential status dashboard widget | P2 | 4h |
| Update Settings UI with clear credential states | P2 | 3h |
| Add setup wizard for new tenants | P2 | 6h |
| Update documentation | P2 | 2h |

---

## Testing Strategy

### Unit Tests

```typescript
describe('TenantCredentialService', () => {
  it('should return null when org secret not found', async () => {
    const service = new TenantCredentialService();
    const result = await service.getOrgSecret('org-123', 'nonexistent');
    expect(result).toBeNull();
  });

  it('should NOT fall back to platform secrets', async () => {
    // Setup: Platform secret exists, org secret does not
    await createPlatformSecret('anthropic-api-key', 'platform-key');

    const service = new TenantCredentialService();
    const result = await service.getOrgSecret('org-123', 'anthropic-api-key');

    // Should return null, NOT the platform key
    expect(result).toBeNull();
  });

  it('should throw TenantCredentialError for missing required credentials', async () => {
    const service = new TenantCredentialService();

    await expect(
      service.requireOrgSecret('org-123', 'github-token')
    ).rejects.toThrow(TenantCredentialError);
  });
});
```

### Integration Tests

```typescript
describe('Worker Spawning', () => {
  it('should fail task when org credentials missing', async () => {
    // Create org without credentials
    const org = await createOrg({ name: 'Test Org' });
    const task = await createTask({ orgId: org.id });

    // Attempt to spawn worker
    const result = await orchestrator.claimAndRun(task.id);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('credentials not configured');
  });

  it('should NOT use platform credentials for tenant task', async () => {
    const org = await createOrg({ name: 'Test Org' });
    const task = await createTask({ orgId: org.id });

    // Spy on secrets manager
    const secretsSpy = jest.spyOn(secretsClient, 'send');

    await orchestrator.claimAndRun(task.id);

    // Verify only org-specific paths were queried
    const calls = secretsSpy.mock.calls;
    calls.forEach(call => {
      const secretId = call[0].input.SecretId;
      expect(secretId).toContain(`/orgs/${org.id}/`);
      expect(secretId).not.toMatch(/^workermill\/[^/]+\/[^/]+$/); // No platform paths
    });
  });
});
```

### Manual Testing Checklist

- [ ] New tenant without credentials sees clear error, not platform credentials
- [ ] Task fails gracefully with actionable error message
- [ ] Settings UI shows "Not Configured" state clearly
- [ ] Legacy webhooks return 400 with migration instructions
- [ ] Worker containers only have credentials for their provider
- [ ] Audit logs capture credential access attempts

---

## Rollback Plan

### If Critical Issues Arise

1. **Revert code changes** via git revert
2. **Keep org-specific secrets** in AWS (no data loss)
3. **Re-enable platform fallback** temporarily
4. **Notify affected tenants** of temporary degradation

### Feature Flags (Optional)

Add feature flag for gradual rollout:

```typescript
const ENFORCE_TENANT_ISOLATION = config.featureFlags.enforceTenantIsolation;

if (ENFORCE_TENANT_ISOLATION) {
  // New secure behavior
  return await credentialService.requireOrgSecret(orgId, secretName);
} else {
  // Legacy fallback behavior (temporary)
  return await getSecretWithFallback(orgId, secretName);
}
```

---

## Appendix A: AWS Secrets Manager Audit (2026-01-29)

### Current Platform-Wide Secrets (SECURITY RISK)

These secrets are accessible to ALL tenants via fallback logic:

```
workermill/dev/
├── anthropic-api-key          # ⚠️ ALL orgs fall back to this
├── github-token               # ⚠️ ALL orgs fall back to this
├── jira-credentials           # ⚠️ ALL orgs fall back to this
├── openai-api-key             # ⚠️ ALL orgs fall back to this
├── manager-github-token       # ⚠️ Used for PR reviews
├── admin-email
├── admin-phone-number
├── database-url
├── db-credentials
├── email-webhook-secret
├── jwt-secret
├── microsoft-client-id
├── microsoft-client-secret
├── platform-api-key
├── session-secret
├── stripe-secret-key
└── stripe-webhook-secret
```

### Current Org-Specific Secrets

Only **2 of 5 orgs** have provider credentials configured:

| Org ID | Has AI Provider? | Has SCM Token? | Has Jira? | Notes |
|--------|------------------|----------------|-----------|-------|
| `fcb3c85f-55b6-44aa-a629-f3c44b89e23d` | ✅ google | ❌ | ✅ | Primary org (OnCallShift) |
| `0e40e770-4769-437f-b050-1dbaf3b42da8` | ✅ anthropic | ❌ | ❌ | Has anthropic provider |
| `2b30ea38-e230-4819-a626-529d26f58e93` | ❌ | ❌ | ❌ | Only aws-role-config |
| `9d875d55-1236-4aaa-be87-dffd50ea04e9` | ❌ | ❌ | ❌ | Only aws-role-config |
| `abc586d5-c2ca-454d-9dc6-bcbaa643fce0` | ❌ | ❌ | ❌ | Only aws-role-config |

**Critical Finding:** 3 orgs have NO credentials - they rely entirely on platform fallback!

### Detailed Org Secrets

```
workermill/dev/orgs/
├── 0e40e770-4769-437f-b050-1dbaf3b42da8/
│   ├── aws-role-config
│   └── providers/anthropic          # ✅ Has own Anthropic key
│
├── 2b30ea38-e230-4819-a626-529d26f58e93/
│   └── aws-role-config              # ❌ No AI/SCM credentials
│
├── 9d875d55-1236-4aaa-be87-dffd50ea04e9/
│   └── aws-role-config              # ❌ No AI/SCM credentials
│
├── abc586d5-c2ca-454d-9dc6-bcbaa643fce0/
│   └── aws-role-config              # ❌ No AI/SCM credentials
│
└── fcb3c85f-55b6-44aa-a629-f3c44b89e23d/
    ├── aws-role-config
    ├── jira-credentials             # ✅ Has own Jira creds
    ├── oncallshift-credentials
    └── providers/google             # ✅ Has own Google key
```

### Target Structure (Secure)

```
workermill/
├── dev/
│   ├── platform/                    # Platform-internal ONLY
│   │   ├── health-check-key
│   │   └── stripe-*                 # Billing infrastructure
│   └── orgs/
│       └── {orgId}/
│           ├── providers/
│           │   ├── anthropic        # AI provider credentials
│           │   ├── openai
│           │   └── google
│           ├── integrations/
│           │   ├── github-token     # SCM credentials
│           │   ├── jira-credentials
│           │   └── linear-credentials
│           └── aws-role-config      # Customer AWS access
└── prod/
    └── orgs/
        └── ...
```

---

## Appendix B: Code Audit Findings

### Positive Findings

The `getSecretWithFallback()` function in `settings.ts:993-1011` is **correctly implemented** - despite its misleading name, it does NOT fall back to platform secrets:

```typescript
// settings.ts:990-1011 - SECURE (no fallback)
async function getSecretWithFallback(orgId, secretName, secretPrefix) {
  // Only return org-specific secrets - no platform fallback
  try {
    const orgSecret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `${secretPrefix}/orgs/${orgId}/${secretName}`,
      })
    );
    if (orgSecret.SecretString) return orgSecret.SecretString;
  } catch {
    // Not found at org level - return null (no fallback!)
  }
  return null;
}
```

**Recommendation:** Rename to `getOrgSecret()` to avoid confusion.

### Confirmed Vulnerable Code Paths

1. **orchestrator.ts:251-267** - Direct platform secret fetch:
   ```typescript
   SecretId: `workermill/${config.environment}/anthropic-api-key`
   ```

2. **config/index.ts:193-210** - Platform fallback in `getProviderCredentials()`:
   ```typescript
   const platformSecretPath = `workermill/${env}/${providerId}-api-key`;
   ```

3. **webhooks.ts** - Arbitrary org selection (4 locations):
   ```typescript
   org = await orgRepo.findOne({ where: {} }) ?? undefined;
   ```
   - Line 190 (Jira)
   - Line 1083 (Linear)
   - Line 1431 (GitHub Issues)
   - Line 2240 (Email)

4. **orchestrator.ts:332-339** - SCM token fallback:
   ```typescript
   logger.warn(`Failed to fetch ${org.scmProvider} token, falling back to GitHub token`);
   ```

5. **settings.ts:2728-2742** - Provider test uses platform credentials

---

## Appendix C: Migration Checklist

### Pre-Deployment Checklist

- [ ] Identify your primary org ID: `fcb3c85f-55b6-44aa-a629-f3c44b89e23d`
- [ ] Create org-specific secrets for primary org:
  - [ ] `workermill/dev/orgs/{orgId}/providers/anthropic`
  - [ ] `workermill/dev/orgs/{orgId}/integrations/github-token`
  - [ ] `workermill/dev/orgs/{orgId}/integrations/jira-credentials`
- [ ] Verify oncallshift workflows still function after migration
- [ ] Update Jira webhook URL to use org-scoped endpoint
- [ ] Test legacy webhook deprecation warnings

### Tenant Communication

For the 3 orgs without credentials (`2b30ea38...`, `9d875d55...`, `abc586d5...`):
- [ ] Determine if these are test/inactive orgs
- [ ] If active: notify them to configure credentials before cutover
- [ ] If inactive: consider cleanup

---

## Approval

- [ ] Security review approved
- [ ] Architecture review approved
- [ ] Implementation plan approved
- [ ] Ready to proceed

**Approved by:** _______________
**Date:** _______________
