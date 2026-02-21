# VS Code Extension: Welcome View Not Showing on Fresh Install

## THE PROBLEM

The VS Code extension (`packages/vscode-workermill/`) shows "Waiting for workermill-agent..." on a **completely fresh machine** where the agent has NEVER been set up. It should show the onboarding welcome view with "Create Account" / "Sign In" / "I have an API key" buttons.

**This is being tested on a SEPARATE machine from the dev machine. There is no `~/.workermill/config.json` on the test machine. This is a genuine fresh install scenario.**

## WHAT SHOULD HAPPEN

1. User installs the `.vsix` on a fresh machine
2. Opens VS Code, clicks the WorkerMill icon in the activity bar
3. Sees welcome view: "Create Account" / "I have an API key" / "Sign in"
4. Clicks one of those to onboard

## WHAT ACTUALLY HAPPENS

1. User installs the `.vsix` on a fresh machine
2. Opens VS Code, clicks the WorkerMill icon
3. Sees: "Agent not connected — Waiting for workermill-agent..."
4. Dead end — no way to set up

## KEY FILES

- `packages/vscode-workermill/package.json` — `viewsWelcome` contributions and `when` clauses
- `packages/vscode-workermill/src/extension.ts` — activation, context key setup
- `packages/vscode-workermill/src/team-tree.ts` — TreeDataProvider (returns items or empty array)
- `packages/vscode-workermill/src/agent-installer.ts` — `isAgentConfigured()` check
- `packages/vscode-workermill/src/agent-client.ts` — connection/reconnection logic

## HOW THE WELCOME VIEW WORKS

VS Code `viewsWelcome` shows when BOTH:
1. The TreeDataProvider returns NO items (empty array)
2. The `when` clause evaluates to true

Current `viewsWelcome` in package.json:
```json
{
  "when": "!workermill.agentConfigured"
}
```

Current tree logic in `team-tree.ts`:
```typescript
if (!this.connected) {
  return []; // empty → viewsWelcome should show
}
```

Context set in `extension.ts`:
```typescript
const configured = isAgentConfigured(); // checks ~/.workermill/config.json exists
vscode.commands.executeCommand("setContext", "workermill.agentConfigured", configured);
vscode.commands.executeCommand("setContext", "workermill.agentConnected", false);
```

## WHAT'S BEEN TRIED (AND FAILED)

1. **First attempt**: Tree returned InfoTreeItem("Waiting...") when configured-but-not-connected. Changed to return `[]` instead. DIDN'T FIX IT.

2. **Second attempt**: Added a second viewsWelcome for "configured but not connected" state with `when: "workermill.agentConfigured && !workermill.agentConnected"`. Added `workermill.agentConnected` context key. DIDN'T FIX IT.

## POSSIBLE ROOT CAUSES TO INVESTIGATE

1. **`setContext` is async** — the context keys might not be set before the tree first renders. VS Code's `executeCommand("setContext", ...)` returns a Thenable. If the tree renders before the context is set, the `when` clause might not evaluate correctly.

2. **VS Code `when` clause evaluation of undefined keys** — if `workermill.agentConfigured` hasn't been set yet, VS Code might not evaluate `!workermill.agentConfigured` as `true`. Test what happens with undefined context keys.

3. **Tree rendering timing** — the tree might render before contexts are set. The `client.connect()` call at line 798 immediately fires `disconnected` (since no port file exists), which triggers a tree refresh via `_onDidChangeTreeData.fire()`. This refresh might happen before `setContext` completes.

4. **viewsWelcome might need the tree to NEVER have returned items** — if the tree returns items first (even briefly), VS Code might cache that state and not re-check viewsWelcome.

5. **The `when` clause might have a syntax issue** — test with simpler conditions or hardcode the context.

## SUGGESTED FIX APPROACH

Instead of relying solely on `viewsWelcome` (which depends on VS Code's timing of context evaluation), consider a **hybrid approach**:

- When not connected, return tree items that ARE the onboarding buttons (as clickable tree items with commands), not an empty array hoping viewsWelcome will appear.
- This is more reliable because it doesn't depend on `when` clause timing.

Example:
```typescript
if (!this.connected) {
  if (!this.agentConfigured) {
    return [
      new ActionTreeItem("Create Account", "Sign up with GitHub", "$(add)", "workermill.signUpWithGitHub"),
      new ActionTreeItem("I have an API key", "Manual setup", "$(key)", "workermill.manualSetup"),
      new ActionTreeItem("Sign In", "Existing account", "$(sign-in)", "workermill.signInWithGitHub"),
    ];
  }
  return [
    new ActionTreeItem("Start Agent", "Launch workermill-agent", "$(play)", "workermill.startAgent"),
    new ActionTreeItem("Install Agent", "Download latest binary", "$(cloud-download)", "workermill.installAgent"),
  ];
}
```

This way the sidebar ALWAYS shows actionable items regardless of viewsWelcome timing issues.

## BUILD & TEST

```bash
cd packages/vscode-workermill
npm run build      # esbuild → dist/extension.js
npm run typecheck   # tsc --noEmit
npm run package     # → workermill-0.1.3.vsix (BUMP VERSION if needed)
```

Install on the test machine: `code --install-extension workermill-0.1.3.vsix`

## IMPORTANT NOTES

- The user is testing on a DIFFERENT machine — do NOT assume config.json exists
- The `.vsix` must be rebuilt and transferred to the test machine after every change
- ALWAYS bump the version in package.json before packaging to avoid VS Code caching issues
- The extension version is embedded at compile time via esbuild `define` — not applicable here but keep in mind
- After fixing, the user will want to test the full flow: welcome view → click Create Account → GitHub OAuth → config written → agent installed → agent starts → tree shows tasks
