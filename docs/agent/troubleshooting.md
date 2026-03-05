# Troubleshooting

## Standalone Mode

| Problem | Check |
|---------|-------|
| Agent won't start | Check `~/.workermill/config.json` exists and has valid `mode`. Run `workermill-agent status` |
| VS Code can't connect | Check `~/.workermill/agent.port` exists. Try `workermill-agent stop && workermill-agent start` |
| "API key not found" | Verify `ANTHROPIC_API_KEY` env var, or run `claude auth login` for OAuth, or set key in config |
| Task stuck "running" | Run `workermill-agent status` to check worker PIDs. Stale worker sweep runs every 60s |
| Worker process crashes | Check `workermill-agent logs`. Common cause: missing SCM token for private repos |
| SQLite locked | Only one agent process should run at a time. Check for stale processes: `ps aux | grep workermill-agent` |
| Docker sandbox fails | Ensure Docker is running. Run `workermill-agent pull` to update the sandbox image |

## Self-Hosted / Cloud Mode

| Problem | Check |
|---------|-------|
| Worker not posting logs | Verify org `apiKey` set, check worker logs for POST errors |
| Task not claimed | `GET /api/orchestrator/status`, verify task status is `queued` |
| PR not created | Branch conflicts, token permissions, rate limits |
| Epic not progressing | Check coordination commands and worker check-ins, verify planning agent completed |

## Windows/Git Bash

| Issue | Solution |
|-------|----------|
| Path conversion errors | Prefix commands with `MSYS_NO_PATHCONV=1` |
| Unicode errors | Set `PYTHONIOENCODING=utf-8` |
