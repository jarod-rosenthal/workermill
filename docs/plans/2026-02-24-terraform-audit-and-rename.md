# Terraform State Audit & Production Rename Plan

**Date:** 2026-02-24
**Status:** Draft — awaiting review and approval
**Author:** Claude Opus 4.6 + Jarod

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Assessment](#2-current-state-assessment)
3. [Lifecycle Bandaids (ignore_changes Audit)](#3-lifecycle-bandaids)
4. [The Naming Problem](#4-the-naming-problem)
5. [Full Blast Radius of Renaming](#5-full-blast-radius)
6. [Resource Rename Behavior Reference](#6-resource-rename-behavior)
7. [Rename Strategy](#7-rename-strategy)
8. [Phased Execution Plan](#8-phased-execution-plan)
9. [Files to Modify](#9-files-to-modify)
10. [Dev Environment Cleanup](#10-dev-environment-cleanup)
11. [Rollback Plan](#11-rollback-plan)

---

## 1. Executive Summary

WorkerMill's Terraform infrastructure is **structurally sound** — the module architecture, state backend, and deploy.sh separation are well-designed. However, two categories of problems have accumulated:

**Problem A: Lifecycle bandaids.** Three Lambda functions have `ignore_changes` blocks that make them unmanageable by Terraform. Code changes to these Lambdas cannot be deployed via `terraform apply`.

**Problem B: Production is named "dev".** The production environment uses `environment = "dev"`, so every AWS resource is named `workermill-dev-*`. This is confusing, error-prone, and creates a naming collision if a real dev environment is ever stood up with proper naming. The current dev environment (`environments/dev/`) works around this by using `environment = "sandbox"`.

This document provides a complete audit of the current state, the blast radius of renaming, and a phased execution plan to fix both problems with minimal downtime.

---

## 2. Current State Assessment

### What's Working Well

- **Module decomposition**: 22 modules, clean separation of concerns
- **State backend**: S3 + DynamoDB locking, versioning enabled, `prevent_destroy` on state bucket
- **deploy.sh / Terraform split**: deploy.sh owns image updates (registering new ECS task definition revisions), Terraform owns infrastructure structure. No Terraform commands in deploy.sh.
- **No `-target` applies found** in any scripts (only an example in an incident response playbook)
- **No `terraform state rm` / `terraform import` / `terraform taint`** found in codebase
- **ECS `desired_count` ignored correctly** — auto-scaler manages this
- **Secret placeholder values ignored correctly** — manually updated via AWS Console

### What's Broken

| Issue | Severity | Details |
|-------|----------|---------|
| Cognito presignup Lambda fully ignored by TF | **High** | `ignore_changes = [environment, source_code_hash, layers]` — TF cannot update this Lambda at all |
| Lambda code changes won't deploy | **High** | `source_code_hash` ignored on 3 Lambdas due to cross-platform `archive_file` zip hash inconsistency |
| Uncommitted Lambda code change | **Medium** | `index.py` has `autoConfirmUser`/`autoVerifyEmail` additions that can't deploy even if committed |
| Production named "dev" | **Medium** | Every AWS resource is `workermill-dev-*` — confusing and collision-prone |
| Cognito Lambda DB password mismatch | **Medium** | Lambda env vars have stale DB password; `ignore_changes = [environment]` hides the drift |
| Dev environment incomplete vs prod | **Low** | Missing 6 modules (redis, bastion, cognito-presignup, ses-inbound, cloudflare-tunnel, github-runner-ecs) |
| Dev lock file uncommitted | **Low** | `.terraform.lock.hcl` has uncommitted `archive` provider addition |
| Google OAuth secret path inconsistency | **Low** | Uses `workermill/prod/google-oauth` while all others use `workermill/dev/*` |

### Known & Accepted Drift (Not Problems)

| Pattern | Resources | Why It's Fine |
|---------|-----------|---------------|
| `ignore_changes = [desired_count]` | API + Orchestrator ECS services | Auto-scaler manages count |
| `ignore_changes = [secret_string]` | 5 Secrets Manager versions | Placeholder values, manually updated |
| ECS task definition revision cycling | API + Worker + Orchestrator task defs | deploy.sh registers new revisions with pinned image digests; Terraform uses `:latest` |
| `create_before_destroy` on ACM cert | DNS module certificate | Zero-downtime cert rotation |
| `create_before_destroy` on bastion launch templates + ASG | Bastion module | Zero-downtime instance updates |

---

## 3. Lifecycle Bandaids

### 3.1 Cognito Pre-Signup Lambda — CRITICAL

**File:** `modules/cognito-presignup/main.tf:230-232`

```hcl
lifecycle {
  ignore_changes = [environment, source_code_hash, layers]
}
```

**What this means:** Terraform will **never** update this Lambda's:
- Environment variables (DB credentials are stale — password was manually corrected in AWS)
- Source code (the `index.py` file has uncommitted changes that can't deploy)
- Layer attachments (pg8000 driver version is frozen)

**Root cause:** The RDS password was changed outside Terraform. Rather than fixing the source, `ignore_changes = [environment]` was added. Then `source_code_hash` and `layers` were added to suppress archive_file hash drift.

**Fix required:**
1. Read DB password from Secrets Manager at Lambda runtime instead of env vars, OR
2. Ensure Terraform's `db_password` variable matches the actual RDS password
3. Fix `archive_file` hash determinism (see 3.3)
4. Remove `ignore_changes` entirely

### 3.2 Lambda Layer `pg8000` — Moderate

**File:** `modules/cognito-presignup/main.tf:180-182`

```hcl
lifecycle {
  ignore_changes = [source_code_hash]
}
```

Same `archive_file` cross-platform zip hash problem. Layer version updates are silently ignored.

### 3.3 SES Email Processor Lambda — Moderate

**File:** `modules/ses-inbound/main.tf:396-399`

```hcl
lifecycle {
  ignore_changes = [source_code_hash]
}
```

Same root cause. Email processing code changes won't deploy.

### 3.4 The `archive_file` Root Cause

The `archive_file` data source produces different zip hashes on different machines (macOS vs Linux, different zip implementations, timestamp metadata). This is a known Terraform issue.

**Proper fixes (pick one):**
- Build Lambda zips in CI only (not developer machines)
- Use `source_code_hash = filebase64sha256("${path.module}/lambda/index.py")` instead of `data.archive_file.*.output_base64sha256`
- Use S3-based Lambda deployment (`s3_bucket` + `s3_key`) instead of inline `filename`

### 3.5 GitHub Runner Launch Template — Low

**File:** `modules/github-runner/main.tf:199-203`

```hcl
lifecycle {
  ignore_changes = [ami]
}
```

AMI is "managed separately" but there's no documented process. Low risk since the EC2 runner module may not even be active in prod (ECS runners are used instead).

---

## 4. The Naming Problem

### Current State

| Directory | `environment` var | AWS Resource Prefix | Domain | Actual Purpose |
|-----------|-------------------|---------------------|--------|----------------|
| `environments/prod/` | `"dev"` | `workermill-dev-*` | workermill.com | **PRODUCTION** |
| `environments/dev/` | `"sandbox"` | `workermill-sandbox-*` | dev.workermill.com | Development (not running) |

### Why This Is Bad

1. **Confusing:** Looking at AWS Console, everything says "dev" but it's production
2. **Collision-prone:** If someone creates a real `workermill-dev-*` environment, it collides
3. **Error-prone:** Hardcoded `workermill-dev` references scattered across deploy.sh, API config, frontend settings, worker directives
4. **Inconsistent:** Google OAuth secret already uses `workermill/prod/` while 17 other secrets use `workermill/dev/`
5. **Misleading:** New team members, auditors, and incident responders see "dev" and assume it's safe to modify

### Where "dev" / "workermill-dev" Appears

**Terraform (via `var.environment`):**
- 22 modules × multiple resources each = ~80+ AWS resources named `workermill-dev-*`

**Hardcoded in `environments/prod/main.tf`** (not using `var.environment`):
- `workermill/dev/platform-api-key`
- `workermill/dev/microsoft-client-id`
- `workermill/dev/microsoft-client-secret`
- `workermill/dev/github-client-id`
- `workermill/dev/github-client-secret`
- `workermill/dev/admin-phone-number`
- `workermill/dev/admin-email`
- `workermill/dev/cloudflare-tunnel-token` (conditional)

**Hardcoded in `deploy.sh` (lines 23-28):**
- `prod_ecr_api_repo="workermill-dev/api"`
- `prod_ecr_worker_repo="workermill-dev/worker"`
- `prod_ecs_cluster="workermill-dev"`
- `prod_ecs_service="workermill-dev-api"`
- `prod_s3_bucket="workermill-dev-frontend-AWS_ACCOUNT_ID"`
- Line 228: `workermill-dev-bastion-control`
- Line 244: `workermill-dev-bastion`
- Lines 323, 370: `workermill/dev/database-url`

**Hardcoded in API code (`api/src/config/index.ts`):**
- Line 86: `environment: "dev"` (fallback)
- Line 107: `ecsCluster: "workermill-dev"` (fallback)
- Line 108: `workerTaskDefinition: "workermill-dev-worker"` (fallback)
- Line 111: `workerLogGroup: "/ecs/workermill-dev/worker"` (fallback)
- Line 114: `runnerTaskDefinition: "workermill-dev-github-runner"` (fallback)

**Hardcoded in other files:**
- `api/src/routes/remote-agent.ts:1010`: `workermill-dev/worker:latest` (ECR image URL)
- `frontend/src/pages/settings/index.tsx:4091`: `workermill-dev-worker-task` (IAM role ARN)
- `infrastructure/terraform/modules/ecs-worker/main.tf:48`: `workermill-dev-worker-state-*` (S3 bucket)
- `bin/local-workermill:865`: `workermill/dev/database-url` (secrets path)

---

## 5. Full Blast Radius

### Resources Created by `var.environment` Interpolation

| Module | Resource Type | Current Name | New Name |
|--------|--------------|--------------|----------|
| **networking** | VPC | `workermill-dev` | `workermill-prod` |
| | IGW | `workermill-dev-igw` | `workermill-prod-igw` |
| | 6 Public Subnets | `workermill-dev-public-{az}` | `workermill-prod-public-{az}` |
| | 6 Private Subnets | `workermill-dev-private-{az}` | `workermill-prod-private-{az}` |
| | NAT Gateway | `workermill-dev-nat` | `workermill-prod-nat` |
| | Route Tables | `workermill-dev-{public,private}-rt` | `workermill-prod-*-rt` |
| **database** | RDS Instance | `workermill-dev` | `workermill-prod` |
| | Security Group | `workermill-dev-rds` | `workermill-prod-rds` |
| | Subnet Group | `workermill-dev` | `workermill-prod` |
| **ecr** | 3 ECR Repos | `workermill-dev/{api,worker,pgbouncer}` | `workermill-prod/*` |
| **ecs-cluster** | ECS Cluster | `workermill-dev` | `workermill-prod` |
| | 2 Log Groups | `/ecs/workermill-dev/{api,worker}` | `/ecs/workermill-prod/*` |
| | 3 IAM Roles | `workermill-dev-ecs-{execution,task}`, `workermill-dev-worker-task` | `workermill-prod-*` |
| **ecs-service** | ALB | `workermill-dev` | `workermill-prod` |
| | Target Group | `workermill-dev-api` | `workermill-prod-api` |
| | Security Group | `workermill-dev-alb` | `workermill-prod-alb` |
| | 2 ECS Services | `workermill-dev-{api,orchestrator}` | `workermill-prod-*` |
| | 2 Task Definitions | `workermill-dev-{api,orchestrator}` | `workermill-prod-*` |
| **ecs-worker** | Task Definition | `workermill-dev-worker` | `workermill-prod-worker` |
| **secrets** | 10+ Secrets | `workermill/dev/*` | `workermill/prod/*` |
| **cognito** | User Pool | `workermill-dev` | `workermill-prod` |
| | 2 Clients | `workermill-dev-{web,api}` | `workermill-prod-*` |
| **cognito-presignup** | Lambda | `workermill-dev-cognito-presignup` | `workermill-prod-*` |
| | Layer | `workermill-dev-pg8000` | `workermill-prod-pg8000` |
| | Security Group | `workermill-dev-cognito-presignup-sg` | `workermill-prod-*` |
| **redis** | Replication Group | `workermill-dev` | `workermill-prod` |
| | Subnet Group | `workermill-dev-redis` | `workermill-prod-redis` |
| **cdn** | S3 Bucket | `workermill-dev-frontend-{acct}` | `workermill-prod-frontend-{acct}` |
| | CF Function | `workermill-dev-spa-rewrite` | `workermill-prod-spa-rewrite` |
| **bastion** | ASG + Launch Templates | `workermill-dev-bastion` | `workermill-prod-bastion` |
| **ses-inbound** | S3 Bucket, SNS, Lambda, Rule Set | `workermill-dev-email-*` | `workermill-prod-email-*` |
| **monitoring** | SNS Topic | `workermill-dev-alarms` | `workermill-prod-alarms` |
| **github-runner-ecs** | Task Def, Log Group, IAM Roles | `workermill-dev-github-runner` | `workermill-prod-*` |

**Total: ~80+ AWS resources need name changes.**

---

## 6. Resource Rename Behavior

### Can Rename In-Place (No Destroy)

| Resource | Notes |
|----------|-------|
| `aws_cognito_user_pool` | Name is updatable. Pool ID doesn't change. Users preserved. |
| `aws_cloudfront_distribution` | No "name" — uses AWS-assigned ID. Aliases updatable in-place. |

### Forces Destroy + Recreate (No Data Loss)

| Resource | Cascade Risk |
|----------|-------------|
| `aws_ecs_cluster` | All services must be recreated |
| `aws_ecs_service` | Running tasks drained and restarted |
| `aws_ecs_task_definition` | New family starts at revision 1 |
| `aws_lb` (ALB) | **New DNS name** — Route53/CloudFront origin must update. Has `deletion_protection = true`. |
| `aws_lb_target_group` | Brief health check gap |
| `aws_security_group` | **Cascading** — everything referencing SG must also be replaced |
| `aws_iam_role` | **New ARN** — all references break |
| `aws_route53_record` | TTL propagation delay |
| `aws_autoscaling_group` | Instances terminated |
| `aws_launch_template` | Versions lost |

### Forces Destroy + Recreate (DATA LOSS)

| Resource | What's Lost | Mitigation |
|----------|-------------|------------|
| `aws_ecr_repository` | **All Docker images** | Copy images to new repo with `crane copy` first |
| `aws_s3_bucket` | **All objects** (frontend assets, emails, worker checkpoints) | `aws s3 sync` to new bucket first |
| `aws_db_instance` | **Entire database** | Snapshot → restore. Or: `state rm` + AWS Console rename + `import` (AWS supports in-place RDS rename, Terraform doesn't) |
| `aws_cloudwatch_log_group` | **All log history** | Export to S3 first if needed, or accept log loss |
| `aws_secretsmanager_secret` | **Secret values** | Create new secrets with values copied from old. `recovery_window_in_days = 0` means immediate permanent deletion. |
| `aws_elasticache_replication_group` | **Cached data** | Acceptable — Redis is pub/sub with DB fallback |

---

## 7. Rename Strategy

### Approach: State Surgery + Parallel Provisioning

We will NOT do a naive `terraform apply` that destroys and recreates everything. Instead:

1. **Stateful resources** (RDS, ECR, S3, Secrets): Create new resources in parallel, migrate data, then `terraform state rm` old + `terraform import` new
2. **RDS specifically**: Use AWS Console rename (supported natively) + `state rm` / `import` — zero data loss, brief connection interruption
3. **Stateless resources** (VPC, ECS, ALB, IAM, SGs): Accept destroy+recreate with a planned maintenance window
4. **Cognito**: In-place rename (supported)
5. **CloudFront**: In-place alias update (supported)

### Estimated Downtime

| Phase | Duration | Impact |
|-------|----------|--------|
| Pre-migration (parallel provisioning) | 0 downtime | Create new ECR repos, S3 buckets, secrets alongside old ones |
| RDS rename | ~5-10 min | Database connections interrupted during AWS modify operation |
| Infrastructure cutover | ~15-30 min | VPC, ECS, ALB recreated; DNS points to new ALB |
| DNS propagation | ~5 min | Route53 TTL is 300s |
| **Total maintenance window** | **~30-60 min** | |

---

## 8. Phased Execution Plan

### Phase 0: Pre-Flight (No Production Changes)

**Goal:** Understand exact current drift before making any changes.

```bash
cd infrastructure/terraform/environments/prod
terraform init
terraform plan -out=pre-flight.tfplan 2>&1 | tee pre-flight-output.txt
```

Save this output. It tells us exactly what AWS has vs what TF expects *today*.

Also: commit the two pending changes (lock file + index.py) so we start from a clean git state.

### Phase 1: Fix Lambda Lifecycle Bandaids (Independent of Rename)

**Goal:** Make all Lambdas manageable by Terraform again.

1. **Fix `archive_file` hash determinism** — change Lambda resources to use `source_code_hash = filebase64sha256(...)` instead of `data.archive_file.*.output_base64sha256`
2. **Fix Cognito presignup Lambda DB password** — either:
   - (a) Read password from Secrets Manager at runtime (preferred — no env var needed), or
   - (b) Verify the actual RDS password matches `module.database.password` and remove `ignore_changes = [environment]`
3. **Remove all `ignore_changes = [source_code_hash]`** from the three Lambda resources + layer
4. **Remove `ignore_changes = [environment, layers]`** from the presignup Lambda (after fixing the password source)
5. **Deploy updated Lambda code** via `terraform apply` — this will push the `autoConfirmUser`/`autoVerifyEmail` changes

### Phase 2: Pre-Provision Parallel Resources (No Downtime)

**Goal:** Create new `workermill-prod-*` resources alongside existing `workermill-dev-*` ones.

Do this manually via AWS CLI/Console (NOT Terraform — we'll import later):

1. **ECR repositories:**
   ```bash
   aws ecr create-repository --repository-name workermill-prod/api
   aws ecr create-repository --repository-name workermill-prod/worker
   aws ecr create-repository --repository-name workermill-prod/pgbouncer
   ```
   Then copy images:
   ```bash
   # Install crane: https://github.com/google/go-containerregistry/releases
   crane copy AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/workermill-dev/api:latest \
              AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/workermill-prod/api:latest
   crane copy AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/workermill-dev/worker:latest \
              AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/workermill-prod/worker:latest
   crane copy AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/workermill-dev/pgbouncer:v1.23.1-p3 \
              AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/workermill-prod/pgbouncer:v1.23.1-p3
   ```

2. **Secrets Manager** — create new secrets at `workermill/prod/*` paths, copy values:
   ```bash
   for secret in db-credentials database-url anthropic-api-key github-token jira-credentials \
                 jwt-secret session-secret email-webhook-secret stripe-secret-key \
                 stripe-webhook-secret github-runner-webhook-secret encryption-key; do
     VALUE=$(aws secretsmanager get-secret-value --secret-id "workermill/dev/$secret" --query SecretString --output text 2>/dev/null)
     if [ -n "$VALUE" ]; then
       aws secretsmanager create-secret --name "workermill/prod/$secret" --secret-string "$VALUE"
     fi
   done
   ```
   Also migrate the hardcoded ones:
   ```bash
   for secret in platform-api-key microsoft-client-id microsoft-client-secret \
                 github-client-id github-client-secret admin-phone-number admin-email; do
     VALUE=$(aws secretsmanager get-secret-value --secret-id "workermill/dev/$secret" --query SecretString --output text 2>/dev/null)
     if [ -n "$VALUE" ]; then
       aws secretsmanager create-secret --name "workermill/prod/$secret" --secret-string "$VALUE"
     fi
   done
   ```

3. **S3 buckets:**
   ```bash
   aws s3 mb s3://workermill-prod-frontend-AWS_ACCOUNT_ID
   aws s3 sync s3://workermill-dev-frontend-AWS_ACCOUNT_ID s3://workermill-prod-frontend-AWS_ACCOUNT_ID

   aws s3 mb s3://workermill-prod-worker-state-AWS_ACCOUNT_ID
   aws s3 sync s3://workermill-dev-worker-state-AWS_ACCOUNT_ID s3://workermill-prod-worker-state-AWS_ACCOUNT_ID

   aws s3 mb s3://workermill-prod-email-AWS_ACCOUNT_ID
   aws s3 sync s3://workermill-dev-email-AWS_ACCOUNT_ID s3://workermill-prod-email-AWS_ACCOUNT_ID
   ```

4. **RDS — rename in-place** (AWS supports this, Terraform doesn't):
   ```bash
   aws rds modify-db-instance \
     --db-instance-identifier workermill-dev \
     --new-db-instance-identifier workermill-prod \
     --apply-immediately
   ```
   **This causes ~5-10 min downtime** while AWS renames the instance. The endpoint DNS name changes.

### Phase 3: Terraform State Surgery

**Goal:** Update Terraform state to match the renamed/new resources without destroying anything.

1. **Change `environment` variable:**
   ```hcl
   # environments/prod/variables.tf
   default = "prod"  # was "dev"
   ```

2. **Update all hardcoded `workermill/dev/` paths** in `environments/prod/main.tf` to `workermill/prod/`

3. **Fix the hardcoded checkpoint bucket** in `modules/ecs-worker/main.tf` to use `var.environment`

4. **State surgery for RDS** (already renamed in AWS):
   ```bash
   terraform state rm module.database.aws_db_instance.main
   terraform import module.database.aws_db_instance.main workermill-prod
   ```

5. **State surgery for ECR repos** (already created in AWS):
   ```bash
   terraform state rm module.ecr.aws_ecr_repository.api
   terraform import module.ecr.aws_ecr_repository.api workermill-prod/api
   # Repeat for worker, pgbouncer
   ```

6. **State surgery for S3 buckets:**
   ```bash
   terraform state rm module.cdn.aws_s3_bucket.frontend
   terraform import module.cdn.aws_s3_bucket.frontend workermill-prod-frontend-AWS_ACCOUNT_ID
   # Repeat for worker-state, email buckets
   ```

7. **State surgery for Secrets Manager:**
   ```bash
   # For each secret managed by the secrets module:
   terraform state rm module.secrets.aws_secretsmanager_secret.db_credentials
   terraform import module.secrets.aws_secretsmanager_secret.db_credentials workermill/prod/db-credentials
   # ... repeat for all secrets
   ```

8. **Run `terraform plan`** — at this point, the plan should show:
   - **No changes** for stateful resources (RDS, ECR, S3, Secrets) — they match state
   - **Destroy+recreate** for stateless resources (VPC, ECS, ALB, IAM, SGs, etc.)
   - **In-place update** for Cognito user pool name

### Phase 4: Infrastructure Cutover (Maintenance Window)

**Goal:** Recreate stateless infrastructure with new names.

1. **Announce maintenance window**
2. **Scale down ECS services:**
   ```bash
   aws ecs update-service --cluster workermill-dev --service workermill-dev-api --desired-count 0
   aws ecs update-service --cluster workermill-dev --service workermill-dev-orchestrator --desired-count 0
   ```
3. **Wait for tasks to drain** (~2 min)
4. **Disable ALB deletion protection:**
   ```bash
   aws elbv2 modify-load-balancer-attributes \
     --load-balancer-arn <arn> \
     --attributes Key=deletion_protection.enabled,Value=false
   ```
5. **Run `terraform apply`** — this will:
   - Destroy old VPC, subnets, NAT, IGW, route tables
   - Destroy old ECS cluster, services, task definitions
   - Destroy old ALB, target group, listeners
   - Destroy old security groups, IAM roles
   - Destroy old CloudWatch log groups
   - Destroy old Redis
   - Create all of the above with `workermill-prod-*` names
   - Update Cognito user pool name in-place
   - Update CloudFront in-place
6. **Wait for ECS services to stabilize** (~5 min)
7. **Verify health checks pass**
8. **Update Route53** if the ALB DNS name changed (Terraform handles this automatically)

### Phase 5: Update Application Code & Scripts

**Goal:** All hardcoded `workermill-dev` references point to `workermill-prod`.

These changes should be committed **before** Phase 4 so the next deploy picks them up. See [Section 9](#9-files-to-modify) for the complete list.

### Phase 6: Verification & Cleanup

1. **Run `terraform plan`** — confirm **zero drift**
2. **Test end-to-end:** Cognito login → Dashboard → Create task → Worker spawn → Logs stream
3. **Verify deploy.sh works:**
   ```bash
   ./deploy.sh --api --skip-build  # just updates ECS service
   ./deploy.sh --frontend          # deploys to new S3 bucket
   ```
4. **Delete old resources** (after 1 week of stable operation):
   ```bash
   # Old ECR repos (images already copied)
   aws ecr delete-repository --repository-name workermill-dev/api --force
   aws ecr delete-repository --repository-name workermill-dev/worker --force
   aws ecr delete-repository --repository-name workermill-dev/pgbouncer --force

   # Old S3 buckets (data already synced)
   aws s3 rb s3://workermill-dev-frontend-AWS_ACCOUNT_ID --force
   aws s3 rb s3://workermill-dev-worker-state-AWS_ACCOUNT_ID --force
   aws s3 rb s3://workermill-dev-email-AWS_ACCOUNT_ID --force

   # Old secrets (values already copied)
   for secret in db-credentials database-url anthropic-api-key github-token jira-credentials \
                 jwt-secret session-secret email-webhook-secret stripe-secret-key \
                 stripe-webhook-secret github-runner-webhook-secret encryption-key \
                 platform-api-key microsoft-client-id microsoft-client-secret \
                 github-client-id github-client-secret admin-phone-number admin-email; do
     aws secretsmanager delete-secret --secret-id "workermill/dev/$secret" --force-delete-without-recovery
   done
   ```

---

## 9. Files to Modify

### Terraform Files

| File | Change |
|------|--------|
| `environments/prod/variables.tf:21` | `default = "dev"` → `default = "prod"` |
| `environments/prod/main.tf:55` | `workermill/dev/platform-api-key` → `workermill/prod/platform-api-key` |
| `environments/prod/main.tf:60` | `workermill/dev/microsoft-client-id` → `workermill/prod/microsoft-client-id` |
| `environments/prod/main.tf:64` | `workermill/dev/microsoft-client-secret` → `workermill/prod/microsoft-client-secret` |
| `environments/prod/main.tf:69` | `workermill/dev/github-client-id` → `workermill/prod/github-client-id` |
| `environments/prod/main.tf:73` | `workermill/dev/github-client-secret` → `workermill/prod/github-client-secret` |
| `environments/prod/main.tf:78` | `workermill/dev/admin-phone-number` → `workermill/prod/admin-phone-number` |
| `environments/prod/main.tf:82` | `workermill/dev/admin-email` → `workermill/prod/admin-email` |
| `environments/prod/main.tf:126` | `workermill/dev/cloudflare-tunnel-token` → `workermill/prod/cloudflare-tunnel-token` |
| `modules/ecs-worker/main.tf:48` | Hardcoded `workermill-dev-worker-state-*` → use `var.environment` interpolation |

### Application Code

| File | Line | Change |
|------|------|--------|
| `api/src/config/index.ts` | 86 | `"dev"` → `"prod"` |
| `api/src/config/index.ts` | 107 | `"workermill-dev"` → `"workermill-prod"` |
| `api/src/config/index.ts` | 108 | `"workermill-dev-worker"` → `"workermill-prod-worker"` |
| `api/src/config/index.ts` | 111 | `"/ecs/workermill-dev/worker"` → `"/ecs/workermill-prod/worker"` |
| `api/src/config/index.ts` | 114 | `"workermill-dev-github-runner"` → `"workermill-prod-github-runner"` |
| `api/src/routes/remote-agent.ts` | 1010 | `workermill-dev/worker:latest` → `workermill-prod/worker:latest` |
| `frontend/src/pages/settings/index.tsx` | 4091 | `workermill-dev-worker-task` → `workermill-prod-worker-task` |

### Scripts

| File | Lines | Change |
|------|-------|--------|
| `deploy.sh` | 23 | `workermill-dev/api` → `workermill-prod/api` |
| `deploy.sh` | 24 | `workermill-dev/worker` → `workermill-prod/worker` |
| `deploy.sh` | 25 | `workermill-dev` → `workermill-prod` (ECS cluster) |
| `deploy.sh` | 26 | `workermill-dev-api` → `workermill-prod-api` (ECS service) |
| `deploy.sh` | 27 | `workermill-dev-frontend-*` → `workermill-prod-frontend-*` (S3) |
| `deploy.sh` | 228 | `workermill-dev-bastion-control` → `workermill-prod-bastion-control` |
| `deploy.sh` | 244 | `workermill-dev-bastion` → `workermill-prod-bastion` |
| `deploy.sh` | 323, 370 | `workermill/dev/database-url` → `workermill/prod/database-url` |
| `bin/local-workermill` | 865 | `workermill/dev/database-url` → `workermill/prod/database-url` |

### Documentation

| File | Change |
|------|--------|
| `CLAUDE.md` | Update any `workermill-dev` references in examples |
| `docs/claude/infrastructure.md` | Update resource name examples |
| `worker/directives/security_engineer/incident_response.md` | Update example commands |
| `environments/prod/variables.tf` | Rewrite header comment to explain the rename |

---

## 10. Dev Environment Cleanup

The dev environment (`environments/dev/`) is not running and has diverged significantly from prod. Options:

### Option A: Delete dev environment entirely
- Remove `environments/dev/` directory
- Destroy any remaining AWS resources in `workermill-sandbox-*` namespace
- If dev is ever needed, recreate from prod config with `environment = "dev"`

### Option B: Bring dev to parity
- Add missing modules (redis, bastion, cognito-presignup, ses-inbound, github-runner-ecs)
- Fix placeholder `platform_api_key_secret_arn`
- Commit lock file changes

**Recommendation:** Option A. Dev isn't running, and the sandbox naming doesn't collide with anything. When needed, it can be recreated cleanly.

---

## 11. Rollback Plan

### If Phase 4 Fails Mid-Apply

Terraform state may be partially updated. Recovery:

1. **Do NOT re-run `terraform apply`** — the state may be inconsistent
2. Check `terraform state list` to see what resources exist
3. For resources that were destroyed but not recreated: manually create via AWS CLI
4. For resources that were created with new names but old ones still exist: clean up duplicates
5. `terraform import` any resources created outside Terraform

### If Application Breaks Post-Rename

1. API config fallbacks use env vars first — update ECS task definition env vars to use old `workermill-dev-*` names
2. deploy.sh changes are git-tracked — `git revert` the commit
3. Secrets are at both old (`workermill/dev/*`) and new (`workermill/prod/*`) paths for 1 week — switch back to old paths

### Nuclear Option: Full Revert

If everything goes wrong, the old resources still exist (we don't delete them until Phase 6):

1. Revert all code changes (`git revert`)
2. `terraform state rm` all imported new-name resources
3. `terraform import` all old-name resources back
4. Set `environment = "dev"` again
5. `terraform apply` — should show no changes

---

## Appendix: Google OAuth Secret Inconsistency

`environments/prod/main.tf:308` references `workermill/prod/google-oauth` while all other hardcoded secrets use `workermill/dev/*`. This is either:
- A bug (should be `workermill/dev/google-oauth`)
- An early attempt at proper naming that wasn't applied consistently

**Action:** Verify which path actually exists in AWS. During the rename, standardize all to `workermill/prod/*`.
