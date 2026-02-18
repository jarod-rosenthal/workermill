import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Update the team_collaboration.md common directive with actionable Q&A protocol.
 *
 * The original seed (1706688000014) had a stripped-down summary that said
 * "ask siblings" without explaining the Q-001 format or how text-based
 * question detection works. Workers never asked questions because they
 * didn't know the protocol.
 *
 * This migration replaces it with concrete examples that match the
 * detection patterns in executor.ts (detectAndPostQuestions, detectAndPostDecisions).
 */
export class UpdateTeamCollaborationDirective1706688000051
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Find the __common__ persona
    const commonPersona = await queryRunner.query(
      `SELECT id FROM personas WHERE slug = '__common__' AND is_system = true AND org_id IS NULL`
    );

    if (commonPersona.length === 0) {
      console.log("Common persona not found, skipping directive update");
      return;
    }

    const personaId = commonPersona[0].id;

    // Find the existing team_collaboration.md directive
    const existing = await queryRunner.query(
      `SELECT id FROM persona_directives WHERE persona_id = $1 AND filename = 'team_collaboration.md' AND is_active = true`,
      [personaId]
    );

    const content = this.directiveContent;

    if (existing.length > 0) {
      // Update existing directive
      await queryRunner.query(
        `UPDATE persona_directives
         SET content = $1, version = version + 1, change_summary = 'Updated with actionable Q&A protocol for text-based detection'
         WHERE id = $2`,
        [content, existing[0].id]
      );
      console.log("Updated team_collaboration.md directive with Q&A protocol");
    } else {
      // Insert new directive (shouldn't happen, but be safe)
      await queryRunner.query(
        `INSERT INTO persona_directives (persona_id, type, filename, content, is_active, version, change_summary)
         VALUES ($1, 'common', 'team_collaboration.md', $2, true, 1, 'Initial: actionable Q&A protocol')`,
        [personaId, content]
      );
      console.log("Inserted team_collaboration.md directive with Q&A protocol");
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to original stripped-down content (from seed migration 1706688000014)
    const commonPersona = await queryRunner.query(
      `SELECT id FROM personas WHERE slug = '__common__' AND is_system = true AND org_id IS NULL`
    );

    if (commonPersona.length === 0) return;

    const personaId = commonPersona[0].id;

    await queryRunner.query(
      `UPDATE persona_directives
       SET content = $1, version = version + 1, change_summary = 'Reverted to original summary'
       WHERE persona_id = $2 AND filename = 'team_collaboration.md' AND is_active = true`,
      [this.originalContent, personaId]
    );
  }

  private originalContent = `***REMOVED*** Team Collaboration Protocol

***REMOVED******REMOVED*** REQUIRED Actions

1. First architectural choice → post decision message
2. Before implementing security/auth/data areas → ask siblings
3. At task start → check sibling questions and answer if you can
4. If blocked waiting on another worker → post blocker

***REMOVED******REMOVED*** Decision Messages

Post decisions ONLY for:
- Interface definitions (API contracts, schemas)
- Persistence choices (database, caching)
- Security decisions (auth, encryption)
- Cross-module patterns (shared utilities)
- External dependencies (libraries, services)

**Limit: 1-3 decisions per story**

***REMOVED******REMOVED*** Questions (Async-First)

Ask early, continue working. Check for answers before committing.

***REMOVED******REMOVED*** Answering Questions

Check sibling questions at task start and answer if you have expertise.

***REMOVED******REMOVED*** Blockers

Post when genuinely stuck waiting on another worker.

***REMOVED******REMOVED*** Message Type Reference

| Type | When | ID Format |
|------|------|-----------|
| decision | Architectural choices | DEC-***REMOVED******REMOVED******REMOVED*** |
| question | Need expertise | Q-***REMOVED******REMOVED******REMOVED*** |
| answer | Responding to sibling | A-***REMOVED******REMOVED******REMOVED*** |
| blocker | Genuinely stuck | - |
| completion | Story is done | - |
`;

  private directiveContent = `***REMOVED*** Team Collaboration Protocol

***REMOVED******REMOVED*** REQUIRED Actions (Do These or Your Work May Be Rejected)

1. First architectural choice → Write \`DEC-001: <decision>\` in your output
2. Before implementing security/auth/data areas → Write \`Q-001: <question>\` in your output
3. At task start → Check sibling context and answer pending questions
4. If blocked waiting on another worker → Write a blocker message

***REMOVED******REMOVED*** How Communication Works

**Your text output is monitored for collaboration markers.** When you write specific patterns, they are automatically detected and posted to the team coordination feed where your teammates can see them.

You do NOT need to call any special API — just write the markers in your regular output.

***REMOVED******REMOVED*** Decision Messages

***REMOVED******REMOVED******REMOVED*** When to Post (High Signal Only)
Post decisions ONLY for:
- Interface definitions (API contracts, schemas)
- Persistence choices (database, caching)
- Security decisions (auth, encryption, validation)
- Cross-module patterns (shared utilities, conventions)
- External dependencies (libraries, services)

DO NOT post decisions for internal variable names, minor refactoring, or obvious choices.

***REMOVED******REMOVED******REMOVED*** Format
Write in your output:
\`\`\`
DEC-001: Using bcrypt with cost=12 for password hashing
Rationale: Industry standard, good security/performance balance
Impacts: api/src/services/auth.ts, users table
Status: accepted
\`\`\`

Use sequential IDs (DEC-001, DEC-002) within your story for traceability.

**Limit: 1-3 decisions per story.** More suggests over-sharing.

***REMOVED******REMOVED*** Questions

***REMOVED******REMOVED******REMOVED*** Pattern: Ask Early, Continue Working

Write a question in your output using the Q-***REMOVED******REMOVED******REMOVED*** format:

**General question:**
\`\`\`
Q-001: Should we use JWT or session-based auth?
Context: Building auth flow for frontend
Options: A) JWT with httpOnly cookie B) Session-based C) Token in localStorage
\`\`\`

**Targeted question (routes to a specific expert):**
\`\`\`
Q-SECURITY-001: Is this auth approach secure?
Context: Storing JWT in httpOnly cookie with SameSite=Strict
\`\`\`
Target prefixes: SECURITY, BACKEND, FRONTEND, DEVOPS, QA, DATABASE

**Blocking question (signals you cannot proceed without an answer):**
\`\`\`
Q-BLOCKING-001: Need the API endpoint spec before I can implement the frontend client
Context: Building user management page, need to know the response format
\`\`\`

***REMOVED******REMOVED******REMOVED*** After Asking: Continue Working
- Continue with non-blocked work while waiting for an answer
- Before committing code that depends on the answer, check if one arrived
- If no answer comes, post a tentative decision and move forward

***REMOVED******REMOVED******REMOVED*** Only Hard-Block For
- Auth token storage mechanism
- Encryption algorithm selection
- Data deletion/retention semantics
- Breaking changes to shared APIs

***REMOVED******REMOVED*** Answering Questions

At the start of your task, check sibling context. If you see unanswered questions matching your expertise, answer them:

\`\`\`
A-001 (re: Q-001): Use JWT with httpOnly cookies
Rationale: XSS protection, automatic inclusion in requests
Assumptions: Backend can set cookies, no cross-origin issues
\`\`\`

***REMOVED******REMOVED******REMOVED*** Answer Guidelines
- Reference the question ID: A-***REMOVED******REMOVED******REMOVED*** (re: Q-***REMOVED******REMOVED******REMOVED***)
- State your assumptions
- For security answers, mention threat model
- Be concise — your teammate needs to move fast

***REMOVED******REMOVED*** Blockers

Post when you are genuinely stuck waiting on another worker's output:

Write in your output:
\`\`\`
BLOCKER: Waiting on backend API spec for /users endpoint
Blocking: frontend user list component
Need from: backend_developer
\`\`\`

Do NOT use blocker for things you can work around or general uncertainty (use a question instead).

***REMOVED******REMOVED*** Message Type Reference

| Type | When | Format |
|------|------|--------|
| Decision | Architectural choices affecting others | DEC-***REMOVED******REMOVED******REMOVED***: description |
| Question | Need expertise outside your specialty | Q-***REMOVED******REMOVED******REMOVED***: question |
| Targeted Question | Need a specific expert | Q-SECURITY-***REMOVED******REMOVED******REMOVED***: question |
| Blocking Question | Cannot proceed without answer | Q-BLOCKING-***REMOVED******REMOVED******REMOVED***: question |
| Answer | Responding to sibling question | A-***REMOVED******REMOVED******REMOVED*** (re: Q-***REMOVED******REMOVED******REMOVED***): answer |
| Blocker | Genuinely stuck waiting | BLOCKER: description |
`;
}
