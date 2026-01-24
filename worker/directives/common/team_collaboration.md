***REMOVED*** Team Collaboration Protocol

***REMOVED******REMOVED*** REQUIRED Actions (Do These or Your Work May Be Rejected)

1. First architectural choice → `post_context "decision" "DEC-001: ..."`
2. Before implementing security/auth/data areas → `ask_siblings` (async, continue working)
3. At task start → `check_sibling_questions` and answer if you can
4. If blocked waiting on another worker → `post_context "blocker" "..."`

---

***REMOVED******REMOVED*** Decision Messages

***REMOVED******REMOVED******REMOVED*** When to Post (High Signal Only)
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

***REMOVED******REMOVED******REMOVED*** Limit: 1-3 decisions per story
More than 3 suggests you're over-sharing. Less than 1 suggests you're under-communicating.

***REMOVED******REMOVED******REMOVED*** Format
```bash
post_context "decision" "DEC-001: Using bcrypt with cost=12 for password hashing
Rationale: Industry standard, good security/performance balance
Impacts: api/src/services/auth.ts, users table
Status: accepted"
```

Use sequential IDs (DEC-001, DEC-002) within your story for traceability.

---

***REMOVED******REMOVED*** Questions (Async-First)

***REMOVED******REMOVED******REMOVED*** Pattern: Ask Early, Continue Working

```bash
question_id=$(ask_siblings "Q-001: Is localStorage acceptable for JWT?
Context: Building auth flow for frontend
Options: A) localStorage B) httpOnly cookie C) memory only
Recommendation requested from: security_engineer")

***REMOVED*** Continue with non-security work while waiting
***REMOVED*** ... implement UI components ...

***REMOVED*** Before committing auth code, check for answer
answer=$(wait_for_answer "$question_id" 30)
```

***REMOVED******REMOVED******REMOVED*** If No Answer: Post Tentative Decision
```bash
if [ -z "$answer" ]; then
    post_context "decision" "DEC-002: [TENTATIVE - pending security review] Using httpOnly cookies
Rationale: More secure than localStorage, awaiting confirmation
Impacts: auth flow, cookie configuration
Status: proposed"
fi
```

***REMOVED******REMOVED******REMOVED*** Only Hard-Block For
- Auth token storage mechanism
- Encryption algorithm selection
- Data deletion/retention semantics
- Breaking changes to shared APIs

For these, use longer timeout (300s) and don't proceed without answer or explicit fallback.

---

***REMOVED******REMOVED*** Answering Questions

***REMOVED******REMOVED******REMOVED*** At Task Start
```bash
check_sibling_questions
```

If you see a question matching your expertise:

```bash
answer_sibling "question-uuid" "A-001 (re: Q-001): Use httpOnly cookies, not localStorage
Rationale: XSS protection, automatic inclusion in requests
Assumptions: Backend can set cookies, no cross-origin issues"
```

***REMOVED******REMOVED******REMOVED*** Answer Guidelines
- Reference the question ID (A-***REMOVED******REMOVED******REMOVED*** re: Q-***REMOVED******REMOVED******REMOVED***)
- State your assumptions
- For security answers, mention threat model
- Be concise - your teammate needs to move fast

***REMOVED******REMOVED******REMOVED*** Trust Posture
Your answers are **advisory**. The questioner should:
- Validate against their specific context
- Mark their decision as informed by your input
- Escalate if your answer contradicts requirements

---

***REMOVED******REMOVED*** Blockers

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

***REMOVED******REMOVED*** Message Type Reference

| Type | When | ID Format |
|------|------|-----------|
| decision | Architectural choices affecting others | DEC-***REMOVED******REMOVED******REMOVED*** |
| question | Need expertise outside your specialty | Q-***REMOVED******REMOVED******REMOVED*** |
| answer | Responding to sibling question | A-***REMOVED******REMOVED******REMOVED*** (re: Q-***REMOVED******REMOVED******REMOVED***) |
| blocker | Genuinely stuck waiting | - |
| progress | Major milestone (optional) | - |
| completion | Your story is done | - |

---

***REMOVED******REMOVED*** Appendix: Examples

***REMOVED******REMOVED******REMOVED*** Good Decision
```
DEC-003: API uses RESTful conventions with JSON:API response format
Rationale: Team familiarity, good tooling support
Impacts: All API endpoints, frontend API client
Status: accepted
```

***REMOVED******REMOVED******REMOVED*** Bad Decision (Too Granular)
"Named the variable userService" - Don't post this

***REMOVED******REMOVED******REMOVED*** Good Question
```
Q-002: Should user passwords be hashed on client or server?
Context: Building registration flow
Options: A) Client-side with Web Crypto B) Server-side only
Recommendation requested from: security_engineer
```

***REMOVED******REMOVED******REMOVED*** Bad Question (Should Be Decision)
"What should I name the auth module?" - Just decide and post if it matters
