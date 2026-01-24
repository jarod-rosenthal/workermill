---
name: val-imp
description: Enforce strict plan adherence by extracting requirements, implementing one at a time, and validating each with an independent agent. Prevents drift from specifications.
argument-hint: [plan-file-path]
---

# Validated Implementation

Enforce strict plan adherence by using independent validator agents that check implementation against original requirements. Prevents drift by creating external accountability.

## Workflow Overview

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ 1. EXTRACT   │───▶│ 2. IMPLEMENT │───▶│ 3. VALIDATE  │
│ Requirements │    │ One at a time│    │ Fresh agent  │
└──────────────┘    └──────────────┘    └──────────────┘
                           │                   │
                           │    ┌──────────────┘
                           ▼    ▼
                    ┌──────────────┐
                    │ 4. FIX GAPS  │
                    │ or continue  │
                    └──────────────┘
```

---

## PHASE 1: REQUIREMENT EXTRACTION

**MANDATORY FIRST STEP - DO NOT SKIP**

Before writing ANY code, you MUST:

1. Read the plan file completely (argument passed to skill, or from conversation context)
2. Extract every discrete requirement into a numbered list
3. Create a task for each requirement using TaskCreate
4. Present the extracted requirements to the user for confirmation

### Extraction Format

For each requirement found in the plan, create:

```
REQUIREMENT [N]: [Short title]
Source: [Quote the exact text from the plan]
Acceptance: [What specifically must be true for this to be complete]
Files likely affected: [Best guess at files]
```

### Example Extraction

Given a plan that says:
> "Add a UserPreferences model with fields for theme (dark/light),
> notification settings, and timezone. Create CRUD API endpoints."

Extract as:

```
REQUIREMENT 1: UserPreferences Model
Source: "Add a UserPreferences model with fields for theme (dark/light), notification settings, and timezone"
Acceptance: Model file exists with theme, notificationSettings, timezone fields
Files likely affected: src/models/UserPreferences.ts

REQUIREMENT 2: Preferences API - Create
Source: "Create CRUD API endpoints"
Acceptance: POST /api/preferences endpoint creates a preference record
Files likely affected: src/routes/preferences.ts

REQUIREMENT 3: Preferences API - Read
Source: "Create CRUD API endpoints"
Acceptance: GET /api/preferences endpoint returns user preferences
Files likely affected: src/routes/preferences.ts

REQUIREMENT 4: Preferences API - Update
Source: "Create CRUD API endpoints"
Acceptance: PUT /api/preferences endpoint updates preferences
Files likely affected: src/routes/preferences.ts

REQUIREMENT 5: Preferences API - Delete
Source: "Create CRUD API endpoints"
Acceptance: DELETE /api/preferences endpoint removes preferences
Files likely affected: src/routes/preferences.ts
```

### Task Creation

After extraction, create tasks:

```typescript
TaskCreate({
  subject: "REQ-1: UserPreferences Model",
  description: "Source: '...' | Acceptance: Model file exists with theme, notificationSettings, timezone fields",
  activeForm: "Implementing UserPreferences Model"
})
```

### User Confirmation Gate

After extracting requirements, STOP and ask:

```
I've extracted [N] requirements from your plan:

[List requirements]

Before I implement, please confirm:
1. Are all requirements captured?
2. Any requirements missing?
3. Any requirements you want to remove/modify?

Reply 'proceed' to start implementation or provide corrections.
```

**DO NOT PROCEED UNTIL USER CONFIRMS**

---

## PHASE 2: IMPLEMENT ONE REQUIREMENT AT A TIME

For each requirement in order:

1. **Mark task in-progress**
   ```typescript
   TaskUpdate({ taskId: "X", status: "in_progress" })
   ```

2. **State what you're implementing**
   ```
   Implementing REQ-1: UserPreferences Model
   Plan says: "[exact quote from plan]"
   I will: [specific actions]
   ```

3. **Implement ONLY what the requirement specifies**
   - No extra features
   - No "improvements"
   - No refactoring of surrounding code
   - Literal interpretation of the plan

4. **After implementation, IMMEDIATELY validate (Phase 3)**

---

## PHASE 3: VALIDATION VIA INDEPENDENT AGENT

**CRITICAL: This is what prevents drift**

After implementing each requirement, spawn a validator agent:

```typescript
Task({
  subagent_type: "general-purpose",
  prompt: `You are a strict requirement validator. You have NO context about why decisions were made.

ORIGINAL REQUIREMENT:
"[Paste the exact requirement text from the plan]"

ACCEPTANCE CRITERIA:
[Paste the acceptance criteria]

FILES TO CHECK:
[List the files that were created/modified]

YOUR TASK:
1. Read each file listed
2. Check if the implementation EXACTLY matches the requirement
3. Report any deviations, missing elements, or additions not in the requirement

OUTPUT FORMAT:
REQUIREMENT: [requirement text]
STATUS: PASS | FAIL | PARTIAL
FINDINGS:
- [specific finding 1]
- [specific finding 2]
DEVIATIONS FROM PLAN:
- [any additions not requested]
- [any missing elements]
- [any modifications to spec]

Be strict. If the plan said "dark/light" and implementation has "dark/light/system", that's a deviation.`,
  description: "Validate REQ-X implementation"
})
```

### Handling Validation Results

**If PASS:**
```typescript
TaskUpdate({ taskId: "X", status: "completed" })
```
Proceed to next requirement.

**If FAIL or PARTIAL:**
1. DO NOT mark complete
2. List the specific gaps found by validator
3. Fix each gap
4. Re-run validation
5. Repeat until PASS

**Report to user:**
```
REQ-1 Validation: FAIL
Validator found:
- Missing: timezone field not added
- Deviation: Added 'language' field not in plan

Fixing now...
[make fixes]

Re-validating...
```

---

## PHASE 4: COMPLETION CHECKLIST

After all requirements are implemented and validated:

1. **Run final validation agent** that checks ALL requirements together:

```typescript
Task({
  subagent_type: "general-purpose",
  prompt: `FINAL VALIDATION - Check all requirements against implementation.

ORIGINAL PLAN FILE CONTENTS:
[Paste entire plan]

REQUIREMENTS EXTRACTED:
[List all N requirements]

FILES CREATED/MODIFIED:
[List all files]

Check each requirement. For each one report:
- PASS/FAIL
- Evidence (what in the code satisfies it)
- Gaps (what's missing)

End with:
COVERAGE: X/N requirements fully satisfied
GAPS: [list any gaps]`,
  description: "Final plan validation"
})
```

2. **Generate gap report:**

```
## Implementation Summary

Plan: [plan file path]
Requirements extracted: N
Requirements passed: X
Requirements failed: Y

### Passed
- REQ-1: UserPreferences Model ✓
- REQ-2: Preferences API - Create ✓

### Failed/Incomplete
- REQ-5: Delete endpoint - NOT IMPLEMENTED (validator found no DELETE route)

### Deviations from Plan
- Added 'updatedAt' timestamp (not in original plan)

### Files Changed
- src/models/UserPreferences.ts (created)
- src/routes/preferences.ts (created)
```

3. **Ask user about gaps:**

```
Implementation complete with gaps noted above.

Options:
1. Fix the gaps now
2. Accept current implementation
3. Review specific items

What would you like to do?
```

---

## STRICT RULES

1. **NEVER skip requirement extraction** - Always parse the plan first
2. **NEVER implement without user confirmation** of extracted requirements
3. **NEVER mark a requirement complete without validation**
4. **NEVER proceed past a FAIL** without fixing and re-validating
5. **NEVER add features not in the plan** - If you think something is needed, ask first
6. **ALWAYS quote the original plan** when stating what you're implementing
7. **ALWAYS use a fresh agent for validation** - Don't validate your own work in the same context
8. **ALWAYS report deviations** - Even "improvements" are deviations

---

## ERROR RECOVERY

**If you realize mid-implementation you deviated:**
1. STOP immediately
2. State what the plan said vs what you did
3. Ask user: "Should I revert to match plan, or update plan to match implementation?"

**If the plan is ambiguous:**
1. STOP immediately
2. Quote the ambiguous part
3. Offer 2-3 interpretations
4. Ask user to clarify before proceeding

**If implementation is blocked by technical constraint:**
1. STOP immediately
2. Explain the constraint
3. Propose alternatives that still satisfy the requirement
4. Get user approval before proceeding

---

## EXAMPLE SESSION

```
User: /validate-impl docs/notification-plan.md

Claude: Reading plan file...

I've extracted 4 requirements from docs/notification-plan.md:

REQUIREMENT 1: Notification Model
Source: "Create Notification entity with fields: id, userId, message, read, createdAt"
Acceptance: Model exists with all 5 fields, proper types

REQUIREMENT 2: Create Notification Endpoint
Source: "POST /api/notifications - create new notification for user"
Acceptance: Endpoint exists, creates notification, returns 201

REQUIREMENT 3: List Notifications Endpoint
Source: "GET /api/notifications - list notifications for authenticated user"
Acceptance: Endpoint exists, filters by user, returns array

REQUIREMENT 4: Mark Read Endpoint
Source: "PATCH /api/notifications/:id/read - mark notification as read"
Acceptance: Endpoint exists, updates read=true, returns 200

Before I implement, please confirm these requirements are correct.
Reply 'proceed' or provide corrections.

User: proceed

Claude: Starting implementation...

[TaskCreate for each requirement]

---
Implementing REQ-1: Notification Model
Plan says: "Create Notification entity with fields: id, userId, message, read, createdAt"
I will: Create src/models/Notification.ts with exactly these 5 fields

[Creates file]

Validating REQ-1...

[Spawns validator agent]

Validator result: PASS
- id field (UUID, primary)
- userId field (string)
- message field (string)
- read field (boolean)
- createdAt field (timestamp)
- No deviations found

REQ-1 complete. Moving to REQ-2...

---
Implementing REQ-2: Create Notification Endpoint
Plan says: "POST /api/notifications - create new notification for user"
...

[Continues through all requirements]

---

## Final Validation

[Spawns final validator]

COVERAGE: 4/4 requirements fully satisfied
GAPS: None
DEVIATIONS: None

## Files Changed
- src/models/Notification.ts (created)
- src/routes/notifications.ts (created)

Implementation complete and validated.
```
