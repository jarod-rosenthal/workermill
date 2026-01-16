***REMOVED*** CI/CD Quick Reference

***REMOVED******REMOVED*** Status Badges

Add to README.md:
```markdown
[![CI/CD Pipeline](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml/badge.svg?branch=main)](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml)
```

***REMOVED******REMOVED*** What Runs Where

***REMOVED******REMOVED******REMOVED*** Every Push / PR
```
api-lint-typecheck (2 min)
├── npm ci
├── npm run typecheck
└── npm run lint

api-build (2 min)
├── npm ci
└── npm run build
  └── uploads dist/ artifact

frontend-lint-typecheck (2 min)
├── npm ci
├── npx tsc -b
└── npm run lint

frontend-build (2 min)
├── npm ci
└── npm run build
  └── uploads dist/ artifact
```

***REMOVED******REMOVED******REMOVED*** Main Branch Only (After CI Passes)
```
deploy-api (5-10 min)
├── Docker build + push to ECR
├── Update ECS task definition
└── Deploy to ECS

deploy-frontend (2-5 min)
├── Sync to S3
└── Invalidate CloudFront

deploy-worker (3-5 min)
├── Docker build + push to ECR
└── Update task definition
```

***REMOVED******REMOVED*** Common Commands

***REMOVED******REMOVED******REMOVED*** Run CI Checks Locally
```bash
***REMOVED*** API
cd api
npm run typecheck
npm run lint
npm run build

***REMOVED*** Frontend
cd frontend
npx tsc -b
npm run lint
npm run build
```

***REMOVED******REMOVED******REMOVED*** Manual Deploy
```bash
./deploy.sh --all              ***REMOVED*** Everything
./deploy.sh --api              ***REMOVED*** API only
./deploy.sh --frontend         ***REMOVED*** Frontend only
./deploy.sh --all --skip-build ***REMOVED*** Without rebuilding
```

***REMOVED******REMOVED******REMOVED*** View Workflow
```bash
***REMOVED*** GitHub CLI
gh run list --workflow ci-cd.yml
gh run view <RUN_ID> --log

***REMOVED*** Or visit: https://github.com/jarod-rosenthal/workermill/actions
```

***REMOVED******REMOVED*** First-Time Setup

1. **Add AWS Secrets** (Settings → Secrets)
   ```
   AWS_ACCESS_KEY_ID
   AWS_SECRET_ACCESS_KEY
   ```

2. **Test Pipeline**
   ```bash
   git push origin your-feature-branch
   ***REMOVED*** Watch: Actions tab
   ```

3. **Deploy to Production**
   ```bash
   git push origin main
   ***REMOVED*** Watch deployment in Actions tab
   ```

***REMOVED******REMOVED*** Troubleshooting Quick Fixes

| Issue | Fix |
|-------|-----|
| Lint errors | `npm run lint -- --fix` in api/ or frontend/ |
| Type errors | `npm run typecheck` to see specific errors |
| Secrets not working | Settings → Secrets, verify secret names match workflow |
| ECS deploy fails | Check AWS credentials and IAM permissions |
| Frontend doesn't update | Wait for CloudFront invalidation to complete |

***REMOVED******REMOVED*** Environment Variables
```yaml
AWS_REGION: us-east-1
ECR_REGISTRY: AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
ECR_API_REPO: workermill-dev/api
ECR_WORKER_REPO: workermill-dev/worker
ECS_CLUSTER: workermill-dev
ECS_SERVICE: workermill-dev-api
S3_BUCKET: workermill-dev-frontend-AWS_ACCOUNT_ID
CLOUDFRONT_DISTRIBUTION: CLOUDFRONT_DIST_ID
```

***REMOVED******REMOVED*** Cache Behavior

| Component | Cache Key | Duration |
|-----------|-----------|----------|
| npm | `api/package-lock.json` | Until lock file changes |
| npm | `frontend/package-lock.json` | Until lock file changes |
| Artifacts | `api-dist`, `frontend-dist` | 1 day |

***REMOVED******REMOVED*** Deployment Timeline

| Service | Trigger | Timing |
|---------|---------|--------|
| API | CI passes on main | 5-10 min (includes ECS stability wait) |
| Frontend | CI passes on main | 2-5 min (includes CF invalidation) |
| Worker | CI passes on main | 3-5 min (builds new image) |
| All together | Parallel execution | ~10 min total |

***REMOVED******REMOVED*** Job Dependencies

```
api-lint-typecheck ──┐
                     ├──→ api-build
                     │
frontend-lint-typecheck ──┐
                          ├──→ frontend-build
                          │

api-build ──┐
            ├──→ deploy-api ──┐
frontend-build ──┐           │
                 ├──→ deploy-frontend ──→ deployment-summary
                 │
(all branches) ──┤
                 └──→ deploy-worker ──┘

(main branch only)
```

***REMOVED******REMOVED*** What Gets Deployed

***REMOVED******REMOVED******REMOVED*** API
- Docker image built from `api/Dockerfile`
- Base image: `node:20-alpine`
- Image tag: `latest` + `{commit-sha}`
- Deployed to: ECS service `workermill-dev-api`
- URL: https://api.workermill.com

***REMOVED******REMOVED******REMOVED*** Frontend
- Static files from `frontend/dist/`
- HTML files: 0 cache (must-revalidate)
- Static assets: 1-year cache (immutable)
- Deployed to: S3 + CloudFront
- URL: https://workermill.com

***REMOVED******REMOVED******REMOVED*** Worker
- Docker image built from `worker/Dockerfile`
- Base image: `node:20-bookworm`
- Image tag: `latest` + `{commit-sha}`
- Deployed to: ECR (used by ECS for worker tasks)
- Usage: New worker tasks pull this image

***REMOVED******REMOVED*** Monitoring

***REMOVED******REMOVED******REMOVED*** GitHub Actions
```
https://github.com/jarod-rosenthal/workermill/actions
```

***REMOVED******REMOVED******REMOVED*** ECS Deployment
```bash
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api --region us-east-1
```

***REMOVED******REMOVED******REMOVED*** CloudFront Invalidation
```bash
aws cloudfront get-invalidation --distribution-id CLOUDFRONT_DIST_ID --id {ID}
```

***REMOVED******REMOVED*** Rollback

***REMOVED******REMOVED******REMOVED*** API Rollback
```bash
***REMOVED*** Deploy previous tag
docker tag $REGISTRY/$REPO:previous-sha $REGISTRY/$REPO:latest
docker push $REGISTRY/$REPO:latest
./deploy.sh --api --skip-build
```

***REMOVED******REMOVED******REMOVED*** Frontend Rollback
```bash
***REMOVED*** Revert S3 files (CloudFront will serve from cache)
***REMOVED*** Or manually invalidate in CloudFront console
```

***REMOVED******REMOVED*** Performance Tips

1. **Keep package-lock.json stable** - Changes invalidate npm cache
2. **Use npm ci** (already in workflow) - Faster than npm install
3. **Cache Docker layers** - Reorder Dockerfile to put stable steps first
4. **Parallel builds** - API and Frontend build simultaneously

***REMOVED******REMOVED*** Documentation

- [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md) - Full documentation
- [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md) - Setup & secrets
- [README.md](./README.md) - Overview & architecture

***REMOVED******REMOVED*** Links

| Resource | URL |
|----------|-----|
| Workflow File | `.github/workflows/ci-cd.yml` |
| Deploy Script | `./deploy.sh` |
| Main README | `./README.md` |
| API Dockerfile | `./api/Dockerfile` |
| Frontend Docs | `./frontend/` |
