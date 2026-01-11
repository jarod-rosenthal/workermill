***REMOVED*** Test Before Commit

> Always verify code quality before committing: typecheck, lint, and test.

***REMOVED******REMOVED*** Goal

Ensure all committed code passes TypeScript type checking, linting, and relevant tests. Never commit broken code.

***REMOVED******REMOVED*** Pre-flight Checks

1. Identify which projects were modified:
   - `backend/` -> backend project
   - `frontend/` -> frontend project
   - `mobile/` -> mobile project

2. Check if test files exist for modified code:
   - Look for `__tests__/*.test.ts` or `*.spec.ts` near modified files

***REMOVED******REMOVED*** Steps

***REMOVED******REMOVED******REMOVED*** Step 1: Run TypeScript Type Check

For each affected project:

```bash
cd <project> && npx tsc --noEmit
```

If typecheck fails:
1. Read the error messages carefully
2. Fix the type errors in your code
3. Re-run typecheck
4. Do NOT proceed until typecheck passes

***REMOVED******REMOVED******REMOVED*** Step 2: Run Linting

Run ESLint on changed files:

```bash
cd <project> && npm run lint
```

If lint fails:
1. Review errors (not warnings)
2. Fix issues manually or accept auto-fixes
3. Re-run lint
4. Warnings are acceptable; errors are not

***REMOVED******REMOVED******REMOVED*** Step 3: Run Related Tests

Run tests related to your changes:

```bash
cd <project> && npm test -- --testPathPattern=<pattern>
```

Test pattern examples:
- For `backend/src/routes/teams.ts` -> `--testPathPattern=teams`
- For new features -> run the whole test suite: `npm test`

***REMOVED******REMOVED******REMOVED*** Step 4: Handle Test Failures

If tests fail:

1. **Read the failure output carefully**
   - What test failed?
   - What was expected vs actual?
   - Is it a real bug or a test bug?

2. **Determine the cause:**
   - Your code has a bug -> fix the code
   - Test is outdated -> update the test
   - Test is flaky -> document and skip with reason

3. **Fix and re-run:**
   - Make the fix
   - Run the specific failing test first
   - Then run full suite again

4. **Never skip to proceed:**
   - Do NOT commit with failing tests
   - Do NOT comment out tests
   - Do NOT use `--no-verify`

***REMOVED******REMOVED*** Edge Cases

***REMOVED******REMOVED******REMOVED*** Pre-commit Hook Modifies Files

When Prettier or other formatters auto-fix files:

1. Stage the newly formatted files: `git add <modified-files>`
2. Create a NEW commit (do not amend unless it's your most recent commit)
3. Pre-commit should pass now

**Important:** Never use `--no-verify` to skip hooks.

***REMOVED******REMOVED******REMOVED*** Test Takes Too Long

If the test suite takes more than 5 minutes:

1. Run only the specific test file for your changes
2. Document which tests you ran in the PR description
3. The full suite will run in CI

***REMOVED******REMOVED******REMOVED*** No Tests Exist

If there are no tests for the code you modified:

1. Consider writing a basic test
2. At minimum, add a smoke test
3. Document in PR that test coverage should be added

***REMOVED******REMOVED******REMOVED*** Flaky Tests

If a test passes sometimes and fails others:

1. Run it 3 times to confirm flakiness
2. Add `// TODO: Flaky test - see PROJ-XXX` comment
3. Create a ticket for fixing the flaky test
4. Skip with `.skip` and a reason
5. Document in PR

***REMOVED******REMOVED*** Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
