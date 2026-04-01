# Contributing to WorkerMill

Thank you for your interest in contributing to WorkerMill.

## How to Contribute

### Reporting Bugs
Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, browser)

### Feature Requests
Open an issue describing the feature and its use case.

### Pull Requests
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run type checking (`cd api && npm run typecheck && cd ../frontend && npx tsc -b`)
5. Run tests (`cd api && npm run test`)
6. Commit with a clear message
7. Open a PR against `main`

### Development Setup
See the [Install](README.md#install) section in README.md. Run `./bin/local-workermill start` for the full local stack (API + frontend + workers).

## Code Style
- TypeScript throughout (API, frontend, agent, worker)
- ESLint for linting and formatting (`npm run lint` in api/ and frontend/)

## Architecture Overview
See [PLATFORM.md](PLATFORM.md) for the platform architecture — execution modes, spawners, worker lifecycle, and deployment.

## Code of Conduct
See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
