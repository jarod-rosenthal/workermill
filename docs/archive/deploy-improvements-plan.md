# Plan: Improve deploy.sh with Bastion-Enabled Database Operations

## Summary

Add optional database connectivity features to `deploy.sh` by leveraging the existing bastion infrastructure. These features catch migration/database issues **before** they hit production ECS, while keeping deployments fast by default.

## New Flags

| Flag | Description | Use Case |
|------|-------------|----------|
| `--db-check` | Pre-deployment database health check | Verify DB reachable before deploying |
| `--check-migrations` | Show pending migrations count | See what will run without deploying |
| `--snapshot` | Create RDS snapshot before deploy | Safety net before schema changes |
| `--wait` | Wait for ECS stability + health check | Critical deployments |
| `--no-bastion-stop` | Keep bastion running after checks | Debugging |

## Implementation

### Phase 1: Core Infrastructure (~100 lines)

Add to `deploy.sh`:

**1.1 Bastion Lambda wrapper**
```bash
invoke_bastion() {
    local action="$1"
    aws lambda invoke \
        --function-name "workermill-dev-bastion-control" \
        --payload "{\"action\":\"$action\"}" \
        --cli-binary-format raw-in-base64-out \
        --region us-east-1 \
        /tmp/bastion-response.json > /dev/null 2>&1
    cat /tmp/bastion-response.json
}
```

**1.2 Bastion start/wait function**
- Check if already running via `invoke_bastion "status"`
- If not, start and poll every 5s for up to 90s
- Parse JSON response for public IP

**1.3 SSH tunnel management**
- Start tunnel in background: `ssh -f -N -L 5432:RDS:5432 ec2-user@BASTION_IP`
- Capture PID, verify with `nc -z localhost 5432`
- Cleanup via `trap EXIT`

**1.4 Get database password**
```bash
get_db_password() {
    aws secretsmanager get-secret-value \
        --secret-id "workermill/dev/database-url" \
        --query 'SecretString' --output text \
        | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|'
}
```

### Phase 2: Feature Functions (~80 lines)

**2.1 `--db-check`: Database health check**
```bash
check_database_health() {
    PGPASSWORD="$(get_db_password)" psql -h localhost -U workermill -d workermill \
        -c "SELECT 1" > /dev/null 2>&1
}
```

**2.2 `--check-migrations`: Pending migrations count**
```bash
check_pending_migrations() {
    # Count migrations in connection.ts
    local code_count=$(grep -c "1[0-9]\{12\}" api/src/db/connection.ts)

    # Count applied in DB
    local db_count=$(PGPASSWORD="$pw" psql -h localhost -U workermill -d workermill \
        -t -c "SELECT COUNT(*) FROM migrations")

    local pending=$((code_count - db_count))
    echo "$pending pending migration(s)"
}
```

**2.3 `--snapshot`: RDS snapshot**
```bash
create_rds_snapshot() {
    local id="workermill-dev-pre-deploy-$(date +%Y%m%d-%H%M%S)"
    aws rds create-db-snapshot --db-instance-identifier workermill-dev \
        --db-snapshot-identifier "$id"
    aws rds wait db-snapshot-available --db-snapshot-identifier "$id"
}
```

**2.4 `--wait`: Post-deploy verification**
```bash
wait_for_deployment() {
    aws ecs wait services-stable --cluster workermill-dev --services workermill-dev-api
    curl -sf https://workermill.com/health/ready > /dev/null
}
```

### Phase 3: Integration (~50 lines)

**3.1 Argument parsing additions**
```bash
DB_CHECK=false
CHECK_MIGRATIONS=false
CREATE_SNAPSHOT=false
WAIT_FOR_DEPLOY=false
NO_BASTION_STOP=false

# In argument loop:
--db-check) DB_CHECK=true ;;
--check-migrations) CHECK_MIGRATIONS=true ;;
--snapshot) CREATE_SNAPSHOT=true ;;
--wait) WAIT_FOR_DEPLOY=true ;;
--no-bastion-stop) NO_BASTION_STOP=true ;;
```

**3.2 Pre-deploy hook in `deploy_api()`**
```bash
# After validate_migrations, before build:
if needs_bastion_features; then
    start_bastion_if_needed
    start_ssh_tunnel

    [[ "$DB_CHECK" == "true" ]] && check_database_health
    [[ "$CHECK_MIGRATIONS" == "true" ]] && check_pending_migrations
    [[ "$CREATE_SNAPSHOT" == "true" ]] && create_rds_snapshot

    stop_ssh_tunnel
fi
```

**3.3 Post-deploy hook**
```bash
# After ECS service update:
if [[ "$WAIT_FOR_DEPLOY" == "true" ]]; then
    wait_for_deployment
fi
```

**3.4 Cleanup trap**
```bash
cleanup() {
    [[ -n "$SSH_TUNNEL_PID" ]] && kill $SSH_TUNNEL_PID 2>/dev/null
    [[ "$BASTION_STARTED" == "true" && "$NO_BASTION_STOP" != "true" ]] && \
        invoke_bastion "stop" > /dev/null
}
trap cleanup EXIT
```

## Files to Modify

| File | Changes |
|------|---------|
| `deploy.sh` | Add ~230 lines: helper functions, new flags, integration hooks |

## Dependencies

- `jq` - JSON parsing (already used in bin/bastion)
- `psql` - PostgreSQL client for database queries
- `nc` - Tunnel verification (optional, graceful fallback)
- SSH key at `~/.ssh/workermill-bastion`

**Note:** Script will check for psql and exit with helpful message if not found.

## Timing

| Operation | Duration |
|-----------|----------|
| Bastion boot (if not running) | ~60-90s |
| SSH tunnel + DB check | ~5s |
| Check migrations | ~2s |
| RDS snapshot | ~5-10 min |
| ECS wait + health check | ~2-5 min |

**Typical `--db-check` overhead:** 60-90s if bastion cold, 5s if warm.

## Usage Examples

```bash
# Quick deploy (unchanged behavior)
./deploy.sh --api

# Pre-deploy DB validation
./deploy.sh --api --db-check

# See pending migrations without deploying
./deploy.sh --api --check-migrations

# Full safety: snapshot + check + wait
./deploy.sh --api --db-check --snapshot --wait

# Keep bastion for debugging after deploy
./deploy.sh --api --db-check --no-bastion-stop
```

## Verification

1. Test each flag individually with `--help` output
2. Test bastion start/stop via Lambda
3. Test SSH tunnel establishment and cleanup
4. Test DB health check with tunnel
5. Test pending migrations count matches reality
6. Test RDS snapshot creation (manual verification)
7. Test `--wait` with successful and failed deployments
8. Test cleanup on Ctrl+C (trap works correctly)
