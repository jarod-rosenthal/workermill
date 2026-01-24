# Claude Code Skills

Custom skills for enforcing disciplined implementation workflows.

## Available Skills

| Skill | Directory | Purpose |
|-------|-----------|---------|
| `/val-imp` | `val-imp/SKILL.md` | Enforce strict plan adherence with validator agents |

---

## How to Use: /val-imp

### Quick Start

```
/val-imp docs/my-plan.md
```

Or with inline plan from conversation:
```
/val-imp
```

---

## Detailed Usage Examples

### Example 1: Feature Implementation from Plan File

**Your plan file (docs/auth-plan.md):**
```markdown
# Authentication Feature Plan

## Requirements

1. Create AuthService class in src/services/auth.ts
   - Method: login(email, password) returns JWT token
   - Method: verify(token) returns user or null
   - Method: logout(token) invalidates token

2. Create login endpoint POST /api/auth/login
   - Accepts: { email, password }
   - Returns: { token, expiresIn }
   - Error 401 if credentials invalid

3. Create verify endpoint GET /api/auth/verify
   - Requires Authorization header with Bearer token
   - Returns: { user } or 401

4. Add auth middleware
   - Extracts token from Authorization header
   - Calls AuthService.verify()
   - Attaches user to request or returns 401
```

**Your command:**
```
/val-imp docs/auth-plan.md
```

**What happens:**

1. Claude reads your plan
2. Extracts 4 requirements with acceptance criteria
3. Asks you to confirm the extraction
4. Implements requirement 1
5. Spawns validator agent to check requirement 1
6. Reports PASS/FAIL, fixes if needed
7. Repeats for requirements 2-4
8. Final validation of all requirements
9. Gap report

---

### Example 2: Fixing Specific Failed Requirements

If the validator found gaps:

```
The validator found REQ-3 failed: Missing 401 response on invalid token.

Fix only REQ-3 using /val-imp, then re-validate.
```

---

### Example 3: Inline Plan from Conversation

```
I need you to implement this:

Database Migration:
- Add 'preferences' column (JSONB) to users table
- Default value: {}
- Add index on preferences->'theme'

API Changes:
- GET /api/users/:id/preferences - returns preferences JSON
- PUT /api/users/:id/preferences - updates preferences, merges with existing

/val-imp
```

---

### Example 4: Partial Implementation

```
/val-imp docs/big-feature.md --only REQ-1,REQ-2,REQ-3
```

---

## What /val-imp Enforces

| Rule | Description |
|------|-------------|
| Extraction first | Must parse plan into numbered requirements before coding |
| User confirmation | Must get approval on extracted requirements |
| One at a time | Implement one requirement, validate, then next |
| Independent validation | Validator agent has no context of implementation decisions |
| Fix before proceed | Cannot mark requirement done until validator passes |
| No extras | No features, improvements, or refactoring beyond plan |
| Deviation reporting | Any additions/changes from plan are flagged |

---

## Common Scenarios

### "The plan is ambiguous"

Claude will:
1. Stop implementation
2. Quote the ambiguous section
3. Present 2-3 interpretations
4. Ask you to clarify before proceeding

### "I need to deviate from the plan"

Claude will:
1. Stop implementation
2. Explain why deviation seems necessary
3. Ask: "Update plan to match new approach, or find way to match plan?"
4. Wait for your decision

### "The validator is wrong"

You can:
```
The validator incorrectly failed REQ-3. The implementation is correct because [reason].
Override validation and mark REQ-3 complete.
```

### "Skip validation for this one"

```
Implement REQ-4 without validation (I'll test manually).
```

---

## Tips for Writing Plans

### Good Plan Structure

```markdown
# Feature: [Name]

## Context
[Brief background - why this feature]

## Requirements

### REQ-1: [Title]
[Clear description]
- Specific detail 1
- Specific detail 2
Acceptance: [How to verify this is done]

### REQ-2: [Title]
...

## Out of Scope
- [Things explicitly NOT to do]

## Technical Notes
- [Constraints, existing patterns to follow, etc.]
```

### Plan Anti-Patterns

| Bad | Better |
|-----|--------|
| "Improve the auth system" | "Add rate limiting: max 5 login attempts per minute per IP" |
| "Make it faster" | "Add Redis caching to GET /users with 5 minute TTL" |
| "Handle errors properly" | "Return 400 with {error: message} for validation failures" |
| "Add tests" | "Add unit tests for AuthService.login() covering: valid creds, invalid password, unknown email" |

---

## Integration with Task Tracking

/val-imp uses Claude's TaskCreate/TaskUpdate tools:

- Each requirement becomes a tracked task
- Tasks show status: pending → in_progress → completed
- Use `/tasks` to see current status
- Failed validations keep task in_progress

---

## Troubleshooting

### "Claude skipped extraction and started coding"

Remind:
```
Stop. You must follow /val-imp. Start from Phase 1: Requirement Extraction.
```

### "Claude marked requirement done without validation"

```
That requirement wasn't validated. Spawn a validator agent now to check REQ-X.
```

### "Validation keeps failing but implementation looks correct"

```
Show me the exact validator prompt and response. Let's debug whether the validation criteria is too strict.
```

### "Claude added features not in the plan"

The validator should catch this. If not:
```
The plan didn't mention [feature]. Remove it - /val-imp means literal plan adherence.
```
