# Worker Issues Inventory - OCS-243 Run

**Task ID:** e2f99108-6e5a-4869-9b2e-05747adef540
**Jira Issue:** OCS-243
**Persona:** frontend_developer
**Model:** haiku
**Final Result:** `::result::deployed` (but deployment actually failed)

---

## CRITICAL ISSUES (Must Fix Before Demo)

### 1. SSL/TLS Certificate Verification Failure

**Severity:** CRITICAL - Blocks all GitHub operations after Docker build
**Error Messages:**
```
Post "https://api.github.com/graphql": tls: failed to verify certificate: x509: certificate signed by unknown authority
fatal: unable to access 'https://github.com/jarod-rosenthal/pagerduty-lite.git/': server certificate verification failed. CAfile: none CRLfile: none
```

**Impact:**
- `gh pr merge` command fails
- `git pull` command fails
- Agent cannot merge PRs or pull latest changes

**Root Cause:** CA certificates are likely missing or corrupted in the worker container after the Kaniko build process runs. This happens because Kaniko modifies the filesystem.

**Fix Options:**
1. **Reinstall CA certificates after Kaniko runs:**
   ```bash
   update-ca-certificates
   ```
2. **Set GIT_SSL_NO_VERIFY=true** (not recommended for production)
3. **Copy CA certs before Kaniko and restore after**
4. **Run `gh` and `git` commands BEFORE Kaniko build**

---

### 2. Kaniko Docker Build Failure - dpkg Error

**Severity:** CRITICAL - Blocks all container deployments
**Error:**
```
E: Sub-process /usr/bin/dpkg returned an error code (1)
error building image: error building stage: failed to execute command: waiting for process to exit: exit status 100
```

**Location in Dockerfile (oncallshift):**
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    bash \
    awscli \
    && rm -rf /var/lib/apt/lists/*
```

**Root Cause:** dpkg fails with exit code 1, likely due to:
- Package conflict
- Interrupted dpkg state
- Network issue during package download
- Kaniko filesystem issues

**Fix Options:**
1. **Add dpkg recovery to Dockerfile:**
   ```dockerfile
   RUN dpkg --configure -a || true && \
       apt-get update && apt-get install -y --no-install-recommends \
       postgresql-client bash awscli && \
       rm -rf /var/lib/apt/lists/*
   ```
2. **Use --fix-broken:**
   ```dockerfile
   RUN apt-get update && apt-get --fix-broken install -y && \
       apt-get install -y --no-install-recommends ...
   ```
3. **Test building the image locally first** to reproduce and debug

---

### 3. EISDIR Error - Agent Tried to Read a Directory

**Severity:** MEDIUM - Wastes tokens but agent recovered
**Error:**
```
EISDIR: illegal operation on a directory, read
```

**Occurrences:** 2 times
**Cause:** Agent tried to `Read` a directory path (`/app/directives/common`) instead of using `Glob` or listing files first.

**Fix:** Add to AGENTS.md:
```markdown
**IMPORTANT:** Never use Read tool on a directory. Use Glob or `ls` first to list files, then read specific files.
```

---

## MEDIUM ISSUES (Should Fix)

### 4. Agent Reported `::result::deployed` Despite Deployment Failure

**Severity:** MEDIUM - Misleading status
**Issue:** The agent output `::result::deployed` even though:
- Docker build failed
- No actual deployment occurred
- PR merge was blocked

**Impact:** Task shows as "deployed" in dashboard when it actually failed.

**Fix Options:**
1. **Update agent directives** to only output `::result::deployed` if:
   - Docker build succeeded
   - Deployment to ECS succeeded
   - Health check passed
2. **Add validation in entrypoint** to verify deployment markers match actual state

---

### 5. TypeScript Build Errors in Target Repo (oncallshift)

**Severity:** LOW - Pre-existing, not caused by agent
**Errors:** Multiple TypeORM decorator errors when running `npx tsc --noEmit`

**Note:** These are pre-existing issues in the oncallshift repo, not introduced by the agent. The agent correctly recognized this and proceeded.

---

### 6. npm Deprecation Warnings

**Severity:** LOW - Informational
**Warnings:**
```
npm warn deprecated rimraf@3.0.2
npm warn deprecated scmp@2.1.0
npm warn deprecated npmlog@5.0.1
npm warn deprecated lodash.isequal@4.5.0
npm warn deprecated inflight@1.0.6
npm warn deprecated eslint@8.57.1
npm warn deprecated @azure/monitor-query@1.3.3
```

**Impact:** None for functionality, but indicates outdated dependencies in oncallshift.

---

## SUMMARY OF REQUIRED FIXES

| Priority | Issue | Fix Location | Effort |
|----------|-------|--------------|--------|
| P1 | SSL/TLS cert failure | Worker Dockerfile or entrypoint.sh | 1 hour |
| P1 | Kaniko dpkg error | oncallshift Dockerfile | 30 min |
| P2 | EISDIR error | AGENTS.md directive | 10 min |
| P2 | False `deployed` status | Agent directives or validation | 1 hour |

---

## RECOMMENDED PRE-DEMO CHECKLIST

1. [ ] **Fix oncallshift Dockerfile** - Add `dpkg --configure -a` before apt-get
2. [ ] **Fix SSL certs in worker** - Run `update-ca-certificates` after Kaniko
3. [ ] **Test a full end-to-end run** before demo
4. [ ] **Have backup plan** - If deployment fails, show PR creation success instead

---

## POSITIVE OUTCOMES

Despite the issues, the agent did successfully:
- Clone the repository
- Create the correct branch (`ai/OCS-243`)
- Analyze the codebase thoroughly
- Make all necessary code changes (backend model, migration, auth middleware, frontend types, UI component)
- Commit changes with proper message
- Create PR #175 successfully
- Add analysis and completion comments to Jira
- Transition ticket to Done

**PR Created:** https://github.com/jarod-rosenthal/pagerduty-lite/pull/175

The code changes themselves appear to be correct - only the deployment infrastructure failed.
