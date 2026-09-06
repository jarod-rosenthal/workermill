# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

**Email:** security@workermill.com

Do NOT open a public GitHub issue for security vulnerabilities.

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest on main | Yes |
| Previous releases | Best effort |

## CLI Trust Boundaries

WorkerMill is a local coding CLI, not a hosted API. Treat generated commands, repository scripts, hooks, MCP servers, and language servers as executable code. A model's approval or a passing quality gate is not a security audit.

- Permission rules govern model tool calls. Explicit denies take precedence over session trust. Direct user commands and configured lifecycle hooks are separate sources of authorization; do not configure hooks you do not trust.
- Path mode checks explicit file-tool targets, but does not contain arbitrary shell commands or eliminate filesystem races. Full-disk mode removes path confinement; it does not override permission denies.
- Explicit OS mode routes supported tool commands through the OS sandbox and fails if that isolation cannot be established. It has filesystem/network exceptions and is not whole-CLI isolation. Read the [sandbox capability limits](docs/configuration.md#sandboxcapabilities) before relying on it. Native Windows shell execution requires WSL.
- Child worktrees separate changes, not operating-system privileges. OS-mode children share the Git object store through a narrow write capability. See [child isolation and recovery](docs/architecture.md#child-agents-and-recovering-their-work).
- MCP and language-server subprocesses are not placed inside the tool OS sandbox. Install only trusted servers. Cancelling a local client cannot undo an external service's completed actions.

## Credentials and Local Data

Provider keys can come from environment variables or configuration. Keys saved in `~/.workermill/cli.json` are plain JSON, **not encrypted credential storage**. Protect that directory with your operating-system account permissions and never commit it. Prefer environment variables or the supported `{env:VARIABLE_NAME}` key reference when you do not want a key stored in configuration.

Sessions, logs, checkpoints, and run records can contain private task text, source code, command output, or file copies. Review and redact diagnostic attachments before sharing them. Rotating an exposed key is necessary even if its local copy is later deleted.

For untrusted repositories or commands requiring stronger isolation, use a disposable environment with no valuable credentials or unrelated writable data. See [configuration](docs/configuration.md) for the exact supported controls; do not assume every subprocess is sandboxed.

The current regression-test map and qualification limits are in [the release-candidate qualification record](docs/recovery/r24-qualification.md); it is evidence for the documented contracts, not a blanket security certification.
