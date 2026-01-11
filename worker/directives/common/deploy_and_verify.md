# Deploy and Verify

> Deployment workflow for AI Worker tasks with the `deploy` label.

## Prerequisites

This directive only applies when:
- The ticket has the `deploy` label
- You have deployment credentials configured
- The target environment is accessible

**Without the `deploy` label:** Skip this directive entirely. Just create a PR and let humans deploy.

## Environment Configuration

Deployment targets are configured via environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `DEPLOY_ENABLED` | Whether deployment is allowed | `true` |
| `DOCKER_REGISTRY` | Container registry URL | `123456789.dkr.ecr.us-east-1.amazonaws.com/app` |
| `CONTAINER_ORCHESTRATOR` | Platform type | `ecs`, `kubernetes`, `docker-compose` |
| `CLUSTER_NAME` | Cluster/environment name | `production-cluster` |
| `SERVICE_NAME` | Service to deploy | `api-service` |
| `HEALTH_CHECK_URL` | Endpoint to verify deployment | `https://api.example.com/health` |
| `FRONTEND_BUCKET` | S3/GCS bucket for frontend | `frontend-assets-bucket` |
| `CDN_DISTRIBUTION_ID` | CloudFront/CDN distribution | `E1234567890ABC` |

## Deployment Workflow

### Step 1: Verify Deployment is Enabled

```bash
if [ "$DEPLOY_ENABLED" != "true" ]; then
  echo "Deployment not enabled for this task"
  exit 0
fi
```

### Step 2: Make Your Changes

1. Implement the required changes
2. Commit to your feature branch
3. Run local tests to verify

### Step 3: Deploy Backend (if applicable)

Use the appropriate execution script for your platform:

```bash
# Generic deployment script (auto-detects platform)
node /app/execution-compiled/deploy/run_deploy.js

# Or platform-specific:
node /app/execution-compiled/deploy/deploy_ecs.js      # AWS ECS
node /app/execution-compiled/deploy/deploy_k8s.js      # Kubernetes
node /app/execution-compiled/deploy/deploy_compose.js  # Docker Compose
```

**Manual deployment commands (if scripts unavailable):**

#### AWS ECS
```bash
# Build and push image
docker build -t $DOCKER_REGISTRY:$(git rev-parse --short HEAD) .
docker push $DOCKER_REGISTRY:$(git rev-parse --short HEAD)

# Force new deployment
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --force-new-deployment
```

#### Kubernetes
```bash
# Build and push image
docker build -t $DOCKER_REGISTRY:$(git rev-parse --short HEAD) .
docker push $DOCKER_REGISTRY:$(git rev-parse --short HEAD)

# Update deployment
kubectl set image deployment/$SERVICE_NAME \
  $SERVICE_NAME=$DOCKER_REGISTRY:$(git rev-parse --short HEAD)
```

### Step 4: Deploy Frontend (if applicable)

```bash
# Build frontend
cd frontend
npm install
npm run build

# Sync to storage bucket
aws s3 sync dist/ s3://$FRONTEND_BUCKET/ --delete

# Invalidate CDN cache
aws cloudfront create-invalidation \
  --distribution-id $CDN_DISTRIBUTION_ID \
  --paths "/*"
```

### Step 5: Verify Deployment

**Wait for deployment to stabilize:**
```bash
sleep 60  # Adjust based on your deployment time
```

**Check health endpoint:**
```bash
node /app/execution-compiled/deploy/check_health.js

# Or manually:
curl -s $HEALTH_CHECK_URL | jq .
```

**Expected response:**
```json
{
  "status": "healthy",
  "version": "abc1234",
  "timestamp": "2025-01-10T12:00:00Z"
}
```

**Verification checklist:**
- [ ] Health endpoint returns 200
- [ ] Version matches deployed commit
- [ ] No error spikes in logs
- [ ] Key functionality works

### Step 6: Handle Deployment Failures

If deployment fails:

1. **Check logs for errors:**
   ```bash
   node /app/execution-compiled/deploy/get_logs.js --tail 100
   ```

2. **Common failure patterns:**
   | Error | Likely Cause | Action |
   |-------|--------------|--------|
   | Image pull failed | Registry auth | Check credentials |
   | Health check failed | App crash | Check app logs |
   | Timeout | Slow startup | Increase health check grace period |
   | Resource exhausted | Memory/CPU limit | Scale up resources |

3. **If you can fix it:**
   - Make the fix
   - Commit
   - Re-deploy

4. **If you cannot fix it:**
   - Add detailed comment to ticket
   - Mark ticket as "Blocked"
   - Output: `::escalation::needed`
   - DO NOT leave broken deployment

### Step 7: Create Pull Request

After successful deployment:

```bash
node /app/execution-compiled/git/create_pr.js
```

**PR should note:**
- Changes deployed to [environment]
- Verified via [health check / manual test]
- Ready for code review

### Step 8: Merge (if no review required)

Check if the ticket has a `review` label:

**WITHOUT `review` label:**
```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

**WITH `review` label:**
- Leave PR open for human review
- Add comment: "Deployed and verified. Awaiting code review."

## Safety Checks

Before deploying, the system automatically checks:

```bash
node /app/execution-compiled/deploy/check_deployment_safety.js
```

**Checks performed:**
- [ ] All tests passing
- [ ] No security vulnerabilities in dependencies
- [ ] Database migrations are reversible
- [ ] No breaking API changes (unless versioned)
- [ ] Resource limits are appropriate

**If any check fails:** Deployment is blocked. Fix the issue first.

## Platform-Specific Notes

### AWS ECS

- Uses Fargate by default (serverless containers)
- Task definitions are versioned
- Rolling deployments with health checks
- Logs go to CloudWatch

### Kubernetes

- Uses rolling update strategy
- ConfigMaps/Secrets for configuration
- Horizontal Pod Autoscaler for scaling
- Logs accessible via `kubectl logs`

### Docker Compose

- For development/staging environments
- Simple restart-based deployment
- Logs via `docker-compose logs`

## Rollback Procedure

If deployment causes issues after verification:

```bash
node /app/execution-compiled/deploy/rollback.js

# Or manually:
# ECS: Update service to previous task definition
# K8s: kubectl rollout undo deployment/$SERVICE_NAME
```

**Always document rollbacks in the ticket.**

## Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
