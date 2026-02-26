# Bastion Fix Design

**Date:** 2026-02-25
**Status:** Approved

## Problem

The bastion host is unreliable for agents. Four compounding bugs:

1. **Terraform kills running bastions.** ASG `desired_capacity = 0` in Terraform, no `ignore_changes`. Every `terraform apply` (even for unrelated changes) resets capacity to 0, terminating the instance mid-session.
2. **deploy.sh bypasses Lambda for IP whitelisting.** `whitelist_current_ip()` calls `aws ec2 authorize-security-group-ingress` directly, creating rules without the `"Dynamic: Added by Lambda"` description. The Lambda never cleans these up — stale IPs accumulate indefinitely.
3. **No SSH retry logic.** deploy.sh tries the SSH tunnel once. Freshly-booted spot instances often have sshd not ready yet when the ASG reports `running`. One failure = agent gives up.
4. **No auto-stop.** Forgotten bastions run forever. No idle detection, no TTL.

## Solution

### Fix 1: Terraform — `ignore_changes = [desired_capacity]`

**File:** `infrastructure/terraform/modules/bastion/main.tf` (ASG resource)

Add `desired_capacity` to the lifecycle `ignore_changes` list. This is the standard pattern for ASGs controlled by external processes (Lambda, scheduled actions). Terraform owns the ASG structure; Lambda owns the capacity.

```hcl
lifecycle {
  create_before_destroy = true
  ignore_changes        = [desired_capacity]
}
```

### Fix 2: deploy.sh — Route all whitelisting through Lambda

**File:** `deploy.sh`

Delete the `whitelist_current_ip()` function entirely. Replace its call sites with the existing `invoke_bastion` function using a new payload that includes the IP:

```bash
invoke_bastion_with_ip() {
    local action="$1"
    local ip="$2"
    local response_file=$(mktemp)
    local payload="{\"action\":\"$action\",\"ip\":\"$ip\"}"
    MSYS_NO_PATHCONV=1 aws lambda invoke \
        --function-name "workermill-dev-bastion-control" \
        --payload "$payload" \
        --cli-binary-format raw-in-base64-out \
        --region "$AWS_REGION" "$response_file" > /dev/null 2>&1
    cat "$response_file"
    rm -f "$response_file"
}
```

In `start_bastion_if_needed()`, detect the IP once and pass it to the Lambda `start` action (which already handles whitelisting). Remove the separate `whitelist_current_ip` call.

### Fix 3: deploy.sh — SSH tunnel retry loop

**File:** `deploy.sh`, `start_ssh_tunnel()` function

Wrap the SSH tunnel establishment in a retry loop: 3 attempts, 5 seconds apart. After each attempt, verify the tunnel with `nc -z localhost 5432`. This handles the sshd-not-ready race on fresh spot instances.

### Fix 4: Lambda — Aggressive IP cleanup on start

**File:** `infrastructure/terraform/modules/bastion/main.tf` (Lambda source)

When the Lambda `start` or `whitelist` action runs, revoke ALL `/32` SSH ingress rules (not just `Dynamic:` ones) before adding the new IP. Static CIDRs from `allowed_ssh_cidrs` (Terraform variable) won't be `/32` so they're safe. This cleans up the stale rules created by the old deploy.sh bypass.

### Fix 5: Auto-stop after 20 minutes idle

**Files:** `infrastructure/terraform/modules/bastion/main.tf`

Add a new `auto_stop_check` action to the existing Lambda:

1. EventBridge scheduled rule fires every 5 minutes with `{"action": "auto_stop_check"}`
2. Lambda checks if bastion ASG desired_capacity > 0 (if stopped, no-op)
3. Gets the bastion instance ID from ASG
4. Queries CloudWatch `AWS/EC2 → NetworkPacketsIn` for the instance over the last 20 minutes (four 5-minute periods)
5. If total packets below threshold (idle — no active SSH tunnel), sets desired_capacity to 0

New IAM permission needed: `cloudwatch:GetMetricStatistics` on `*`.

New Terraform resources:
- `aws_cloudwatch_event_rule.bastion_idle_check` — schedule every 5 min
- `aws_cloudwatch_event_target.bastion_idle_check` — targets the existing Lambda
- `aws_lambda_permission.bastion_idle_check` — allows EventBridge to invoke Lambda

These are always-on (not gated by `enable_schedule`), since idle detection should always be active.

## Files Changed

| File | Change |
|------|--------|
| `infrastructure/terraform/modules/bastion/main.tf` | ASG lifecycle ignore, Lambda `auto_stop_check` action, aggressive IP cleanup, EventBridge idle check resources, IAM permission |
| `deploy.sh` | Delete `whitelist_current_ip()`, use Lambda for whitelisting, SSH retry loop |

## What NOT to change

- The bastion architecture (Lambda-controlled ASG + spot instances)
- The `bin/bastion` script (already uses Lambda correctly)
- The SSH key mechanism
- The RDS security group rules (the inline/standalone drift is cosmetic and will resolve when bastion SG rules are properly managed)
