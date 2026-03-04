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

## Cloud Mode / Local WorkerMill

### Common Commands

```bash
# View ECS service status
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api --region us-east-1

# Tail API logs (use MSYS_NO_PATHCONV=1 in Git Bash)
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1

# Tail worker logs
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/worker" --follow --region us-east-1
```

### Common Issues

| Problem | Check |
|---------|-------|
| Task stuck "running" | `aws ecs list-tasks`, CloudWatch for exit 137 (Spot) or exit 1 |
| Worker not posting logs | Verify org `apiKey` set, check worker logs for POST errors |
| Task not claimed | `GET /api/orchestrator/status`, verify task status is `queued` |
| PR not created | Branch conflicts, token permissions, rate limits |
| Epic not progressing | Check coordination commands and worker check-ins, verify planning agent completed |

## Windows/Git Bash

| Issue | Solution |
|-------|----------|
| AWS CLI path conversion | Prefix with `MSYS_NO_PATHCONV=1` |
| AWS CLI Unicode errors | Set `PYTHONIOENCODING=utf-8` |
| Docker layer caching | deploy.sh uses `--no-cache` — NEVER build with cache |
