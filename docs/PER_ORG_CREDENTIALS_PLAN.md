# Plan: Per-Org Credential Isolation for Multi-Tenancy

## Goal

Enable true multi-tenant isolation by requiring each organization to configure their own credentials for GitHub, Jira, and AI providers.

---

## Current State

### What's Already Built

- **API endpoints exist** for provider credentials (`api/src/routes/settings.ts`):
  - `GET /api/settings/providers` - List providers with config status
  - `PUT /api/settings/providers/:providerId/credentials` - Save API key
  - `POST /api/settings/providers/:providerId/test` - Test credentials
- **Secrets Manager integration** with org-specific paths:
  - `workermill/{env}/orgs/{orgId}/providers/{providerId}`
- **`getProviderCredentials()` function** in `api/src/config/index.ts` resolves org → platform fallback

### What's Broken

- **Orchestrator ignores org credentials** - `getOrgCredentials()` in `orchestrator.ts` fetches platform-wide secrets directly
- **No per-org GitHub/Jira** - Only AI providers have org-specific support; GitHub and Jira are platform-wide
- **No frontend UI** - Settings page has Jira/GitHub forms but they use platform credentials
- **No validation** - Workers spawn even if org has no credentials configured

---

## Implementation Plan

### Phase 1: Backend - Extend Credential System (API changes)

**File: `api/src/routes/settings.ts`**

1. Add integration endpoints for per-org GitHub and Jira:
   - `PUT /api/settings/integrations/github` → Save to `workermill/{env}/orgs/{orgId}/integrations/github`
   - `PUT /api/settings/integrations/jira` → Save to `workermill/{env}/orgs/{orgId}/integrations/jira`
   - Update existing endpoints to use org-specific paths instead of platform paths

2. Add status endpoint that shows what's configured:
   - `GET /api/settings/integrations` → Return `{ github: { configured: bool }, jira: { configured: bool }, providers: {...} }`

**File: `api/src/config/index.ts`**

3. Add `getOrgIntegrationCredentials(orgId, integration)` function:
   - Resolution: org-specific → platform fallback → error
   - Integrations: `github`, `jira`

### Phase 2: Backend - Update Orchestrator

**File: `api/src/services/orchestrator.ts`**

4. Modify `getOrgCredentials()` to use org-specific credentials:
   ```typescript
   // BEFORE: Fetches platform secrets directly
   const anthropicSecret = await secretsClient.send(...)

   // AFTER: Use org-specific resolution
   const anthropicKey = await getProviderCredentials(orgId, 'anthropic');
   const githubToken = await getOrgIntegrationCredentials(orgId, 'github');
   const jiraCreds = await getOrgIntegrationCredentials(orgId, 'jira');
   ```

5. Add credential validation before spawning:
   ```typescript
   // Check required credentials exist
   if (!githubToken) {
     throw new Error('GitHub token not configured for organization');
   }
   ```

6. Update error handling to surface missing credential errors to dashboard

### Phase 3: Frontend - Settings UI

**File: `frontend/src/pages/Settings.tsx`**

7. Update Integrations section to save org-specific credentials:
   - GitHub: Token input + default repo + Test/Save buttons
   - Jira: Base URL + Email + API Token + Test/Save buttons
   - Show clear "Not Configured" state when credentials missing

8. Add AI Providers section (new):
   - List all providers (Anthropic, OpenAI, Google, Ollama)
   - For each: API key input + Test/Save buttons
   - Status indicator (configured/not configured)

9. Add "Onboarding Checklist" component:
   - [ ] GitHub connected
   - [ ] AI provider configured
   - [ ] (Optional) Jira connected
   - Show warning banner if required credentials missing

### Phase 4: Validation & Error Handling

**File: `api/src/services/orchestrator.ts`**

10. Add pre-flight credential check:
    ```typescript
    async function validateOrgCredentials(orgId: string, task: WorkerTask) {
      const missing = [];
      if (!await hasCredential(orgId, 'github')) missing.push('GitHub');
      if (!await hasCredential(orgId, task.workerProvider)) missing.push(task.workerProvider);
      if (task.jiraIssueKey && !await hasCredential(orgId, 'jira')) missing.push('Jira');
      return missing;
    }
    ```

11. Update task creation to check credentials:
    - If missing, set task status to `blocked` with error message
    - Show in dashboard: "Missing credentials: GitHub, Anthropic"

**File: `frontend/src/pages/Dashboard.tsx`**

12. Show credential error banner when tasks are blocked due to missing credentials

### Phase 5: Migration & Cleanup

13. Create migration script for existing orgs:
    - Copy platform credentials to first org (your org)
    - Log which orgs need credential configuration

14. Update documentation:
    - `docs/DESIGN_PARTNER_ONBOARDING.md` - Add credential setup steps
    - `docs/USER_GUIDE.md` - Document per-org credentials

---

## Files to Modify

| File | Changes |
|------|---------|
| `api/src/routes/settings.ts` | Update integration endpoints to use org-specific paths |
| `api/src/config/index.ts` | Add `getOrgIntegrationCredentials()` function |
| `api/src/services/orchestrator.ts` | Use org credentials, add validation |
| `frontend/src/pages/Settings.tsx` | Add provider credentials UI, update integration forms |
| `docs/DESIGN_PARTNER_ONBOARDING.md` | Add credential setup section |

---

## Secrets Manager Path Structure

```
workermill/dev/
├── anthropic-api-key          # Platform fallback (your key)
├── github-token               # Platform fallback (your token)
├── jira-credentials           # Platform fallback (your Jira)
└── orgs/
    └── {orgId}/
        ├── providers/
        │   ├── anthropic      # Org's Anthropic key
        │   ├── openai         # Org's OpenAI key
        │   └── google         # Org's Google key
        └── integrations/
            ├── github         # Org's GitHub token
            └── jira           # Org's Jira credentials (JSON)
```

---

## Verification Steps

1. **Create test org** without any credentials
2. **Attempt to create task** → Should fail with "Missing credentials" error
3. **Configure GitHub token** via Settings UI
4. **Configure Anthropic key** via Settings UI
5. **Create task** → Should succeed and use org-specific credentials
6. **Verify isolation** → Platform credentials should NOT be used for new org

---

## Risk Mitigation

- **Backward compatibility**: Platform fallback ensures existing workflows don't break
- **Gradual rollout**: Can enable per-org requirement via feature flag
- **Credential testing**: Test buttons validate before save
- **Clear error messages**: Dashboard shows exactly which credentials are missing

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Backend credential system | 2-3 hours |
| Phase 2: Orchestrator updates | 2-3 hours |
| Phase 3: Frontend UI | 3-4 hours |
| Phase 4: Validation & errors | 1-2 hours |
| Phase 5: Migration & docs | 1 hour |
| **Total** | **~10-12 hours** |
