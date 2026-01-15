# Agent B Instructions

**Role:** Frontend + Notifications
**Task ID:** `00000000-0000-0000-0000-000000000002`

---

## File Locking - REQUIRED

Before editing ANY file, you must lock it via the coordination API.

### Lock Your Files

```bash
curl -X POST https://workermill.com/api/coordination/manifest/declare \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "taskId": "00000000-0000-0000-0000-000000000002",
    "repo": "workermill",
    "branch": "main",
    "filesToModify": [
      "frontend/src/pages/Signup.tsx",
      "api/src/models/OrgInvite.ts"
    ]
  }'
```

If you get a **409 conflict**, another agent has that file locked. Wait or choose different files.

### Release When Done

```bash
curl -X DELETE https://workermill.com/api/coordination/manifest/00000000-0000-0000-0000-000000000002 \
  -H "X-API-Key: $API_KEY"
```

---

## Your Assigned Files

These are yours to lock and edit:

```
frontend/src/pages/Signup.tsx (new)
frontend/src/pages/Billing.tsx (new)
frontend/src/pages/Analytics.tsx (new)
frontend/src/pages/Settings.tsx
api/src/models/OrgInvite.ts (new)
api/src/routes/organizations.ts
api/src/routes/analytics.ts (new)
api/src/services/notifications.ts (new)
```

---

## DO NOT EDIT (Agent A owns these)

```
api/src/models/Organization.ts
api/src/services/orchestrator.ts
api/src/services/billing.ts
api/src/routes/billing.ts
api/src/routes/auth.ts
```

---

## Shared Files (Lock first!)

For these files, declare a manifest before editing:

```
api/src/routes/index.ts
api/src/models/index.ts
frontend/src/App.tsx
api/src/db/connection.ts
```

---

## Your Tasks

1. **OrgInvite Model** - `api/src/models/OrgInvite.ts`
2. **Invite Routes** - `api/src/routes/organizations.ts`
3. **Notifications Service** - `api/src/services/notifications.ts`
4. **Signup Page** - `frontend/src/pages/Signup.tsx`
5. **Billing Page** - `frontend/src/pages/Billing.tsx`
6. **Team Settings** - Update `frontend/src/pages/Settings.tsx`
7. **Analytics Page** - `frontend/src/pages/Analytics.tsx`
8. **Analytics Routes** - `api/src/routes/analytics.ts`

---

## Available from Agent A

Agent A has completed the backend. You can use:

```typescript
// Billing info
import { getBillingInfo, canCreateTask } from "../services/billing.js";

// Plan constants
import { PLAN_QUOTAS, PLAN_USER_LIMITS } from "../models/Organization.js";
```

**API Endpoints ready:**
- `GET /api/billing/status` - Current plan and usage
- `GET /api/billing/plans` - Available plans
- `POST /api/billing/checkout` - Create Stripe checkout
- `GET /api/billing/usage` - Usage stats

---

## Verify Your Work

```bash
cd api && npm run typecheck
cd frontend && npx tsc -b
```

Both must pass before marking tasks complete.
