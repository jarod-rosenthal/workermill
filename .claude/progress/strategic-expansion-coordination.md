# Strategic Expansion - Multi-Agent Coordination

**Using:** WorkerMill File Lock System (`/api/coordination/*`)

---

## How File Locking Works

Both agents use the coordination API to lock files before editing. Locks are stored in the database and auto-expire after 30 minutes if not renewed.

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/coordination/manifest/declare` | POST | Declare files you'll edit (auto-locks them) |
| `/api/coordination/manifest?repo=workermill` | GET | See what's locked by other workers |
| `/api/coordination/manifest/:taskId` | DELETE | Release all your locks when done |
| `/api/coordination/locks?repo=workermill` | GET | Check current file locks |

### Authentication
All requests require header: `X-API-Key: <org-api-key>`

---

## Agent Setup

### Agent A (Backend)
```
AGENT_ID: agent-a-backend
TASK_ID: 00000000-0000-0000-0000-000000000001
```

### Agent B (Frontend)
```
AGENT_ID: agent-b-frontend
TASK_ID: 00000000-0000-0000-0000-000000000002
```

---

## Before Editing Any File

**Step 1:** Declare your manifest (locks all files atomically)

```bash
curl -X POST https://workermill.com/api/coordination/manifest/declare \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "taskId": "YOUR_TASK_ID",
    "repo": "workermill",
    "branch": "main",
    "filesToModify": [
      "api/src/services/billing.ts",
      "api/src/models/Organization.ts"
    ]
  }'
```

**Response if success:**
```json
{"success": true, "conflicts": [], "locksAcquired": ["api/src/services/billing.ts", ...]}
```

**Response if conflict (409):**
```json
{
  "success": false,
  "conflicts": [{
    "filePath": "api/src/services/billing.ts",
    "heldBy": {"taskId": "...", "workerId": "agent-a", "expiresAt": "..."}
  }],
  "locksAcquired": []
}
```

**Step 2:** If conflict, wait and retry or pick different files.

**Step 3:** When done, release your locks:
```bash
curl -X DELETE https://workermill.com/api/coordination/manifest/YOUR_TASK_ID \
  -H "X-API-Key: $API_KEY"
```

---

## File Assignments

### Agent A Files (Backend)
```
api/src/models/Organization.ts
api/src/services/billing.ts
api/src/services/orchestrator.ts
api/src/routes/billing.ts
api/src/routes/auth.ts
api/src/db/migrations/*billing*
```

### Agent B Files (Frontend)
```
frontend/src/pages/Signup.tsx
frontend/src/pages/Billing.tsx
frontend/src/pages/Analytics.tsx
frontend/src/pages/Settings.tsx
api/src/models/OrgInvite.ts
api/src/routes/organizations.ts
api/src/routes/analytics.ts
api/src/services/notifications.ts
```

### Shared Files (Lock before editing)
```
api/src/routes/index.ts
api/src/models/index.ts
frontend/src/App.tsx
api/src/db/connection.ts
```

---

## Check Current Locks

See what's locked right now:
```bash
curl "https://workermill.com/api/coordination/locks?repo=workermill" \
  -H "X-API-Key: $API_KEY"
```

---

## Progress Tracking

### Agent A
- [x] Organization model billing fields
- [x] Stripe billing service
- [x] Billing routes
- [x] Stripe webhook handler
- [x] Quota enforcement in orchestrator

### Agent B (Completed by Agent A)
- [x] OrgInvite model
- [ ] Organization invite routes
- [x] Notifications service
- [x] Signup page
- [x] Billing page
- [ ] Team settings UI
- [x] Analytics page
- [x] Analytics routes

---

## Lock Expiry

Locks expire after **30 minutes** by default. For long-running work, send heartbeats or re-declare your manifest to extend locks.
