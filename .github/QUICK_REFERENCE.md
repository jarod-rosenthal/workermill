# CI/CD Quick Reference

## Status Badges

Add to README.md:
```markdown
[![CI/CD Pipeline](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml/badge.svg?branch=main)](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml)
```

## What Runs Where

### Every Push / PR
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

### Main Branch Only (After CI Passes)
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

## Common Commands

### Run CI Checks Locally
```bash
# API
cd api
npm run typecheck
npm run lint
npm run build

# Frontend
cd frontend
npx tsc -b
npm run lint
npm run build
```

### Manual Deploy
```bash
./deploy.sh --all              # Everything
./deploy.sh --api              # API only
./deploy.sh --frontend         # Frontend only
./deploy.sh --all --skip-build # Without rebuilding
```

### View Workflow
```bash
# GitHub CLI
gh run list --workflow ci-cd.yml
gh run view <RUN_ID> --log

# Or visit: https://github.com/jarod-rosenthal/workermill/actions
```

## First-Time Setup

1. **Add AWS Secrets** (Settings → Secrets)
   ```
   AWS_ACCESS_KEY_ID
   AWS_SECRET_ACCESS_KEY
   ```

2. **Test Pipeline**
   ```bash
   git push origin your-feature-branch
   # Watch: Actions tab
   ```

3. **Deploy to Production**
   ```bash
   git push origin main
   # Watch deployment in Actions tab
   ```

## Troubleshooting Quick Fixes

| Issue | Fix |
|-------|-----|
| Lint errors | `npm run lint -- --fix` in api/ or frontend/ |
| Type errors | `npm run typecheck` to see specific errors |
| Secrets not working | Settings → Secrets, verify secret names match workflow |
| ECS deploy fails | Check AWS credentials and IAM permissions |
| Frontend doesn't update | Wait for CloudFront invalidation to complete |

## Environment Variables
```yaml
AWS_REGION: us-east-1
ECR_REGISTRY: 593971626975.dkr.ecr.us-east-1.amazonaws.com
ECR_API_REPO: workermill-dev/api
ECR_WORKER_REPO: workermill-dev/worker
ECS_CLUSTER: workermill-dev
ECS_SERVICE: workermill-dev-api
S3_BUCKET: workermill-dev-frontend-593971626975
CLOUDFRONT_DISTRIBUTION: E15CA3N5TI2ZR2
```

## Cache Behavior

| Component | Cache Key | Duration |
|-----------|-----------|----------|
| npm | `api/package-lock.json` | Until lock file changes |
| npm | `frontend/package-lock.json` | Until lock file changes |
| Artifacts | `api-dist`, `frontend-dist` | 1 day |

## Deployment Timeline

| Service | Trigger | Timing |
|---------|---------|--------|
| API | CI passes on main | 5-10 min (includes ECS stability wait) |
| Frontend | CI passes on main | 2-5 min (includes CF invalidation) |
| Worker | CI passes on main | 3-5 min (builds new image) |
| All together | Parallel execution | ~10 min total |

## Job Dependencies

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

## What Gets Deployed

### API
- Docker image built from `api/Dockerfile`
- Base image: `node:20-alpine`
- Image tag: `latest` + `{commit-sha}`
- Deployed to: ECS service `workermill-dev-api`
- URL: https://api.workermill.com

### Frontend
- Static files from `frontend/dist/`
- HTML files: 0 cache (must-revalidate)
- Static assets: 1-year cache (immutable)
- Deployed to: S3 + CloudFront
- URL: https://workermill.com

### Worker
- Docker image built from `worker/Dockerfile`
- Base image: `node:20-bookworm`
- Image tag: `latest` + `{commit-sha}`
- Deployed to: ECR (used by ECS for worker tasks)
- Usage: New worker tasks pull this image

## Monitoring

### GitHub Actions
```
https://github.com/jarod-rosenthal/workermill/actions
```

### ECS Deployment
```bash
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api --region us-east-1
```

### CloudFront Invalidation
```bash
aws cloudfront get-invalidation --distribution-id E15CA3N5TI2ZR2 --id {ID}
```

## Rollback

### API Rollback
```bash
# Deploy previous tag
docker tag $REGISTRY/$REPO:previous-sha $REGISTRY/$REPO:latest
docker push $REGISTRY/$REPO:latest
./deploy.sh --api --skip-build
```

### Frontend Rollback
```bash
# Revert S3 files (CloudFront will serve from cache)
# Or manually invalidate in CloudFront console
```

## Performance Tips

1. **Keep package-lock.json stable** - Changes invalidate npm cache
2. **Use npm ci** (already in workflow) - Faster than npm install
3. **Cache Docker layers** - Reorder Dockerfile to put stable steps first
4. **Parallel builds** - API and Frontend build simultaneously

## Documentation

- [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md) - Full documentation
- [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md) - Setup & secrets
- [README.md](./README.md) - Overview & architecture

## Links

| Resource | URL |
|----------|-----|
| Workflow File | `.github/workflows/ci-cd.yml` |
| Deploy Script | `./deploy.sh` |
| Main README | `./README.md` |
| API Dockerfile | `./api/Dockerfile` |
| Frontend Docs | `./frontend/` |
