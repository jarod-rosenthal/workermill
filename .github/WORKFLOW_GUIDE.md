# WorkerMill CI/CD Pipeline Guide

This document describes the GitHub Actions CI/CD pipeline for WorkerMill.

## Overview

The CI/CD pipeline is defined in `.github/workflows/ci-cd.yml` and provides:

- **Continuous Integration (CI)**: Runs on all branches and pull requests
- **Continuous Deployment (CD)**: Automatically deploys to production on `main` branch pushes

## Workflow Triggers

The pipeline automatically triggers on:

- **Push to main**: Runs CI → deploys to production
- **Push to develop**: Runs CI only (no deployment)
- **Pull requests to main or develop**: Runs CI only (no deployment)

## Pipeline Structure

### CI Jobs (Run on all triggers)

These jobs run in parallel and provide fast feedback:

#### API Jobs
1. **api-lint-typecheck** (Parallel)
   - Installs dependencies
   - Runs `npm run typecheck` (TypeScript compilation check)
   - Runs `npm run lint` (ESLint)
   - Duration: ~1-2 minutes

2. **api-build** (After lint/typecheck)
   - Compiles TypeScript to JavaScript
   - Uploads `dist/` artifact for deployment
   - Duration: ~1-2 minutes

#### Frontend Jobs
1. **frontend-lint-typecheck** (Parallel)
   - Installs dependencies
   - Runs `npx tsc -b` (TypeScript compilation check)
   - Runs `npm run lint` (ESLint)
   - Duration: ~1-2 minutes

2. **frontend-build** (After lint/typecheck)
   - Runs `npm run build` (Vite build + TypeScript)
   - Uploads `dist/` artifact for deployment
   - Duration: ~1-2 minutes

### Deployment Jobs (main branch only, after CI passes)

These jobs run sequentially after all CI checks pass:

#### 1. API Deployment
- **Trigger**: CI passes on `main` branch
- **Steps**:
  1. Download compiled `api/dist` artifact
  2. Configure AWS credentials
  3. Login to Amazon ECR
  4. Build Docker image with tags: `latest` and `{commit-sha}`
  5. Push image to ECR
  6. Create new ECS task definition
  7. Update ECS service with new task definition
  8. Wait for service stability
  9. Verify health
- **Result**: API service updated on AWS ECS
- **URL**: https://api.workermill.com
- **Duration**: ~5-10 minutes (includes ECS deployment time)

#### 2. Frontend Deployment
- **Trigger**: CI passes on `main` branch
- **Steps**:
  1. Download compiled `frontend/dist` artifact
  2. Configure AWS credentials
  3. Sync static assets to S3 with proper cache headers
   - HTML files: `max-age=0, must-revalidate` (no caching)
   - Static assets: `max-age=31536000, immutable` (1 year cache)
  4. Invalidate CloudFront cache
  5. Wait for CloudFront invalidation to complete
- **Result**: Frontend updated on S3 + CloudFront CDN
- **URL**: https://workermill.com
- **Duration**: ~2-5 minutes (includes CloudFront invalidation)

#### 3. Worker Image Deployment
- **Trigger**: CI passes on `main` branch
- **Steps**:
  1. Configure AWS credentials
  2. Login to Amazon ECR
  3. Build Docker image with tags: `latest` and `{commit-sha}`
  4. Push image to ECR
  5. Update worker task definition
- **Result**: Worker image available for new tasks
- **Duration**: ~3-5 minutes

#### 4. Deployment Summary
- **Trigger**: All deployments complete
- **Result**: Summary report with URLs and commit info

## Build Artifacts & Caching

### NPM Cache
- Uses `actions/setup-node@v4` with cache
- Cache key based on `package-lock.json`
- Significantly speeds up dependency installation (saves ~1-2 minutes per job)

### Artifacts
- API and frontend builds are uploaded as artifacts
- Used by deployment jobs to avoid rebuilding on deployment
- Retained for 1 day for debugging

## AWS Configuration

### Required Secrets

Add these secrets to your GitHub repository settings (`Settings > Secrets and variables > Actions`):

```
AWS_ACCESS_KEY_ID         - AWS IAM access key
AWS_SECRET_ACCESS_KEY     - AWS IAM secret access key
```

### Required IAM Permissions

The IAM user needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": [
        "arn:aws:ecr:us-east-1:AWS_ACCOUNT_ID:repository/workermill-dev/api",
        "arn:aws:ecr:us-east-1:AWS_ACCOUNT_ID:repository/workermill-dev/worker"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:DescribeTaskDefinition",
        "ecs:DescribeTaskDefinitionWithArn",
        "ecs:UpdateService"
      ],
      "Resource": [
        "arn:aws:ecs:us-east-1:AWS_ACCOUNT_ID:service/workermill-dev/workermill-dev-api",
        "arn:aws:ecs:us-east-1:AWS_ACCOUNT_ID:task-definition/workermill-dev-api:*",
        "arn:aws:ecs:us-east-1:AWS_ACCOUNT_ID:task-definition/workermill-dev-worker:*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:PassRole"
      ],
      "Resource": [
        "arn:aws:iam::AWS_ACCOUNT_ID:role/ecsTaskExecutionRole",
        "arn:aws:iam::AWS_ACCOUNT_ID:role/ecsTaskRole"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::workermill-dev-frontend-AWS_ACCOUNT_ID/*",
        "arn:aws:s3:::workermill-dev-frontend-AWS_ACCOUNT_ID"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation"
      ],
      "Resource": "arn:aws:cloudfront::AWS_ACCOUNT_ID:distribution/CLOUDFRONT_DIST_ID"
    }
  ]
}
```

## Monitoring Deployments

### GitHub Actions Dashboard
View workflow runs and logs:
1. Go to repository → **Actions** tab
2. Click on recent workflow run
3. View detailed logs for each job

### ECS Service Status
Monitor API deployment:
```bash
aws ecs describe-services \
  --cluster workermill-dev \
  --services workermill-dev-api \
  --region us-east-1
```

### CloudFront Invalidation
Monitor frontend cache invalidation:
```bash
aws cloudfront get-invalidation \
  --distribution-id CLOUDFRONT_DIST_ID \
  --id {INVALIDATION_ID}
```

## Manual Deployment (if needed)

If you need to deploy outside of the pipeline, use the deployment script:

```bash
# Deploy everything
./deploy.sh --all

# Deploy API only
./deploy.sh --api

# Deploy frontend only
./deploy.sh --frontend

# Deploy without rebuilding
./deploy.sh --all --skip-build
```

## Troubleshooting

### CI Fails on TypeScript Errors
1. Check the GitHub Actions log for the specific error
2. Fix the issue locally:
   ```bash
   cd api && npm run typecheck
   cd frontend && npx tsc -b
   ```
3. Commit and push

### CI Fails on Linting
1. Check the GitHub Actions log for the specific error
2. Fix locally or auto-fix:
   ```bash
   cd api && npm run lint -- --fix
   cd frontend && npm run lint -- --fix
   ```
3. Commit and push

### ECS Deployment Fails
1. Check GitHub Actions logs for ECR push errors
2. Verify AWS credentials are correct in GitHub secrets
3. Check ECS service status:
   ```bash
   aws ecs describe-services \
     --cluster workermill-dev \
     --services workermill-dev-api \
     --region us-east-1 \
     --query 'services[0].{status, deployments, events}'
   ```

### Frontend Doesn't Update
1. Check if S3 sync completed in GitHub Actions log
2. Verify CloudFront invalidation completed
3. Clear browser cache and verify CDN:
   ```bash
   curl -I https://workermill.com
   ```

### Docker Build Fails
1. Check Docker build logs in GitHub Actions
2. Ensure Dockerfile exists in the respective directory
3. Test build locally:
   ```bash
   cd api && docker build -t test:latest .
   ```

## Environment Variables

### Workflow Environment Variables
Defined in `.github/workflows/ci-cd.yml`:

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

To change AWS region or resources, update these values and the corresponding AWS infrastructure.

## Best Practices

1. **Never commit secrets** to the repository
2. **Use GitHub secrets** for AWS credentials and API keys
3. **Test locally** before pushing to ensure fast CI feedback
4. **Keep branches updated** with main to avoid merge conflicts
5. **Review GitHub Actions logs** for any warnings or issues
6. **Monitor deployments** in GitHub Actions and AWS console
7. **Use semantic commit messages** for better history and debugging
8. **Create pull requests** for code review before merging to main

## Status Badge

Add this badge to your README to show pipeline status:

```markdown
[![CI/CD Pipeline](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml/badge.svg?branch=main)](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml)
```

## Future Enhancements

Potential improvements for the CI/CD pipeline:

- [ ] Add automated testing (unit tests, integration tests)
- [ ] Add security scanning (SAST, dependency scanning)
- [ ] Add performance benchmarks
- [ ] Add database migration validation
- [ ] Add infrastructure drift detection
- [ ] Add Terraform plan/apply automation
- [ ] Add integration with Slack notifications
- [ ] Add deployment approval requirements
- [ ] Add automatic rollback on failed health checks
- [ ] Add canary deployment strategy
