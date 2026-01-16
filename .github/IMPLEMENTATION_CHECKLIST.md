***REMOVED*** CI/CD Pipeline Implementation Checklist

This checklist guides you through setting up the GitHub Actions CI/CD pipeline for WorkerMill.

***REMOVED******REMOVED*** Pre-Deployment Setup

***REMOVED******REMOVED******REMOVED*** 1. Verify Workflow File
- [x] Workflow file created: `.github/workflows/ci-cd.yml`
- [x] YAML syntax validated
- [x] All jobs properly structured
- [ ] Commit and push workflow file:
  ```bash
  git add .github/workflows/ci-cd.yml
  git commit -m "ci: Add GitHub Actions CI/CD pipeline"
  git push origin main
  ```

***REMOVED******REMOVED******REMOVED*** 2. Configure GitHub Secrets

**Location**: Settings → Secrets and variables → Actions

***REMOVED******REMOVED******REMOVED******REMOVED*** Required Secrets
- [ ] `AWS_ACCESS_KEY_ID`
  - [ ] Value obtained from AWS IAM
  - [ ] Belongs to `workermill-ci-github` user (recommended)
  - [ ] Added to GitHub

- [ ] `AWS_SECRET_ACCESS_KEY`
  - [ ] Value obtained from AWS IAM
  - [ ] Matches the access key ID above
  - [ ] Added to GitHub

***REMOVED******REMOVED******REMOVED******REMOVED*** Verification
```bash
***REMOVED*** Test secrets are accessible (optional, in workflow logs)
***REMOVED*** GitHub will show if secrets are masked in logs (*****)
```

***REMOVED******REMOVED******REMOVED*** 3. Set Up GitHub Environments (Optional but Recommended)

**Location**: Settings → Environments

***REMOVED******REMOVED******REMOVED******REMOVED*** Create Production Environment
- [ ] Environment name: `production`
- [ ] Set environment URL: `https://workermill.com`
- [ ] Configure deployment protection (optional):
  - [ ] Enable "Require reviewers"
  - [ ] Add reviewers (e.g., Jarod Rosenthal)

***REMOVED******REMOVED******REMOVED******REMOVED*** Result
- Deployments to production will be tracked
- (Optional) Require approval before deployments

***REMOVED******REMOVED******REMOVED*** 4. Set Up Branch Protection (Recommended)

**Location**: Settings → Branches → main

- [ ] Require pull request reviews before merging
- [ ] Require status checks to pass:
  - [ ] `api-lint-typecheck`
  - [ ] `api-build`
  - [ ] `frontend-lint-typecheck`
  - [ ] `frontend-build`
- [ ] Require branches to be up to date before merging
- [ ] Dismiss stale pull request approvals

***REMOVED******REMOVED******REMOVED******REMOVED*** Result
- Cannot merge to main without passing CI
- Deployments only happen on validated code

***REMOVED******REMOVED*** AWS Configuration

***REMOVED******REMOVED******REMOVED*** 5. Create IAM User for CI/CD

**AWS Console Steps**:
1. [ ] Go to IAM → Users → Create user
   - [ ] Username: `workermill-ci-github`
   - [ ] No AWS Management Console access needed
   - [ ] Proceed to next step
2. [ ] Set permissions:
   - [ ] Create custom inline policy (see below)
   - [ ] Copy policy from [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md***REMOVED***required-iam-permissions)
   - [ ] Paste and create policy
3. [ ] Create access key:
   - [ ] Select "Third-party service"
   - [ ] Accept terms
   - [ ] Download or copy:
     - [ ] Access Key ID
     - [ ] Secret Access Key

***REMOVED******REMOVED******REMOVED******REMOVED*** IAM Policy Required
Copy policy from [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md***REMOVED***required-iam-permissions) or:

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

***REMOVED******REMOVED******REMOVED*** 6. Verify AWS Credentials (Optional)

Test credentials locally before adding to GitHub:

```bash
***REMOVED*** Set temporary credentials
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"
export AWS_REGION="us-east-1"

***REMOVED*** Test ECR login
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

***REMOVED*** Expected output: Login Succeeded

***REMOVED*** Test ECS permissions
aws ecs describe-services \
  --cluster workermill-dev \
  --services workermill-dev-api \
  --region us-east-1

***REMOVED*** Should return service details without errors
```

***REMOVED******REMOVED*** Testing the Pipeline

***REMOVED******REMOVED******REMOVED*** 7. First Test Run

***REMOVED******REMOVED******REMOVED******REMOVED*** Option A: Test CI on Feature Branch
```bash
***REMOVED*** Create and push a feature branch
git checkout -b test/ci-pipeline
git push -u origin test/ci-pipeline

***REMOVED*** Go to: https://github.com/jarod-rosenthal/workermill/actions
***REMOVED*** Wait for workflow to run
***REMOVED*** Should show: ✅ CI checks passed
```

***REMOVED******REMOVED******REMOVED******REMOVED*** Option B: Test Full Deployment on Main
```bash
***REMOVED*** Ensure main branch has your code with the workflow
git checkout main
git pull origin main

***REMOVED*** Make a small change (e.g., update README)
***REMOVED*** Push to main (assuming branch protection allows direct push)
git push origin main

***REMOVED*** Go to: https://github.com/jarod-rosenthal/workermill/actions
***REMOVED*** Watch deployment progress:
***REMOVED***   1. CI checks run (2-3 min)
***REMOVED***   2. Deployments start (if CI passes)
***REMOVED***   3. API deployment (5-10 min)
***REMOVED***   4. Frontend deployment (2-5 min)
***REMOVED***   5. Worker deployment (3-5 min)
```

***REMOVED******REMOVED******REMOVED*** 8. Verify Deployments

After first run, verify everything deployed:

```bash
***REMOVED*** Check API is running
curl https://api.workermill.com/health

***REMOVED*** Check Frontend is accessible
curl https://workermill.com

***REMOVED*** Check ECS service
aws ecs describe-services \
  --cluster workermill-dev \
  --services workermill-dev-api \
  --region us-east-1 \
  --query 'services[0].{status:status, runningCount:runningCount, deployments:deployments[0]}'

***REMOVED*** Check ECR has new images
aws ecr list-images \
  --repository-name workermill-dev/api \
  --region us-east-1 \
  --query 'imageIds[0:5]'
```

***REMOVED******REMOVED*** Post-Deployment Configuration

***REMOVED******REMOVED******REMOVED*** 9. Update README with Badge

In your main `README.md`:

```markdown
***REMOVED*** WorkerMill

[![CI/CD Pipeline](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml/badge.svg?branch=main)](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml)

[rest of README...]
```

***REMOVED******REMOVED******REMOVED*** 10. Document in Project

- [ ] Add link to CI/CD docs in main README
- [ ] Reference workflow guide in contribution guidelines
- [ ] Document deployment process for team

***REMOVED******REMOVED******REMOVED*** 11. Set Up Monitoring (Optional)

- [ ] Enable GitHub Actions usage alerts
- [ ] Set up Slack notifications (optional)
  - [ ] Workflow: GitHub Actions → Slack integration
  - [ ] Alert on failure only
- [ ] Monitor AWS costs
  - [ ] Set CloudWatch alarms for EC2/ECR costs

***REMOVED******REMOVED******REMOVED*** 12. Team Communication

- [ ] Inform team about new CI/CD pipeline
- [ ] Share this checklist with maintainers
- [ ] Document deployment procedure
- [ ] Update on-call runbook if applicable

***REMOVED******REMOVED*** Ongoing Maintenance

***REMOVED******REMOVED******REMOVED*** 13. Regular Tasks

- [ ] **Weekly**: Review GitHub Actions usage
  - Check for failed runs
  - Monitor build times
  - Review logs for warnings

- [ ] **Monthly**: Rotate IAM credentials
  - Create new access key in AWS
  - Update GitHub secrets
  - Delete old access key

- [ ] **Quarterly**: Review IAM permissions
  - Ensure policy is still minimal
  - Remove unused permissions
  - Add new permissions if needed

***REMOVED******REMOVED******REMOVED*** 14. Troubleshooting Logs

Keep this reference for debugging:

- [ ] API TypeScript errors: `npm run typecheck` in api/
- [ ] Frontend TypeScript errors: `npx tsc -b` in frontend/
- [ ] Linting failures: `npm run lint` in respective directory
- [ ] Docker build issues: Run locally with `docker build`
- [ ] ECS deployment issues: Check AWS CloudTrail and ECS logs
- [ ] S3/CloudFront issues: Check S3 bucket policy and CloudFront distribution

***REMOVED******REMOVED*** Success Criteria

The pipeline is successfully configured when:

- [x] Workflow file created and valid YAML
- [ ] GitHub secrets configured
- [ ] GitHub environments configured (optional)
- [ ] Branch protection rules in place (optional)
- [ ] IAM user created with minimal permissions
- [ ] First CI run passes on a feature branch
- [ ] First deployment succeeds on main branch
- [ ] API, Frontend, and Worker all deployed
- [ ] Health checks pass post-deployment
- [ ] Team members notified
- [ ] Documentation updated
- [ ] Monitoring in place

***REMOVED******REMOVED*** Quick Links

- **Workflow file**: `.github/workflows/ci-cd.yml`
- **Full guide**: `.github/WORKFLOW_GUIDE.md`
- **Environment setup**: `.github/ENVIRONMENT_SETUP.md`
- **Quick reference**: `.github/QUICK_REFERENCE.md`
- **GitHub Actions**: https://github.com/jarod-rosenthal/workermill/actions
- **GitHub Settings**: https://github.com/jarod-rosenthal/workermill/settings

***REMOVED******REMOVED*** Common Issues During Setup

| Issue | Solution |
|-------|----------|
| Secret not found in workflow | Check secret name matches exactly, including case |
| IAM permission denied | Verify IAM user policy includes all required actions |
| Docker push fails | Verify ECR repositories exist in AWS account |
| ECS deployment fails | Check task definition exists and IAM PassRole is working |
| CloudFront invalidation hangs | CloudFront invalidations can take 5-15 minutes |

***REMOVED******REMOVED*** Getting Help

1. Check [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md***REMOVED***troubleshooting)
2. Review GitHub Actions logs
3. Check AWS CloudTrail for permission issues
4. Review [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md***REMOVED***troubleshooting)
5. Test locally before investigating CI/CD
