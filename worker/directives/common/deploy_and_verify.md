***REMOVED*** Deploy and Verify

> Deployment workflow for AI Worker tasks with the `deploy` label.

***REMOVED******REMOVED*** ⛔ CRITICAL: DO NOT MODIFY INFRASTRUCTURE FILES

**You must NEVER modify these files to "fix" deployment issues:**

| File | Why Not |
|------|---------|
| `Dockerfile` | Shared by all deployments - changes affect everyone |
| `Dockerfile.*` | Alternative dockerfiles - same reason |
| `.gitignore` | Changes what gets committed - affects all developers |
| `deploy.sh`, `deploy/*.sh` | Deployment scripts are tested and maintained separately |
| `docker-compose*.yml` | Infrastructure configuration |
| `.github/workflows/*` | CI/CD pipelines |
| `terraform/*`, `*.tf` | Infrastructure as code |
| `kubernetes/*`, `k8s/*` | K8s manifests |

**If deployment fails due to infrastructure issues:**

1. **DO NOT attempt to fix the infrastructure** - you don't have full context
2. **Add a detailed comment to the Jira ticket** explaining the error
3. **Create the PR anyway** with your code changes
4. **Output `::result::review_requested`** - let humans handle deployment
5. **Escalate** if the issue blocks your actual code changes

**Example of what NOT to do:**
```bash
***REMOVED*** ❌ WRONG - Don't modify Dockerfile to fix dpkg errors
Edit Dockerfile  ***REMOVED*** Adding dpkg --configure -a

***REMOVED*** ❌ WRONG - Don't modify .gitignore to commit lock files
Edit .gitignore  ***REMOVED*** Removing package-lock.json

***REMOVED*** ✅ CORRECT - Report the issue and create PR with code changes only
echo "Deployment blocked by infrastructure issue. PR created for code review."
```

---

***REMOVED******REMOVED*** Prerequisites

This directive only applies when:
- The ticket has the `deploy` label
- You have deployment credentials configured
- The target environment is accessible

**Without the `deploy` label:** Skip this directive entirely. Just create a PR and let humans deploy.

***REMOVED******REMOVED*** Environment Configuration

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

***REMOVED******REMOVED*** Deployment Workflow

***REMOVED******REMOVED******REMOVED*** Step 1: Verify Deployment is Enabled

```bash
if [ "$DEPLOY_ENABLED" != "true" ]; then
  echo "Deployment not enabled for this task"
  exit 0
fi
```

***REMOVED******REMOVED******REMOVED*** Step 2: Make Your Changes

1. Implement the required changes
2. Commit to your feature branch
3. Run local tests to verify

***REMOVED******REMOVED******REMOVED*** Step 3: Deploy Backend (if applicable)

Use the appropriate execution script for your platform:

```bash
***REMOVED*** Generic deployment script (auto-detects platform)
node /app/execution-compiled/deploy/run_deploy.js

***REMOVED*** Or platform-specific:
node /app/execution-compiled/deploy/deploy_ecs.js      ***REMOVED*** AWS ECS
node /app/execution-compiled/deploy/deploy_k8s.js      ***REMOVED*** Kubernetes
node /app/execution-compiled/deploy/deploy_compose.js  ***REMOVED*** Docker Compose
```

**Manual deployment commands (if scripts unavailable):**

**IMPORTANT:** Workers run in Fargate with NO Docker daemon. Use Kaniko for container builds.

***REMOVED******REMOVED******REMOVED******REMOVED*** AWS ECS (using Kaniko)
```bash
***REMOVED*** Get ECR credentials
aws ecr get-login-password --region us-east-1 > /kaniko/.docker/config.json.tmp
***REMOVED*** Configure ECR auth (see build_container.ts for full setup)

***REMOVED*** Build and push image with Kaniko (daemon-less)
/kaniko/executor \
  --context=/workspace/repo/backend \
  --dockerfile=/workspace/repo/backend/Dockerfile \
  --destination=$DOCKER_REGISTRY:$(git rev-parse --short HEAD) \
  --cache=true

***REMOVED*** Force new deployment
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --force-new-deployment
```

***REMOVED******REMOVED******REMOVED******REMOVED*** Kubernetes (using Kaniko)
```bash
***REMOVED*** Build and push image with Kaniko
/kaniko/executor \
  --context=/workspace/repo \
  --dockerfile=/workspace/repo/Dockerfile \
  --destination=$DOCKER_REGISTRY:$(git rev-parse --short HEAD)

***REMOVED*** Update deployment
kubectl set image deployment/$SERVICE_NAME \
  $SERVICE_NAME=$DOCKER_REGISTRY:$(git rev-parse --short HEAD)
```

**Note:** Docker commands (`docker build`, `docker push`) will NOT work in the worker container. Always use Kaniko or the execution scripts.

***REMOVED******REMOVED******REMOVED*** Step 4: Deploy Frontend (if applicable)

**CRITICAL: You MUST complete ALL THREE steps for frontend deployment:**

1. **Build the frontend:**
```bash
cd /workspace/repo/frontend
npm install
npm run build
```

2. **Sync to S3 bucket:**
```bash
aws s3 sync dist/ s3://$FRONTEND_BUCKET/ --delete
```

3. **REQUIRED - Invalidate CloudFront cache:**
```bash
aws cloudfront create-invalidation \
  --distribution-id $CDN_DISTRIBUTION_ID \
  --paths "/*" \
  --region us-east-1
```

⚠️ **WARNING: If you skip CloudFront invalidation, users will NOT see your changes!** CloudFront caches files for up to 24 hours. The invalidation typically completes in 1-2 minutes.

**Use the execution script for all three steps:**
```bash
FRONTEND_BUCKET="$FRONTEND_BUCKET" \
CDN_DISTRIBUTION_ID="$CDN_DISTRIBUTION_ID" \
node /app/execution-compiled/deploy/deploy_frontend.js
```

***REMOVED******REMOVED******REMOVED*** Step 5: Verify Deployment

**Wait for deployment to stabilize:**
```bash
sleep 60  ***REMOVED*** Adjust based on your deployment time
```

**Check health endpoint:**
```bash
node /app/execution-compiled/deploy/check_health.js

***REMOVED*** Or manually:
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

***REMOVED******REMOVED******REMOVED*** Step 6: Handle Deployment Failures

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

***REMOVED******REMOVED******REMOVED*** Step 7: Create Pull Request

After successful deployment:

```bash
node /app/execution-compiled/git/create_pr.js
```

**PR should note:**
- Changes deployed to [environment]
- Verified via [health check / manual test]
- Ready for code review

***REMOVED******REMOVED******REMOVED*** Step 8: Merge (if no review required)

Check if the ticket has a `review` label:

**WITHOUT `review` label:**
```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

**WITH `review` label:**
- Leave PR open for human review
- Add comment: "Deployed and verified. Awaiting code review."

***REMOVED******REMOVED*** Safety Checks

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

***REMOVED******REMOVED*** Platform-Specific Notes

***REMOVED******REMOVED******REMOVED*** AWS ECS

- Uses Fargate by default (serverless containers)
- Task definitions are versioned
- Rolling deployments with health checks
- Logs go to CloudWatch

***REMOVED******REMOVED******REMOVED*** Kubernetes

- Uses rolling update strategy
- ConfigMaps/Secrets for configuration
- Horizontal Pod Autoscaler for scaling
- Logs accessible via `kubectl logs`

***REMOVED******REMOVED******REMOVED*** Docker Compose

- For development/staging environments
- Simple restart-based deployment
- Logs via `docker-compose logs`

***REMOVED******REMOVED*** Rollback Procedure

If deployment causes issues after verification:

```bash
node /app/execution-compiled/deploy/rollback.js

***REMOVED*** Or manually:
***REMOVED*** ECS: Update service to previous task definition
***REMOVED*** K8s: kubectl rollout undo deployment/$SERVICE_NAME
```

**Always document rollbacks in the ticket.**

***REMOVED******REMOVED*** Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
