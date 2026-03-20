# Local Development

Run the full WorkerMill platform on your own machine — no cloud account required.

### What you get

- Complete stack: API server, web dashboard, PostgreSQL, Redis
- AI workers running as local Docker containers
- Hot-reload on code changes (Linux/macOS/WSL2)
- Full control over AI provider keys and configuration

### Quick start

```
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill
npm install && ./bin/local-workermill build-worker
./bin/local-workermill start
```

Your dashboard is at `http://localhost:5173`. The API runs on port `3001`.

### Connect from VS Code

Once the local stack is running:

1. Click **Connect to Local Instance** below
2. The extension discovers the local API automatically
3. You're ready to create tasks from the sidebar

### AI Provider Setup

Set your Anthropic API key in `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Or, if you're already signed into Claude CLI, that authentication is used automatically.

See the [setup guide](https://github.com/jarod-rosenthal/workermill#getting-started) for full details.
