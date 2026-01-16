# GitHub Actions Environment Setup

This guide explains how to configure GitHub environments for the CI/CD pipeline.

## Environments

The pipeline uses two environments:

### 1. Production Environment
- **Name**: `production`
- **Purpose**: Production deployments (API, Frontend, Worker)
- **Protection Rules**: Required for sensitive deployments
- **Required Reviewers**: ✅ Recommended (optional)

### 2. No Environment (CI/Build Jobs)
- CI jobs (lint, typecheck, build) run without environment restrictions

## Setting Up GitHub Environments

### Step 1: Create Production Environment

1. Go to **Settings** → **Environments**
2. Click **New environment**
3. Name: `production`
4. Click **Configure environment**

### Step 2: Configure Deployment Protection Rules (Optional but Recommended)

1. In the production environment, scroll to **Deployment protection rules**
2. Check **Require reviewers**
3. Add reviewers who should approve deployments:
   - Jarod Rosenthal (jarod)
   - Other maintainers

**Note**: This requires manual approval before deployments to production proceed.

### Step 3: Add Secrets to Repository

Go to **Settings** → **Secrets and variables** → **Actions**

Add the following secrets:

```
AWS_ACCESS_KEY_ID
  Type: Repository secret
  Value: Your AWS IAM access key

AWS_SECRET_ACCESS_KEY
  Type: Repository secret
  Value: Your AWS IAM secret access key
```

**Security Note**: These credentials should belong to an IAM user with minimal required permissions (see IAM policy in WORKFLOW_GUIDE.md).

### Step 4: Verify Environment URLs (Optional)

In the production environment configuration, you can set:
- **Environment URL**: `https://workermill.com`

This helps track deployments by linking to the actual application.

## IAM User Setup (AWS)

Create a dedicated IAM user for CI/CD deployments:

### 1. Create IAM User
```bash
aws iam create-user --user-name workermill-ci-github
```

### 2. Create Access Keys
```bash
aws iam create-access-key --user-name workermill-ci-github
```

Save the `AccessKeyId` and `SecretAccessKey` - these become your GitHub secrets.

### 3. Attach Minimal Policy

Use the policy from WORKFLOW_GUIDE.md to grant only necessary permissions:
- ECR push/pull
- ECS service update
- S3 operations
- CloudFront invalidation
- IAM PassRole (for ECS)

### 4. Best Practices

- [ ] Never use your personal AWS credentials
- [ ] Use a dedicated `workermill-ci-github` IAM user
- [ ] Attach minimal required permissions
- [ ] Rotate access keys regularly (at least annually)
- [ ] Monitor IAM user access via CloudTrail
- [ ] Delete access keys when no longer needed

## Secrets Management

### Repository Secrets vs Environment Secrets

- **Repository Secrets**: Available to all workflows
- **Environment Secrets**: Available only to workflows using that environment

For this setup:
- Store `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as **repository secrets**
  (They're used by multiple jobs)

### Rotating Secrets

To rotate AWS credentials:

1. Create new IAM access key in AWS
2. Update GitHub secrets with new values
3. Verify deployment works
4. Delete old IAM access key in AWS

## Deployment Protection Strategies

### Option 1: Require Approval (Recommended for Production)

```yaml
# In GitHub UI: Settings → Environments → production
- Require reviewers: ✅
- Restrict who can deploy: (optional)
  - Select specific people/teams
```

When enabled, deployments wait for approval:
- Open workflow run shows "Waiting for approval"
- Reviewers receive notification
- Can review changes before deployment

### Option 2: Branch Protection

```yaml
# In GitHub UI: Settings → Branches → main
- Require pull request reviews: ✅
- Dismiss stale pull request approvals: ✅
- Require status checks to pass: ✅
  - Select: "API - Build"
  - Select: "Frontend - Build"
- Require branches to be up to date: ✅
```

This ensures code is reviewed before merging to main (which triggers deployment).

### Option 3: Scheduled Deployments

Edit `.github/workflows/ci-cd.yml` to deploy only at specific times:

```yaml
jobs:
  deploy-api:
    if: github.ref == 'refs/heads/main' && github.event_name == 'push' && (github.event.head_commit.timestamp >= '2024-01-01T09:00:00Z' && github.event.head_commit.timestamp <= '2024-01-01T17:00:00Z')
```

This restricts deployments to business hours only.

## Audit & Monitoring

### GitHub Actions Audit Log

View workflow executions in: **Settings** → **Audit log**
- Filter by `Action: workflow`
- Track who triggered deployments
- View deployment results

### AWS CloudTrail

Monitor AWS API calls from CI/CD:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=Username,AttributeValue=workermill-ci-github \
  --max-results 50
```

### Deployment Timeline

View all deployments: **Deployments** tab in repository
- Shows which commits were deployed
- Links to workflow run
- Shows rollback information

## Troubleshooting

### Secret Not Available in Workflow

1. Verify secret is added to the right scope (repository vs environment)
2. Check workflow uses `${{ secrets.SECRET_NAME }}`
3. Verify secret is accessible to job context
4. Redeploy after adding secret (cache issue)

### Deployment Approval Stuck

1. Check environment has reviewers configured
2. Verify reviewers have access to repository
3. Click "Review deployments" button to approve
4. Check audit log for approval history

### IAM Access Denied

1. Verify IAM policy is attached to the CI/CD user
2. Check resource ARNs match (region, account, service)
3. Test permissions locally with AWS CLI:
   ```bash
   aws sts assume-role --role-arn arn:aws:iam::593971626975:role/... --role-session-name test
   ```

## Security Checklist

- [ ] AWS credentials stored as GitHub secrets (not in code)
- [ ] IAM policy follows least privilege principle
- [ ] Environment protection rules configured
- [ ] Branch protection rules enabled
- [ ] Deployment approvals required for production
- [ ] Audit logging enabled (GitHub + AWS)
- [ ] Access keys rotated regularly
- [ ] Workflow logs don't expose secrets

## Related Documentation

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [Workflow Guide](./WORKFLOW_GUIDE.md)
