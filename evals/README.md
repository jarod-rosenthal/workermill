# Offline evaluation fixtures

This directory contains small, deterministic tickets for future reliability
qualification. R20 currently contains five bug-fix fixtures and five feature
fixtures. The remaining planned inventory is four refactors, three maintenance
tasks, and three security/validation repairs.

Current feature inventory: structured release notes, interrupted webhook-outbox
recovery, case-insensitive task-tag filtering, an injected-clock expiring cache,
and daily event summaries. The cache fixture deliberately requires a two-file
change; the webhook fixture exercises recovery after interrupted work.

## Fixture protocol

Each task is an ESM module exporting `fixture` with:

- a stable `taskId`, category, and `initialRevision` (`sha256:` over sorted
  workspace paths and bytes);
- a model prompt plus an agent-visible workspace template;
- an explicit writable-file list, `network: false`, timeout, and pinned
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

There are no model calls, network services, benchmark copies, or quality claims
in this protocol. Fixtures use only Node built-ins and pin Node.js 22.12+.
`referenceFiles` and `incompleteFiles` remain inside the fixture module for
deterministic validator use, not in materialized agent workspaces. A qualifying
fixture has a baseline and plausible incomplete variant that both fail held-out
semantic checks with exit code 3, while its reference exits 0. A later comparison
harness may consume these fixtures after the set is complete.
