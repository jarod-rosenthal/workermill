# Troubleshooting

## Common Commands

```bash
# View ECS service status
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api --region us-east-1

# Tail API logs (use MSYS_NO_PATHCONV=1 in Git Bash)
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1

# Tail worker logs
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/worker" --follow --region us-east-1

# Database access via bastion (preferred)
./bin/bastion start && sleep 60 && ./bin/bastion ssh
# Then in SSH session: psql-workermill

# Alternative: Database access via ECS exec
MSYS_NO_PATHCONV=1 aws ecs list-tasks --cluster workermill-dev --region us-east-1
# Then: aws ecs execute-command --container api
```

## Common Issues

| Problem | Check |
|---------|-------|
| Task stuck "running" | `aws ecs list-tasks`, CloudWatch for exit 137 (Spot) or exit 1 |
| Worker not posting logs | Verify org `apiKey` set, check worker logs for POST errors |
| Task not claimed | `GET /api/orchestrator/status`, verify task status is `queued` |
| PR not created | Branch conflicts, token permissions, rate limits |
| Epic not progressing | Check coordination commands and worker check-ins, verify planning agent completed |
| Bastion SSH timeout | Run `./bin/bastion whitelist` to update SG with current IP |
| Bastion can't reach RDS | Check RDS SG includes bastion SG: `aws ec2 describe-security-groups --group-ids sg-0c7c9a0e3e60d8cab` |
| psql not found on bastion | User data may have failed; run `sudo dnf install -y postgresql16` |

## Windows/Git Bash

| Issue | Solution |
|-------|----------|
| AWS CLI path conversion | Prefix with `MSYS_NO_PATHCONV=1` |
| AWS CLI Unicode errors | Set `PYTHONIOENCODING=utf-8` |
| Shell parsing errors with `$(...)` | Spawn a Task agent instead of debugging |
| Docker layer caching | deploy.sh uses `--no-cache` - NEVER build with cache |
