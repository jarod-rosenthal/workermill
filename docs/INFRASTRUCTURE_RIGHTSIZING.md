# Infrastructure Rightsizing Plan

> **Status**: Draft - Pending Review
> **Created**: 2026-01-26
> **Target Environment**: Production only

## Objective

Rightsize WorkerMill production infrastructure to support growing multi-tenant workloads with minimal cost increase (~$80-90/month target).

---

## Current State Analysis

### Bottlenecks Identified

| Component | Current Value | Issue | Priority |
|-----------|---------------|-------|----------|
| API CPU/Memory | 256 / 512 MB | Insufficient for Node.js + 20 DB connections | **CRITICAL** |
| API Instances | 1 | No redundancy, 100% Spot = interruption risk | **CRITICAL** |
| Capacity Provider | 100% FARGATE_SPOT | API subject to Spot interruptions | **HIGH** |
| Auto-Scaling | None | Manual intervention for load spikes | **MEDIUM** |
| RDS Instance | db.t4g.micro | 85 max connections (defer upgrade) | LOW |
| Connection Pool | max: 20 | Needs tuning for 2 instances | **HIGH** |

### Multi-Tenant Scaling Concerns

1. **Database Connection Pool Saturation** - Max 20 connections shared across all orgs
2. **ECS Task Monitoring Lag** - Only 10 executing tasks monitored per poll cycle
3. **Per-Org Concurrency Limits** - Max 10 concurrent workers per org (configurable)
4. **No Per-Org Rate Limiting** - Current rate limits are IP-based, not org-based

---

## Phase 1: Immediate Fixes

**Estimated Cost Impact**: +$30-40/month (total: ~$80-90/month)

### 1.1 Increase API Container Resources

**File**: `infrastructure/terraform/modules/ecs-service/main.tf` (lines 124-125)

```hcl
# FROM:
cpu    = "256"
memory = "512"

# TO:
cpu    = "512"
memory = "1024"
```

**Rationale**: Current 256/512 is the minimum Fargate allows. Node.js with 20 DB connections needs more headroom to avoid OOM kills.

### 1.2 Add Capacity Provider Mix (Spot + On-Demand)

**File**: `infrastructure/terraform/modules/ecs-service/main.tf` (lines 192-195)

```hcl
# FROM:
capacity_provider_strategy {
  capacity_provider = "FARGATE_SPOT"
  weight            = 100
}

# TO:
capacity_provider_strategy {
  capacity_provider = "FARGATE"
  weight            = 20
  base              = 1  # Always 1 on-demand instance for stability
}

capacity_provider_strategy {
  capacity_provider = "FARGATE_SPOT"
  weight            = 80
  base              = 0
}
```

**Rationale**: `base = 1` on FARGATE ensures at least one on-demand instance always runs, protecting against Spot interruptions taking down the entire API.

### 1.3 Increase Desired Count to 2

**File**: `infrastructure/terraform/modules/ecs-service/main.tf` (line 188)

```hcl
# FROM:
desired_count = 1

# TO:
desired_count = 2
```

**Rationale**: Provides redundancy across availability zones. ALB health checks will route traffic away from failed instances.

### 1.4 Tune Connection Pool for 2 Instances

**File**: `api/src/db/connection.ts` (lines 107-112)

```typescript
// FROM:
extra: {
  max: 20,
  min: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
}

// TO:
extra: {
  max: 10,  // 2 instances x 10 = 20 total (under 85 limit)
  min: 2,
  idleTimeoutMillis: 15000,
  connectionTimeoutMillis: 5000,
}
```

**Rationale**:
- 2 instances x 10 = 20 connections (safe under 85 RDS limit)
- With future auto-scaling to 4 instances: 4 x 10 = 40 connections (still safe)
- Faster idle timeout releases connections for other processes

---

## Phase 2: Auto-Scaling Options

Three approaches to consider after observing Phase 1 traffic patterns:

### Option A: Target Tracking (Recommended for Simplicity)

Automatically scales based on CPU/Memory thresholds.

**Pros**: Simple, AWS-managed, no custom metrics needed
**Cons**: Reactive (scales after load increases)

```hcl
# New file: infrastructure/terraform/modules/ecs-service/autoscaling.tf

resource "aws_appautoscaling_target" "api" {
  max_capacity       = 4
  min_capacity       = 2
  resource_id        = "service/${var.ecs_cluster_name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "workermill-${var.environment}-api-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0   # Scale when CPU > 70%
    scale_in_cooldown  = 300    # 5 min before scaling down
    scale_out_cooldown = 60     # 1 min before scaling up
  }
}
```

### Option B: Request Count Scaling

Scales based on ALB request count per target.

**Pros**: Proactive, scales before CPU spikes
**Cons**: Requires ALB metrics integration

```hcl
resource "aws_appautoscaling_policy" "api_requests" {
  name               = "workermill-${var.environment}-api-request-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
    target_value       = 500  # Scale when > 500 requests/min per instance
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
```

### Option C: Scheduled Scaling

Pre-scales for known traffic patterns.

**Pros**: Cost-effective for predictable loads
**Cons**: Requires traffic pattern analysis

```hcl
# Scale up during business hours (M-F 8am-6pm EST)
resource "aws_appautoscaling_scheduled_action" "scale_up" {
  name               = "workermill-${var.environment}-scale-up"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  schedule           = "cron(0 8 ? * MON-FRI *)"  # 8am UTC

  scalable_target_action {
    min_capacity = 3
    max_capacity = 4
  }
}

resource "aws_appautoscaling_scheduled_action" "scale_down" {
  name               = "workermill-${var.environment}-scale-down"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  schedule           = "cron(0 18 ? * MON-FRI *)"  # 6pm UTC

  scalable_target_action {
    min_capacity = 2
    max_capacity = 3
  }
}
```

### Auto-Scaling Comparison

| Approach | Cost Impact | Best For |
|----------|-------------|----------|
| Option A (CPU-based) | +$0-30/mo when scaling | Variable, unpredictable traffic |
| Option B (Request-based) | +$0-30/mo when scaling | Webhook-heavy workloads |
| Option C (Scheduled) | +$15-30/mo fixed | Predictable business-hours usage |
| **No auto-scaling (Phase 1)** | $0 | Start here, add later |

**Recommendation**: Implement Phase 1 first with fixed 2 instances. Monitor CPU/Memory for 1-2 weeks, then decide on auto-scaling approach based on observed patterns.

---

## Files to Modify

### Phase 1 (Required)

| File | Changes |
|------|---------|
| `infrastructure/terraform/modules/ecs-service/main.tf` | CPU/Memory (512/1024), desired_count (2), capacity providers |
| `api/src/db/connection.ts` | Reduce pool max from 20 to 10 |

### Phase 2 (Optional - Auto-Scaling)

| File | Changes |
|------|---------|
| `infrastructure/terraform/modules/ecs-service/autoscaling.tf` | **NEW** - Auto-scaling policies |
| `infrastructure/terraform/modules/ecs-service/variables.tf` | Add min/max instance variables |

---

## Deployment Steps

### Phase 1 Deployment

1. **Update Terraform configuration**:
   ```bash
   cd infrastructure/terraform/environments/prod
   terraform plan -var="domain_name=workermill.com"
   ```

2. **Review plan** - Ensure changes match expected:
   - ECS task definition CPU/Memory update
   - ECS service desired count and capacity provider changes

3. **Apply changes**:
   ```bash
   terraform apply -var="domain_name=workermill.com"
   ```

4. **Deploy API code** (for connection pool changes):
   ```bash
   ./deploy.sh --api
   ```

---

## Verification Steps

### After Terraform Apply

```bash
# Verify 2 instances running
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api \
  --query 'services[0].{running: runningCount, desired: desiredCount}'

# Verify capacity providers (should show FARGATE base=1, FARGATE_SPOT weight=80)
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api \
  --query 'services[0].capacityProviderStrategy'

# Verify CPU/Memory (should show 512/1024)
aws ecs describe-task-definition --task-definition workermill-dev-api \
  --query 'taskDefinition.{cpu: cpu, memory: memory}'
```

### After API Deployment

```bash
# Check connection pool in logs
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1

# Monitor database connections (should stay around 20 total with 2 instances)
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=workermill-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 --statistics Average --region us-east-1
```

### End-to-End Test

1. Deploy with `./deploy.sh --api`
2. Create multiple test tasks from dashboard
3. Verify both API instances handle requests (check ALB target health)
4. Confirm no Spot interruption issues over 24-48 hours

---

## Cost Summary

| Component | Current | After Phase 1 |
|-----------|---------|---------------|
| API (1x 256/512 Spot) | ~$10/mo | — |
| API (2x 512/1024 mixed) | — | ~$50-60/mo |
| RDS db.t4g.micro | ~$12/mo | ~$12/mo (unchanged) |
| Other (ALB, logs, etc) | ~$30/mo | ~$30/mo |
| **Total** | **~$52/mo** | **~$80-90/mo** |

---

## Rollback Plan

If issues occur after deployment:

1. **Immediate**: Revert `main.tf` changes, run `terraform apply`
2. **Connection issues**: Revert `connection.ts`, redeploy API with `./deploy.sh --api`

---

## Deferred Items (Future Scaling)

| Item | Trigger | Cost Impact |
|------|---------|-------------|
| RDS upgrade to db.t4g.small | Approaching 85 connection limit | +$25/mo |
| Multi-AZ for RDS | Uptime SLA required | +$37/mo |
| Auto-scaling implementation | After traffic pattern analysis | +$0-30/mo |
| Additional database indexes | Query performance issues | $0 |
| PgBouncer connection pooling | 10+ API instances needed | +$15-20/mo |

---

## Appendix: Full Bottleneck Analysis

### Infrastructure Bottlenecks

1. **API Container (256 CPU / 512 MB)** - CRITICAL
   - Node.js with 20 DB connections needs more memory
   - Risk: OOM kills, request timeouts, SSE drops

2. **Single API Instance** - CRITICAL
   - No redundancy, 100% Spot = subject to interruptions
   - ECS restarts on new capacity, but SSE connections drop

3. **Database Connections**
   - Current pool: 20 max per instance
   - RDS limit: 85 (db.t4g.micro)
   - At 3+ API instances: 60+ connections, approaching limit

### Multi-Tenant Architecture Bottlenecks

1. **Orchestrator Task Claiming** - 5 tasks claimed per poll (every 5s)
2. **ECS Monitoring Batch** - 10 tasks monitored per poll
3. **Per-Org Limits** - 1-10 concurrent workers (configurable)
4. **Rate Limiting** - IP-based, not org-based (multi-tenant fairness issue)

### Database Indexes (Already Present)

```sql
idx_worker_tasks_status_created         ON (status, created_at)
idx_worker_tasks_org_status_created     ON (org_id, status, created_at DESC)
idx_worker_tasks_org_created            ON (org_id, created_at DESC)
idx_worker_task_logs_task_created       ON (task_id, created_at)
idx_worker_tasks_jira_key               ON (jira_issue_key)
```

### Potential Missing Index

```sql
-- For coordination service getActiveWorkerCountsByRepo
CREATE INDEX idx_worker_check_ins_org_repo ON worker_check_ins(org_id, repo);
```
