# Offline evaluation fixtures

This directory contains small, deterministic tickets for future reliability
qualification: 20 fixtures across five bug fixes, five features, four refactors,
three maintenance tasks, and three security/validation repairs.

Current feature inventory: structured release notes, interrupted webhook-outbox
recovery, case-insensitive task-tag filtering, an injected-clock expiring cache,
and daily event summaries. The cache fixture deliberately requires a two-file
change; the webhook fixture exercises recovery after interrupted work.

Current refactor inventory: recipient-index extraction, delivery retry-policy
extraction, run-report projection extraction, and pagination cursor-codec
extraction. These tickets require observable reusable public APIs while keeping
the legacy wrapper behavior intact. The retry-policy fixture also covers
recovery after a failed delivery.

Maintenance tickets cover an asynchronous check runner, temporary-workspace
cleanup after failure, and deterministic result reports. Security tickets cover
canonical filesystem paths (including symlinks and new targets), a strict job
schema, and prototype-safe configuration merging. All use original, synthetic
examples and local temporary data; none require private repositories or live
services.

## Fixture protocol

Each task is an ESM module exporting `fixture` with:

- a stable `taskId`, category, and `initialRevision` (`sha256:` over sorted
  workspace paths and bytes);
- a model prompt plus an agent-visible workspace template;
- an explicit writable-file list, `network: false`, timeout, and declared
  toolchain requirement (Node.js 22.12+);
- a human rubric and a short acceptance description; and
- reference and intentionally incomplete solutions kept outside the generated
  model workspace.

Held-out acceptance is executable code in the fixture module and is never
written into the workspace. A future harness must enforce the writable-file
list, run with the workspace as `cwd`, apply the timeout, and clean up its
temporary directory. The included validator only checks deterministic fixture
behavior; it is not OS/process security containment. Running untrusted code
requires a real sandbox.

Acceptance tests establish only the listed observable behavior. For refactors,
they check that extracted modules expose the requested functions and preserve
the wrapper results; a human must still check actual delegation, duplication,
and maintainability against the rubric. Passing these small fixtures does not
establish production readiness or comparative model quality.

## Add or run a fixture

Keep fixtures dependency-free and use harmless temporary workspaces. Add a
module under `evals/tasks/`, follow `schema.json`, and provide baseline,
reference, and plausible-incomplete validation. Keep acceptance outside the
agent-visible files. Run an individual fixture with:

```sh
node evals/tasks/r20-bugfix-batch-config.mjs
# Other fixtures can be run the same way, for example:
node evals/tasks/r20-bugfix-pagination.mjs
```

Run `npm test -- src/__tests__/eval-fixtures.test.ts` to validate the complete
inventory and its baseline/reference/incomplete variants.

There are no model calls, network services, benchmark copies, or quality claims
in this protocol. Fixtures use only Node built-ins and require Node.js 22.12+.
`referenceFiles` and `incompleteFiles` remain inside the fixture module for
deterministic validator use, not in materialized agent workspaces. A qualifying
fixture has a baseline and plausible incomplete variant that both fail held-out
semantic checks with exit code 3, while its reference exits 0. A later comparison
harness must pin the actual Node version and execution environment when making
comparisons; these fixture checks alone are not a model-quality study.
