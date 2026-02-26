# Bastion Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 4 root causes that make the bastion unreliable for agents: terraform drift, stale IP rules, SSH flakiness, and no auto-stop.

**Architecture:** Patch the existing Lambda-controlled ASG bastion. No new infrastructure patterns — just lifecycle ignore, Lambda code fixes, deploy.sh cleanup, and an EventBridge idle check.

**Tech Stack:** Terraform (HCL), Python 3.12 (Lambda), Bash (deploy.sh)

---

### Task 1: Fix ASG lifecycle to ignore desired_capacity

**Files:**
- Modify: `infrastructure/terraform/modules/bastion/main.tf:280-282`

**Step 1: Add ignore_changes to ASG lifecycle block**

In the `aws_autoscaling_group.bastion` resource, change the lifecycle block from:

```hcl
  lifecycle {
    create_before_destroy = true
  }
```

to:

```hcl
  lifecycle {
    create_before_destroy = true
    ignore_changes        = [desired_capacity]
  }
```

This prevents `terraform apply` from resetting desired_capacity to 0 when the Lambda has set it to 1.

**Step 2: Commit**

```bash
git add infrastructure/terraform/modules/bastion/main.tf
git commit -m "fix(bastion): ignore desired_capacity in ASG lifecycle

Terraform hardcodes desired_capacity=0 but Lambda controls it at runtime.
Without ignore_changes, every terraform apply kills the running bastion."
```

---

### Task 2: Update Lambda — aggressive IP cleanup + auto_stop_check action

**Files:**
- Modify: `infrastructure/terraform/modules/bastion/main.tf:293-493` (Lambda Python source)

**Step 1: Replace the `update_security_group` function**

The current function only revokes rules with `"Dynamic:"` description. Change it to revoke ALL `/32` SSH rules before adding the new one. Static CIDRs from Terraform won't be `/32` (they'd be wider ranges), so they're safe.

Replace the existing `update_security_group` function (lines ~319-364) with:

```python
def update_security_group(ec2, sg_id, allowed_ip):
    """Update security group to allow SSH from the given IP.
    Revokes ALL /32 SSH rules first (cleans up stale entries from any source).
    Static CIDRs from Terraform are wider ranges and won't be affected."""
    cidr = f"{allowed_ip}/32"

    # Get current rules
    sg = ec2.describe_security_groups(GroupIds=[sg_id])['SecurityGroups'][0]

    # Revoke all /32 SSH rules (both Lambda-added and manually-added)
    for rule in sg.get('IpPermissions', []):
        if rule.get('FromPort') == 22 and rule.get('ToPort') == 22:
            stale_cidrs = [r['CidrIp'] for r in rule.get('IpRanges', [])
                          if r['CidrIp'].endswith('/32')]
            if stale_cidrs:
                try:
                    ec2.revoke_security_group_ingress(
                        GroupId=sg_id,
                        IpPermissions=[{
                            'IpProtocol': 'tcp',
                            'FromPort': 22,
                            'ToPort': 22,
                            'IpRanges': [{'CidrIp': c} for c in stale_cidrs]
                        }]
                    )
                except Exception:
                    pass

    # Add new rule
    ec2.authorize_security_group_ingress(
        GroupId=sg_id,
        IpPermissions=[{
            'IpProtocol': 'tcp',
            'FromPort': 22,
            'ToPort': 22,
            'IpRanges': [{'CidrIp': cidr, 'Description': f'Dynamic: Added by Lambda'}]
        }]
    )
    return {'updated': True, 'message': f'Added {cidr} to security group'}
```

**Step 2: Add the `auto_stop_check` action to the handler**

Add this new `elif` block in the `handler` function, right before the final `else` clause (before line ~491):

```python
    elif action == 'auto_stop_check':
        # Check if bastion is running
        response = asg.describe_auto_scaling_groups(AutoScalingGroupNames=[asg_name])
        if not response['AutoScalingGroups']:
            return {'status': 'no_asg'}

        asg_info = response['AutoScalingGroups'][0]
        if asg_info['DesiredCapacity'] == 0:
            return {'status': 'already_stopped'}

        instances = asg_info['Instances']
        if not instances:
            return {'status': 'no_instances'}

        instance_id = instances[0]['InstanceId']

        # Query CloudWatch for network activity over last 20 minutes
        cw = boto3.client('cloudwatch')
        import datetime
        end_time = datetime.datetime.utcnow()
        start_time = end_time - datetime.timedelta(minutes=20)

        metrics = cw.get_metric_statistics(
            Namespace='AWS/EC2',
            MetricName='NetworkPacketsIn',
            Dimensions=[{'Name': 'InstanceId', 'Value': instance_id}],
            StartTime=start_time,
            EndTime=end_time,
            Period=300,
            Statistics=['Sum']
        )

        total_packets = sum(dp['Sum'] for dp in metrics.get('Datapoints', []))

        # Threshold: < 50 packets in 20 min means idle (no active SSH tunnel)
        # An active SSH tunnel generates thousands of packets per period
        if total_packets < 50:
            asg.set_desired_capacity(
                AutoScalingGroupName=asg_name,
                DesiredCapacity=0
            )
            return {
                'status': 'stopped_idle',
                'message': f'Bastion idle for 20 min ({int(total_packets)} packets). Stopped.',
                'total_packets': int(total_packets)
            }

        return {
            'status': 'active',
            'message': f'Bastion active ({int(total_packets)} packets in last 20 min).',
            'total_packets': int(total_packets)
        }
```

**Step 3: Commit**

```bash
git add infrastructure/terraform/modules/bastion/main.tf
git commit -m "fix(bastion): aggressive IP cleanup + idle auto-stop in Lambda

- update_security_group now revokes ALL /32 SSH rules before adding new IP,
  cleaning up stale entries from deploy.sh direct EC2 API calls
- New auto_stop_check action: queries CloudWatch NetworkPacketsIn for last
  20 min, stops bastion if < 50 packets (idle)"
```

---

### Task 3: Add Terraform resources — IAM permission + EventBridge idle check

**Files:**
- Modify: `infrastructure/terraform/modules/bastion/main.tf`

**Step 1: Add CloudWatch GetMetricStatistics IAM permission**

In the `aws_iam_role_policy.bastion_lambda` resource (line ~542), add a new statement after the `EC2Describe` statement:

```hcl
      {
        Sid    = "CloudWatchMetrics"
        Effect = "Allow"
        Action = [
          "cloudwatch:GetMetricStatistics"
        ]
        Resource = "*"
      },
```

**Step 2: Add EventBridge idle check resources**

Add these at the end of the file, after the existing EventBridge stop resources (after line 674):

```hcl
# -----------------------------------------------------------------------------
# Bastion Idle Auto-Stop (always enabled)
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "bastion_idle_check" {
  name                = "workermill-${var.environment}-bastion-idle-check"
  description         = "Check bastion idle status every 5 minutes"
  schedule_expression = "rate(5 minutes)"

  tags = {
    Name = "workermill-${var.environment}-bastion-idle-check"
  }
}

resource "aws_cloudwatch_event_target" "bastion_idle_check" {
  rule      = aws_cloudwatch_event_rule.bastion_idle_check.name
  target_id = "bastion-idle-check"
  arn       = aws_lambda_function.bastion_control.arn
  input     = jsonencode({ action = "auto_stop_check" })
}

resource "aws_lambda_permission" "bastion_idle_check" {
  statement_id  = "AllowEventBridgeIdleCheck"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.bastion_control.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.bastion_idle_check.arn
}
```

**Step 3: Commit**

```bash
git add infrastructure/terraform/modules/bastion/main.tf
git commit -m "feat(bastion): EventBridge idle check every 5 min + CloudWatch IAM

- Always-on EventBridge rule invokes Lambda auto_stop_check every 5 min
- Lambda IAM policy gains cloudwatch:GetMetricStatistics for idle detection"
```

---

### Task 4: Fix deploy.sh — use Lambda for whitelisting + SSH retries

**Files:**
- Modify: `deploy.sh:223-356`

**Step 1: Update invoke_bastion to accept optional payload**

Replace the `invoke_bastion` function (lines 223-232) with:

```bash
# Invoke bastion Lambda
invoke_bastion() {
    local action="$1"
    local extra_payload="${2:-}"
    local response_file=$(mktemp)
    local payload="{\"action\":\"$action\"${extra_payload:+,$extra_payload}}"

    MSYS_NO_PATHCONV=1 aws lambda invoke --function-name "workermill-dev-bastion-control" --payload "$payload" --cli-binary-format raw-in-base64-out --region "$AWS_REGION" "$response_file" > /dev/null 2>&1

    cat "$response_file"
    rm -f "$response_file"
}
```

**Step 2: Delete whitelist_current_ip function**

Delete the entire `whitelist_current_ip()` function (lines 234-264).

**Step 3: Update start_bastion_if_needed to use Lambda for whitelisting**

Replace the `start_bastion_if_needed` function (lines 266-311) with:

```bash
# Start bastion if not running, wait for it to be ready
start_bastion_if_needed() {
    echo -e "${YELLOW}Checking bastion status...${NC}"

    # Detect IP once for whitelisting
    local my_ip=$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null)
    local ip_payload=""
    if [[ -n "$my_ip" ]]; then
        ip_payload="\"ip\":\"$my_ip\""
        echo -e "${GREEN}Detected IP: $my_ip${NC}"
    else
        echo -e "${YELLOW}Warning: Could not detect public IP${NC}"
    fi

    local status_json=$(invoke_bastion "status")
    local current_state=$(echo "$status_json" | jq -r '.status // "unknown"')

    if [[ "$current_state" == "running" ]]; then
        BASTION_IP=$(echo "$status_json" | jq -r '.instances[0].public_ip // empty')
        if [[ -n "$BASTION_IP" ]]; then
            echo -e "${GREEN}Bastion already running at $BASTION_IP${NC}"
            # Whitelist via Lambda (not direct EC2 API)
            if [[ -n "$ip_payload" ]]; then
                invoke_bastion "whitelist" "$ip_payload" > /dev/null
                echo -e "${GREEN}IP whitelisted via Lambda${NC}"
            fi
            return 0
        fi
    fi

    echo -e "${YELLOW}Starting bastion (this takes ~60-90 seconds)...${NC}"
    invoke_bastion "start" "$ip_payload" > /dev/null
    BASTION_STARTED=true

    # Poll for bastion to be ready
    local max_attempts=18  # 90 seconds
    local attempt=0

    while [[ $attempt -lt $max_attempts ]]; do
        sleep 5
        ((attempt++))

        status_json=$(invoke_bastion "status")
        current_state=$(echo "$status_json" | jq -r '.status // "unknown"')

        if [[ "$current_state" == "running" ]]; then
            BASTION_IP=$(echo "$status_json" | jq -r '.instances[0].public_ip // empty')
            if [[ -n "$BASTION_IP" ]]; then
                echo -e "${GREEN}Bastion ready at $BASTION_IP${NC}"
                return 0
            fi
        fi

        echo -e "${YELLOW}  Waiting for bastion... ($((attempt * 5))s)${NC}"
    done

    echo -e "${RED}Bastion failed to start within 90 seconds${NC}"
    exit 1
}
```

**Step 4: Add retry logic to start_ssh_tunnel**

Replace the `start_ssh_tunnel` function (lines 313-356) with:

```bash
# Start SSH tunnel to RDS (with retries for sshd startup race)
start_ssh_tunnel() {
    if [[ -z "$BASTION_IP" ]]; then
        echo -e "${RED}Bastion IP not set - cannot start SSH tunnel${NC}"
        exit 1
    fi

    echo -e "${YELLOW}Starting SSH tunnel to RDS...${NC}"

    # Extract RDS host from database-url secret (strip port if present)
    local rds_host=$(aws secretsmanager get-secret-value --secret-id "workermill/dev/database-url" --query 'SecretString' --output text --region "$AWS_REGION" 2>/dev/null | grep -o '@[^:/]*' | tr -d '@')

    if [[ -z "$rds_host" ]]; then
        echo -e "${RED}Failed to get RDS endpoint from secrets${NC}"
        exit 1
    fi

    # Retry loop: sshd may not be ready on freshly-booted spot instances
    local max_retries=3
    local retry=0

    while [[ $retry -lt $max_retries ]]; do
        ((retry++))

        # Start SSH tunnel in background
        ssh -f -N -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
            -i ~/.ssh/workermill-bastion \
            -L 5432:${rds_host}:5432 \
            ec2-user@${BASTION_IP} 2>/dev/null

        # Give it a moment to establish
        sleep 2

        # Find the SSH tunnel PID
        SSH_TUNNEL_PID=$(pgrep -f "ssh.*-L 5432.*${BASTION_IP}" | head -1)

        if [[ -n "$SSH_TUNNEL_PID" ]]; then
            # Verify tunnel is working
            if command -v nc &> /dev/null && nc -z localhost 5432 2>/dev/null; then
                echo -e "${GREEN}SSH tunnel established (PID: $SSH_TUNNEL_PID)${NC}"
                return 0
            fi
        fi

        if [[ $retry -lt $max_retries ]]; then
            echo -e "${YELLOW}  SSH tunnel attempt $retry/$max_retries failed, retrying in 5s...${NC}"
            # Kill any partial tunnel
            [[ -n "$SSH_TUNNEL_PID" ]] && kill "$SSH_TUNNEL_PID" 2>/dev/null || true
            SSH_TUNNEL_PID=""
            sleep 5
        fi
    done

    echo -e "${RED}Failed to establish SSH tunnel after $max_retries attempts${NC}"
    exit 1
}
```

**Step 5: Remove jq from bastion dependency check**

The `check_bastion_dependencies` function (lines 197-221) checks for `jq`, but `invoke_bastion` already uses jq internally. Since we're using `invoke_bastion` for whitelisting now (which returns JSON we parse with jq), jq is still needed. Keep it as-is.

**Step 6: Commit**

```bash
git add deploy.sh
git commit -m "fix(bastion): use Lambda for whitelisting, add SSH retries

- Delete whitelist_current_ip() which bypassed Lambda and created stale SG rules
- start_bastion_if_needed passes IP to Lambda start/whitelist actions
- start_ssh_tunnel retries 3 times with 5s gaps for sshd startup race
- invoke_bastion accepts optional extra payload for IP parameter"
```

---

### Task 5: Terraform plan and review

**Step 1: Run terraform plan (full, not targeted)**

```bash
cd infrastructure/terraform/environments/prod
terraform plan -no-color 2>&1 | tee /tmp/bastion-plan.txt
```

**Step 2: Verify expected changes**

Expected changes:
- `module.bastion[0].aws_autoscaling_group.bastion` — lifecycle change (may show as no-op since it's metadata)
- `module.bastion[0].aws_lambda_function.bastion_control` — updated source code
- `module.bastion[0].aws_iam_role_policy.bastion_lambda` — new CloudWatch statement
- 3 new resources: `aws_cloudwatch_event_rule.bastion_idle_check`, `aws_cloudwatch_event_target.bastion_idle_check`, `aws_lambda_permission.bastion_idle_check`
- Launch template AMI updates (expected — `most_recent = true`)

Unexpected changes to watch for:
- RDS security group changes (should be none if we're doing a full apply)
- Any destroy operations (there should be zero)

**Step 3: Get user approval before applying**

Show the plan output and wait for explicit "apply" approval.

---

### Task 6: Terraform apply

**Step 1: Apply the changes**

```bash
cd infrastructure/terraform/environments/prod
terraform apply -no-color
```

Type `yes` when prompted.

**Step 2: Verify zero drift**

```bash
terraform plan -no-color
```

Expected: `No changes. Your infrastructure matches the configuration.` (except the known ECS task definition drift from deploy.sh).

**Step 3: Commit**

No code changes here — just verification.

---

### Task 7: Test the full bastion lifecycle

**Step 1: Stop the currently running bastion**

```bash
/home/user/github/workermill/bin/bastion stop
```

**Step 2: Verify it stopped**

```bash
sleep 10
/home/user/github/workermill/bin/bastion status
```

Expected: `{"status": "stopped", ...}`

**Step 3: Start the bastion**

```bash
/home/user/github/workermill/bin/bastion start
```

Wait ~60s, then check status:

```bash
/home/user/github/workermill/bin/bastion status
```

Expected: `{"status": "running", ...}` with exactly 1 whitelisted CIDR (the caller's IP).

**Step 4: Verify auto-stop fires after idle period**

After confirming the bastion starts correctly, leave it running. Check Lambda logs after ~25 minutes to verify the `auto_stop_check` action detected idle and stopped it:

```bash
MSYS_NO_PATHCONV=1 aws logs tail "/aws/lambda/workermill-dev-bastion-control" --follow --region us-east-1
```

Expected: Log entries showing `auto_stop_check` invocations, eventually one with `stopped_idle` status.

**Step 5: Test deploy.sh integration**

```bash
./deploy.sh --check-migrations
```

This should: start bastion, whitelist IP via Lambda, SSH tunnel with retries, check migrations, stop bastion. No errors.
