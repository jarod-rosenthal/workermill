# Offline evaluation fixtures

This directory contains small, deterministic tickets for future reliability
qualification. R20 currently contains five bug-fix fixtures (one from R20a and
four from R20b). The remaining planned inventory is five features, four
refactors, three maintenance tasks, and three security/validation repairs.

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
in this protocol. A later comparison harness may consume these fixtures after
the set is complete.
