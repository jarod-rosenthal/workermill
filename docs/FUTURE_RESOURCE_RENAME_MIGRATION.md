# Future Migration: Rename Production Resources

## Overview

This document describes the future migration needed to rename production AWS resources from `workermill-dev-*` to `workermill-prod-*`. This is a **cosmetic cleanup** - the current system works correctly with the "dev" naming.

**Current State:** Production resources are named `workermill-dev-*` due to historical naming. The Terraform folder structure reflects intent (`environments/prod/`), but AWS Console shows "dev" names.

**Target State:** All production resources named `workermill-prod-*` for clarity.

---

## Why This Wasn't Done Now

1. **Risk to Customer:** A paying customer needs stable production
2. **Data Migration:** RDS rename requires dump/restore or replication
3. **Cognito Migration:** User pool migration may require password resets
4. **Downtime:** Full migration requires coordinated cutover
5. **Cost:** Running duplicate infrastructure during migration

---

## Resources That Need Migration

| Resource | Current Name | Target Name | Migration Method |
|----------|--------------|-------------|------------------|
| VPC | workermill-dev | workermill-prod | Create new |
| ECS Cluster | workermill-dev | workermill-prod | Create new |
| RDS Instance | workermill-dev | workermill-prod | pg_dump/restore or replication |
| ECR Repos | workermill-dev/* | workermill-prod/* | Create new, re-push images |
| S3 Buckets | workermill-dev-* | workermill-prod-* | Create new, sync data |
| CloudWatch Logs | /ecs/workermill-dev/* | /ecs/workermill-prod/* | Create new (old logs archived) |
| Cognito User Pool | workermill-dev | workermill-prod | Export/import users |
| Secrets Manager | workermill/dev/* | workermill/prod/* | Create new |
| ALB | workermill-dev-alb | workermill-prod-alb | Create new |

---

## Migration Plan

### Phase 1: Preparation (1-2 days)

1. **Create fresh production environment**
   ```bash
   cd infrastructure/terraform/environments/prod-v2
   terraform init -backend-config="bucket=workermill-terraform-state-593971626975"
   terraform plan -var="environment=prod" -var="domain_name=workermill.com"
   ```

2. **Set up RDS replication**
   - Create read replica from current RDS
   - Promote to standalone when ready for cutover

3. **Export Cognito users**
   - Use AWS CLI to export user pool
   - Note: Passwords cannot be exported - users may need to reset

### Phase 2: Data Sync (1-2 hours before cutover)

1. **Put system in maintenance mode**
   - Display maintenance page
   - Stop orchestrator

2. **Final database sync**
   - If using replication: promote read replica
   - If using dump/restore: run final pg_dump

3. **Sync S3 data**
   ```bash
   aws s3 sync s3://workermill-dev-frontend-593971626975 s3://workermill-prod-frontend-593971626975
   aws s3 sync s3://workermill-dev-worker-state-593971626975 s3://workermill-prod-worker-state-593971626975
   ```

4. **Copy secrets**
   - Copy all secrets from `workermill/dev/*` to `workermill/prod/*`

### Phase 3: Cutover (30-60 minutes)

1. **Update DNS**
   - Point workermill.com to new CloudFront distribution
   - TTL should be lowered in advance

2. **Deploy to new infrastructure**
   ```bash
   ./deploy.sh --all --env prod-v2
   ```

3. **Verify functionality**
   - Test login (Cognito)
   - Test API endpoints
   - Test worker task creation

4. **Remove maintenance mode**

### Phase 4: Cleanup (1 week later)

1. **Delete old infrastructure**
   ```bash
   cd infrastructure/terraform/environments/prod-old
   terraform destroy
   ```

2. **Update deploy.sh** to remove old environment config

3. **Archive old state file**

---

## Estimated Downtime

| Component | Downtime |
|-----------|----------|
| Frontend | 5-10 minutes (DNS propagation) |
| API | 15-30 minutes |
| Worker tasks | No new tasks during migration |
| Database | 0 if using replication, 30-60 min if dump/restore |

**Total estimated downtime:** 30-60 minutes with proper preparation

---

## Rollback Plan

1. **If migration fails before DNS cutover:**
   - Simply continue using old infrastructure
   - Delete new resources

2. **If migration fails after DNS cutover:**
   - Revert DNS to old CloudFront
   - Users may have stale data from migration window

---

## Checklist for Migration Day

- [ ] Maintenance page ready
- [ ] RDS replication verified (if using)
- [ ] Cognito export completed
- [ ] DNS TTL lowered (at least 24h before)
- [ ] New infrastructure verified with test data
- [ ] Team on standby for rollback
- [ ] Customer notified of maintenance window

---

## When to Do This

Consider this migration when:
- Customer count grows and "dev" naming becomes confusing
- You have a scheduled maintenance window
- Team has bandwidth for multi-day migration project
- No critical deadlines in the following week (buffer for issues)

**Not recommended during:**
- Customer onboarding
- Active development sprints
- Holiday periods
