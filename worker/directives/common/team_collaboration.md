# Team Collaboration Protocol

## REQUIRED Actions (Do These or Your Work May Be Rejected)

1. First architectural choice → `post_context "decision" "DEC-001: ..."`
2. Before implementing security/auth/data areas → `ask_siblings` (async, continue working)
3. At task start → `check_sibling_questions` and answer if you can
4. If blocked waiting on another worker → `post_context "blocker" "..."`

---

## Decision Messages

### When to Post (High Signal Only)
Post decisions ONLY for:
- Interface definitions (API contracts, schemas)
- Persistence choices (database, caching)
- Security decisions (auth, encryption, validation)
- Cross-module patterns (shared utilities, conventions)
- External dependencies (libraries, services)

DO NOT post decisions for:
- Internal variable names or code style
- Minor refactoring within a module
- Obvious/standard implementation choices

### Limit: 1-3 decisions per story
More than 3 suggests you're over-sharing. Less than 1 suggests you're under-communicating.

### Format
```bash
post_context "decision" "DEC-001: Using bcrypt with cost=12 for password hashing
Rationale: Industry standard, good security/performance balance
Impacts: api/src/services/auth.ts, users table
Status: accepted"
```

Use sequential IDs (DEC-001, DEC-002) within your story for traceability.

---

## Questions (Async-First)

### Pattern: Ask Early, Continue Working

```bash
question_id=$(ask_siblings "Q-001: Is localStorage acceptable for JWT?
Context: Building auth flow for frontend
Options: A) localStorage B) httpOnly cookie C) memory only
Recommendation requested from: security_engineer")

# Continue with non-security work while waiting
# ... implement UI components ...

# Before committing auth code, check for answer
answer=$(wait_for_answer "$question_id" 30)
```

### If No Answer: Post Tentative Decision
```bash
if [ -z "$answer" ]; then
    post_context "decision" "DEC-002: [TENTATIVE - pending security review] Using httpOnly cookies
Rationale: More secure than localStorage, awaiting confirmation
Impacts: auth flow, cookie configuration
Status: proposed"
fi
```

### Only Hard-Block For
- Auth token storage mechanism
- Encryption algorithm selection
- Data deletion/retention semantics
- Breaking changes to shared APIs

For these, use longer timeout (300s) and don't proceed without answer or explicit fallback.

---

## Answering Questions

### At Task Start
```bash
check_sibling_questions
```

If you see a question matching your expertise:

```bash
answer_sibling "question-uuid" "A-001 (re: Q-001): Use httpOnly cookies, not localStorage
Rationale: XSS protection, automatic inclusion in requests
Assumptions: Backend can set cookies, no cross-origin issues"
```

### Answer Guidelines
- Reference the question ID (A-### re: Q-###)
- State your assumptions
- For security answers, mention threat model
- Be concise - your teammate needs to move fast

### Trust Posture
Your answers are **advisory**. The questioner should:
- Validate against their specific context
- Mark their decision as informed by your input
- Escalate if your answer contradicts requirements

---

## Blockers

Post when you're genuinely stuck waiting on another worker:

```bash
post_context "blocker" "Waiting on backend API spec for /users endpoint
Blocking: frontend user list component
Need from: backend_developer"
```

Do NOT use blocker for:
- Things you can work around
- General uncertainty (use question instead)

---

## Message Type Reference

| Type | When | ID Format |
|------|------|-----------|
| decision | Architectural choices affecting others | DEC-### |
| question | Need expertise outside your specialty | Q-### |
| answer | Responding to sibling question | A-### (re: Q-###) |
| blocker | Genuinely stuck waiting | - |
| progress | Major milestone (optional) | - |
| completion | Your story is done | - |

---

## Appendix: Examples

### Good Decision
```
DEC-003: API uses RESTful conventions with JSON:API response format
Rationale: Team familiarity, good tooling support
Impacts: All API endpoints, frontend API client
Status: accepted
```

### Bad Decision (Too Granular)
"Named the variable userService" - Don't post this

### Good Question
```
Q-002: Should user passwords be hashed on client or server?
Context: Building registration flow
Options: A) Client-side with Web Crypto B) Server-side only
Recommendation requested from: security_engineer
```

### Bad Question (Should Be Decision)
"What should I name the auth module?" - Just decide and post if it matters
