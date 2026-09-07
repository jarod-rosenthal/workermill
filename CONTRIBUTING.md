# Contributing to WorkerMill

Thank you for your interest in contributing to WorkerMill. It's Apache 2.0 licensed.

**For development setup, source layout, and step-by-step guides on adding commands, tools, personas, and settings, see [docs/contributing.md](docs/contributing.md).** This file covers the process; that one covers the code.

## How to Contribute

### Reporting Bugs

Open an issue with:

- Output of `wm doctor`
- OS, Node version, and CLI version (`wm --version`)
- Steps to reproduce, and expected vs actual behavior
- Relevant excerpt from `~/.workermill/logs/`

### Feature Requests

Open an issue describing the feature and its use case. For significant changes, start a [Discussion](https://github.com/jarod-rosenthal/workermill/discussions) first so we can align on approach before you write code.

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Type check: `npm run typecheck`
5. Run tests: `npm test`
6. Update the docs your change affects — several are enforced by `src/__tests__/docs-consistency.test.ts`
7. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (`fix:`, `feat:`, `docs:`, `chore:`, `test:`, `refactor:`)
8. Open a PR against `main` with a clear summary and a test plan

CI runs typecheck, lint, build, and the unit test suite. Fix any failures before requesting review.

## Development Setup

**Prerequisites:** Node.js 22.12+, Git, and an LLM provider — Ollama for a fully local setup, or an API key for a cloud provider.

```bash
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill
npm install
npm run dev        # Run from source, no build step
```

## Code Style

- TypeScript strict mode throughout. No `any` unless you're working around an SDK type gap — comment why.
- ESM only. Import paths need `.js` extensions (`import { x } from "./y.js"`), even for `.ts` files.
- There is **no ESLint config** in this repo — `npm run lint` is an alias for `npm run typecheck`.
- Prefer small, focused functions. Match the patterns already in the file you're editing.

## Architecture Overview

See [docs/architecture.md](docs/architecture.md) for execution modes, the tool system, MCP, permission layers, compaction, and safety.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
