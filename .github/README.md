***REMOVED*** WorkerMill GitHub Configuration

This directory contains GitHub-specific configurations for the WorkerMill project.

***REMOVED******REMOVED*** Contents

***REMOVED******REMOVED******REMOVED*** Workflows (`workflows/`)
- **`ci-cd.yml`** - Main CI/CD pipeline
  - Runs type checks, linting, and builds on all branches
  - Automatically deploys to production on main branch
  - Deploys API, Frontend, and Worker images

***REMOVED******REMOVED******REMOVED*** Documentation
- **`WORKFLOW_GUIDE.md`** - Complete guide to the CI/CD pipeline
  - Overview of pipeline structure
  - Job descriptions and timings
  - AWS configuration and IAM permissions
  - Monitoring and troubleshooting

- **`ENVIRONMENT_SETUP.md`** - GitHub Actions environment configuration
  - How to set up production environment
  - Secrets management
  - Deployment protection rules
  - Security checklist

- **`README.md`** - This file

***REMOVED******REMOVED*** Quick Links

***REMOVED******REMOVED******REMOVED*** For Developers
- [Workflow Guide](./WORKFLOW_GUIDE.md) - Understand the pipeline
- [Environment Setup](./ENVIRONMENT_SETUP.md) - Configure GitHub Actions
- Main workflow: [`.github/workflows/ci-cd.yml`](./workflows/ci-cd.yml)

***REMOVED******REMOVED******REMOVED*** For DevOps/Platform Engineers
- [AWS Configuration](./ENVIRONMENT_SETUP.md***REMOVED***iam-user-setup-aws) - Set up IAM
- [IAM Permissions](./WORKFLOW_GUIDE.md***REMOVED***required-iam-permissions) - Policy setup
- [Environment Secrets](./ENVIRONMENT_SETUP.md***REMOVED***secrets-management) - Secret rotation

***REMOVED******REMOVED******REMOVED*** For Maintainers
- [Deployment Monitoring](./WORKFLOW_GUIDE.md***REMOVED***monitoring-deployments) - Track deployments
- [Protection Rules](./ENVIRONMENT_SETUP.md***REMOVED***deployment-protection-strategies) - Security
- [Audit & Monitoring](./ENVIRONMENT_SETUP.md***REMOVED***audit--monitoring) - Compliance

***REMOVED******REMOVED*** Pipeline Status

Add this badge to your main README.md:

```markdown
[![CI/CD Pipeline](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml/badge.svg?branch=main)](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml)
```

Rendered badge: [![CI/CD Pipeline](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml/badge.svg?branch=main)](https://github.com/jarod-rosenthal/workermill/actions/workflows/ci-cd.yml)

***REMOVED******REMOVED*** Key Features

***REMOVED******REMOVED******REMOVED*** Continuous Integration (CI)
- **Type Checking**: TypeScript compilation checks (no emit)
- **Linting**: ESLint validation for code quality
- **Building**: Full application builds with artifact caching
- **Parallel Jobs**: API and Frontend checks run simultaneously

***REMOVED******REMOVED******REMOVED*** Continuous Deployment (CD)
- **Automatic Deployment**: On push to main branch (after CI passes)
- **Zero-Downtime Deployment**: ECS service updates with health checks
- **CDN Invalidation**: CloudFront cache cleared on frontend changes
- **Artifact Optimization**: Smart caching of static assets

***REMOVED******REMOVED******REMOVED*** Security
- **AWS Credentials**: Stored as GitHub secrets
- **IAM Principles**: Minimal required permissions
- **Environment Protection**: Optional approval gates for production
- **Audit Logging**: Full workflow and AWS API tracking

***REMOVED******REMOVED*** Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Push to main / PR to main or develop                        │
└──────────────────────────┬──────────────────────────────────┘
                          │
                ┌─────────┴─────────┐
                │                   │
        ┌───────▼────────┐   ┌──────▼──────────┐
        │  API CI Jobs   │   │ Frontend CI Jobs│
        │  (parallel)    │   │  (parallel)     │
        │  - Lint        │   │  - Lint         │
        │  - Typecheck   │   │  - Typecheck    │
        │  - Build       │   │  - Build        │
        └───────┬────────┘   └──────┬──────────┘
                │                   │
                └─────────┬─────────┘
                          │
                   (all CI passes)
                          │
          ┌───────────────┼───────────────┐
          │               │               │
    (on main branch only)
          │               │               │
    ┌─────▼──┐      ┌─────▼──┐     ┌──────▼────┐
    │  Deploy │      │ Deploy │     │  Deploy   │
    │   API   │      │Frontend │     │  Worker   │
    │         │      │         │     │           │
    └─────┬──┘      └─────┬──┘     └──────┬─────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
                 ┌────────▼────────┐
                 │ Deployment      │
                 │ Summary Report  │
                 └─────────────────┘
```

***REMOVED******REMOVED*** Getting Started

***REMOVED******REMOVED******REMOVED*** 1. Initial Setup
```bash
***REMOVED*** Clone the repository
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill

***REMOVED*** Install dependencies (optional, CI will do this)
npm ci --prefix api
npm ci --prefix frontend
```

***REMOVED******REMOVED******REMOVED*** 2. Configure GitHub Secrets
See [Environment Setup](./ENVIRONMENT_SETUP.md***REMOVED***step-3-add-secrets-to-repository)

***REMOVED******REMOVED******REMOVED*** 3. Configure Production Environment (Optional)
See [Environment Setup](./ENVIRONMENT_SETUP.md***REMOVED***step-1-create-production-environment)

***REMOVED******REMOVED******REMOVED*** 4. Set Up Branch Protection (Recommended)
See [Environment Setup](./ENVIRONMENT_SETUP.md***REMOVED***option-2-branch-protection)

***REMOVED******REMOVED*** Common Tasks

***REMOVED******REMOVED******REMOVED*** Manually Deploy (if needed)
```bash
./deploy.sh --all              ***REMOVED*** Deploy everything
./deploy.sh --api              ***REMOVED*** Deploy API only
./deploy.sh --frontend         ***REMOVED*** Deploy frontend only
./deploy.sh --all --skip-build ***REMOVED*** Deploy without rebuilding
```

***REMOVED******REMOVED******REMOVED*** View Workflow Runs
- GitHub UI: **Actions** tab
- CLI: `gh run list --workflow ci-cd.yml`

***REMOVED******REMOVED******REMOVED*** Debug Workflow
- Check logs in GitHub Actions UI
- Look for red X next to job name
- Click job name to expand logs

***REMOVED******REMOVED******REMOVED*** Fix Linting Issues
```bash
cd api && npm run lint -- --fix
cd frontend && npm run lint -- --fix
git add -A && git commit -m "fix: auto-fix linting issues"
git push
```

***REMOVED******REMOVED*** Troubleshooting

***REMOVED******REMOVED******REMOVED*** Build Fails Locally but Passes in CI
- Ensure Node.js 20+ is installed: `node --version`
- Clear node_modules and reinstall: `rm -rf node_modules && npm ci`
- Check for environment variables: Copy `.env.example` to `.env` in api/

***REMOVED******REMOVED******REMOVED*** Deployment Doesn't Trigger
- Ensure you're pushing to `main` branch
- Check that CI jobs all passed
- Verify AWS secrets are set in GitHub
- Check GitHub Actions logs for details

***REMOVED******REMOVED******REMOVED*** See Also
- [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md***REMOVED***troubleshooting) - Detailed troubleshooting
- [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md***REMOVED***troubleshooting) - Environment issues

***REMOVED******REMOVED*** Architecture Decisions

***REMOVED******REMOVED******REMOVED*** Why Separate API and Frontend CI Jobs?
- **Parallelization**: Both can build simultaneously, saving ~1-2 minutes per run
- **Failure isolation**: Frontend issues don't block API deployments
- **Clarity**: Easy to see which component has problems

***REMOVED******REMOVED******REMOVED*** Why Upload Build Artifacts?
- **Faster deployments**: Avoid rebuilding on deployment
- **Consistency**: Ensures same code runs in CI and production
- **Reliability**: Detects build issues early, before Docker build

***REMOVED******REMOVED******REMOVED*** Why Split Lint/Build/Deploy?
- **Fail fast**: Lint errors caught before expensive Docker build
- **Caching**: Lint results don't invalidate build cache
- **Clarity**: Easy to identify which stage failed

***REMOVED******REMOVED******REMOVED*** Why Not Use Lambda for Deployments?
- **Privilege requirements**: Need ECR push, ECS update, S3 write
- **Cost**: Multiple deployments per day doesn't justify Lambda complexity
- **Simplicity**: GitHub Actions is simpler to debug and maintain

***REMOVED******REMOVED*** Next Steps

1. **Configure GitHub Secrets**: [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md***REMOVED***step-3-add-secrets-to-repository)
2. **Set Up Production Environment**: [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md***REMOVED***step-1-create-production-environment)
3. **Test Pipeline**: Push to a feature branch to trigger CI
4. **Review Deployments**: Watch your first deployment in GitHub Actions

***REMOVED******REMOVED*** Support

For questions or issues:
1. Check [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md***REMOVED***troubleshooting)
2. Review GitHub Actions logs
3. Check AWS CloudTrail for credential/permission issues
4. Review [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md***REMOVED***troubleshooting)

***REMOVED******REMOVED*** Related Files

- **Workflow definition**: `.github/workflows/ci-cd.yml`
- **Main deployment script**: `deploy.sh`
- **API Dockerfile**: `api/Dockerfile`
- **Worker Dockerfile**: `worker/Dockerfile`
- **Frontend config**: `frontend/package.json`, `frontend/vite.config.ts`
