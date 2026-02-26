# =============================================================================
# Bastion Host with Spot Instance (Multi-AZ, Multi-Instance-Type Fallback)
# =============================================================================
# Uses an ASG with mixed instances policy for spot availability.
# Lambda controls start/stop by setting desired_capacity to 1 or 0.
# =============================================================================

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# -----------------------------------------------------------------------------
# Security Group
# -----------------------------------------------------------------------------
resource "aws_security_group" "bastion" {
  name        = "workermill-${var.environment}-bastion"
  description = "Security group for bastion host"
  vpc_id      = var.vpc_id

  # SSH access from allowed CIDRs
  dynamic "ingress" {
    for_each = length(var.allowed_ssh_cidrs) > 0 ? [1] : []
    content {
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.allowed_ssh_cidrs
      description = "SSH from allowed CIDRs"
    }
  }

  # PostgreSQL to RDS (required for SSH tunneling)
  egress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "PostgreSQL to RDS in VPC"
  }

  # HTTPS for package updates (dnf, etc.)
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS for package updates"
  }

  # DNS resolution
  egress {
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = [var.vpc_cidr]
    description = "DNS resolution in VPC"
  }

  tags = {
    Name = "workermill-${var.environment}-bastion"
  }
}

# -----------------------------------------------------------------------------
# Latest Amazon Linux 2023 AMI (ARM64 for t4g instances)
# -----------------------------------------------------------------------------
data "aws_ami" "amazon_linux_2023_arm" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Fallback: x86_64 AMI for t3/t3a instances
data "aws_ami" "amazon_linux_2023_x86" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# -----------------------------------------------------------------------------
# User Data Script (SSH key + dev tools)
# -----------------------------------------------------------------------------
locals {
  user_data = <<-EOF
#!/bin/bash
set -ex

# Add SSH public key
mkdir -p /home/ec2-user/.ssh
echo "${var.ssh_public_key}" >> /home/ec2-user/.ssh/authorized_keys
chmod 700 /home/ec2-user/.ssh
chmod 600 /home/ec2-user/.ssh/authorized_keys
chown -R ec2-user:ec2-user /home/ec2-user/.ssh

# Install development tools (--allowerasing handles curl-minimal conflict)
dnf install -y --allowerasing \
  postgresql16 \
  git \
  jq \
  htop \
  tmux \
  vim \
  wget \
  unzip \
  tar \
  nc

# Node.js is optional - skip if it fails
dnf install -y nodejs || true

# Configure PostgreSQL client
cat > /home/ec2-user/.pgpass << 'PGPASS'
# hostname:port:database:username:password
# Fill in after connecting: chmod 600 ~/.pgpass
PGPASS
chmod 600 /home/ec2-user/.pgpass
chown ec2-user:ec2-user /home/ec2-user/.pgpass

# Helpful aliases
cat >> /home/ec2-user/.bashrc << 'BASHRC'

# Bastion aliases
alias ll='ls -la'
alias psql-workermill='psql -h ${var.rds_endpoint} -U workermill -d workermill'
BASHRC

echo "Bastion setup complete"
EOF
}

# -----------------------------------------------------------------------------
# Launch Templates (ARM64 and x86_64 for instance type compatibility)
# -----------------------------------------------------------------------------
# NOTE: Spot configuration is handled by the ASG mixed_instances_policy,
# NOT in the launch template. AWS doesn't allow both.
resource "aws_launch_template" "bastion_arm" {
  name_prefix = "workermill-${var.environment}-bastion-arm-"
  image_id    = data.aws_ami.amazon_linux_2023_arm.id

  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.bastion.id]
    delete_on_termination       = true
  }

  # Require IMDSv2 (more secure metadata service)
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  user_data = base64encode(local.user_data)

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "workermill-${var.environment}-bastion"
    }
  }

  tags = {
    Name = "workermill-${var.environment}-bastion-arm"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_launch_template" "bastion_x86" {
  name_prefix = "workermill-${var.environment}-bastion-x86-"
  image_id    = data.aws_ami.amazon_linux_2023_x86.id

  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.bastion.id]
    delete_on_termination       = true
  }

  # Require IMDSv2 (more secure metadata service)
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  user_data = base64encode(local.user_data)

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "workermill-${var.environment}-bastion"
    }
  }

  tags = {
    Name = "workermill-${var.environment}-bastion-x86"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Auto Scaling Group with Mixed Instances Policy
# -----------------------------------------------------------------------------
locals {
  # Separate ARM and x86 instance types
  arm_instance_types = [for t in var.instance_types : t if can(regex("^t4g\\.", t))]
  x86_instance_types = [for t in var.instance_types : t if !can(regex("^t4g\\.", t))]
}

resource "aws_autoscaling_group" "bastion" {
  name                = "workermill-${var.environment}-bastion"
  vpc_zone_identifier = var.public_subnet_ids
  min_size            = 0
  max_size            = 1
  desired_capacity    = 0 # Starts stopped, Lambda turns it on

  # Use ARM launch template as primary (cheapest)
  mixed_instances_policy {
    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.bastion_arm.id
        version            = "$Latest"
      }

      # ARM instance type overrides (t4g.*)
      dynamic "override" {
        for_each = local.arm_instance_types
        content {
          instance_type = override.value
        }
      }
    }

    instances_distribution {
      on_demand_base_capacity                  = var.use_spot ? 0 : 1
      on_demand_percentage_above_base_capacity = var.use_spot ? 0 : 100
      spot_allocation_strategy                 = "price-capacity-optimized"
    }
  }

  # Health check
  health_check_type         = "EC2"
  health_check_grace_period = 60

  # Tags
  tag {
    key                 = "Name"
    value               = "workermill-${var.environment}-bastion"
    propagate_at_launch = true
  }

  tag {
    key                 = "Environment"
    value               = var.environment
    propagate_at_launch = true
  }

  lifecycle {
    create_before_destroy = true
    ignore_changes        = [desired_capacity]
  }
}

# -----------------------------------------------------------------------------
# Lambda Function to Start/Stop Bastion
# -----------------------------------------------------------------------------
data "archive_file" "bastion_control" {
  type        = "zip"
  output_path = "${path.module}/lambda_bastion_control.zip"

  source {
    content  = <<-PYTHON
import boto3
import json
import os
import urllib.request
import ipaddress

def validate_ip(ip_string):
    """Validate that the string is a valid IPv4 or IPv6 address"""
    if not ip_string:
        return False
    try:
        ipaddress.ip_address(ip_string)
        return True
    except ValueError:
        return False

def get_my_ip():
    """Get caller's public IP using ifconfig.me"""
    try:
        req = urllib.request.Request('https://ifconfig.me/ip', headers={'User-Agent': 'curl/7.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.read().decode('utf-8').strip()
    except Exception as e:
        return None

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

def handler(event, context):
    """
    Start or stop the bastion host by adjusting ASG desired capacity.

    Event payload:
      {"action": "start"}              - Start with auto-detected IP
      {"action": "start", "ip": "x.x.x.x"} - Start with specified IP
      {"action": "stop"}               - Stop the bastion
      {"action": "status"}             - Get current status
      {"action": "whitelist", "ip": "x.x.x.x"} - Just update security group
    """
    asg_name = os.environ['ASG_NAME']
    sg_id = os.environ['SECURITY_GROUP_ID']
    rds_endpoint = os.environ.get('RDS_ENDPOINT', '<rds-endpoint>')

    asg = boto3.client('autoscaling')
    ec2 = boto3.client('ec2')

    action = event.get('action', 'status')

    if action == 'start':
        # Get IP to whitelist
        allowed_ip = event.get('ip')
        if allowed_ip and not validate_ip(allowed_ip):
            return {'status': 'error', 'message': f'Invalid IP address: {allowed_ip}'}
        if not allowed_ip:
            allowed_ip = get_my_ip()

        sg_result = None
        if allowed_ip and validate_ip(allowed_ip):
            try:
                sg_result = update_security_group(ec2, sg_id, allowed_ip)
            except Exception as e:
                sg_result = {'error': str(e)}

        asg.set_desired_capacity(
            AutoScalingGroupName=asg_name,
            DesiredCapacity=1
        )
        return {
            'status': 'starting',
            'message': 'Bastion is starting. Check status in ~60 seconds.',
            'whitelisted_ip': allowed_ip,
            'security_group_update': sg_result
        }

    elif action == 'whitelist':
        allowed_ip = event.get('ip')
        if allowed_ip and not validate_ip(allowed_ip):
            return {'status': 'error', 'message': f'Invalid IP address: {allowed_ip}'}
        if not allowed_ip:
            allowed_ip = get_my_ip()
        if not allowed_ip or not validate_ip(allowed_ip):
            return {'status': 'error', 'message': 'Could not determine valid IP. Pass "ip" parameter.'}

        try:
            sg_result = update_security_group(ec2, sg_id, allowed_ip)
            return {'status': 'success', 'whitelisted_ip': allowed_ip, 'security_group_update': sg_result}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    elif action == 'stop':
        asg.set_desired_capacity(
            AutoScalingGroupName=asg_name,
            DesiredCapacity=0
        )
        return {'status': 'stopping', 'message': 'Bastion is stopping.'}

    elif action == 'status':
        # Get ASG info
        response = asg.describe_auto_scaling_groups(AutoScalingGroupNames=[asg_name])
        if not response['AutoScalingGroups']:
            return {'status': 'error', 'message': 'ASG not found'}

        asg_info = response['AutoScalingGroups'][0]
        desired = asg_info['DesiredCapacity']
        instances = asg_info['Instances']

        # Get current whitelisted IPs
        sg = ec2.describe_security_groups(GroupIds=[sg_id])['SecurityGroups'][0]
        whitelisted = []
        for rule in sg.get('IpPermissions', []):
            if rule.get('FromPort') == 22:
                whitelisted = [r['CidrIp'] for r in rule.get('IpRanges', [])]

        if desired == 0:
            return {'status': 'stopped', 'desired_capacity': 0, 'instances': [], 'whitelisted_cidrs': whitelisted}

        if not instances:
            return {'status': 'starting', 'desired_capacity': desired, 'instances': [], 'whitelisted_cidrs': whitelisted}

        # Get instance details
        instance_ids = [i['InstanceId'] for i in instances]
        ec2_response = ec2.describe_instances(InstanceIds=instance_ids)

        instance_info = []
        for reservation in ec2_response['Reservations']:
            for instance in reservation['Instances']:
                instance_info.append({
                    'instance_id': instance['InstanceId'],
                    'state': instance['State']['Name'],
                    'public_ip': instance.get('PublicIpAddress', 'pending'),
                    'instance_type': instance['InstanceType'],
                    'availability_zone': instance['Placement']['AvailabilityZone']
                })

        running = [i for i in instance_info if i['state'] == 'running']
        if running:
            public_ip = running[0]['public_ip']
            return {
                'status': 'running',
                'desired_capacity': desired,
                'instances': instance_info,
                'whitelisted_cidrs': whitelisted,
                'ssh_command': f"ssh -L 5432:{rds_endpoint}:5432 ec2-user@{public_ip}",
                'local_db_url': f"postgresql://workermill:<password>@localhost:5432/workermill"
            }
        else:
            return {
                'status': 'starting',
                'desired_capacity': desired,
                'instances': instance_info,
                'whitelisted_cidrs': whitelisted
            }

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

    else:
        return {'status': 'error', 'message': f"Unknown action: {action}. Use 'start', 'stop', 'status', or 'whitelist'."}
PYTHON
    filename = "index.py"
  }
}

resource "aws_lambda_function" "bastion_control" {
  function_name    = "workermill-${var.environment}-bastion-control"
  role             = aws_iam_role.bastion_lambda.arn
  handler          = "index.handler"
  runtime          = "python3.12"
  timeout          = 30
  filename         = data.archive_file.bastion_control.output_path
  source_code_hash = data.archive_file.bastion_control.output_base64sha256

  environment {
    variables = {
      ASG_NAME          = aws_autoscaling_group.bastion.name
      SECURITY_GROUP_ID = aws_security_group.bastion.id
      RDS_ENDPOINT      = var.rds_endpoint
    }
  }

  tags = {
    Name = "workermill-${var.environment}-bastion-control"
  }
}

# -----------------------------------------------------------------------------
# IAM Role for Lambda
# -----------------------------------------------------------------------------
resource "aws_iam_role" "bastion_lambda" {
  name = "workermill-${var.environment}-bastion-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = {
    Name = "workermill-${var.environment}-bastion-lambda"
  }
}

resource "aws_iam_role_policy" "bastion_lambda" {
  name = "bastion-control"
  role = aws_iam_role.bastion_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AutoScalingControl"
        Effect = "Allow"
        Action = [
          "autoscaling:SetDesiredCapacity"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "autoscaling:ResourceTag/Name" = "workermill-${var.environment}-bastion"
          }
        }
      },
      {
        Sid    = "AutoScalingDescribe"
        Effect = "Allow"
        Action = [
          "autoscaling:DescribeAutoScalingGroups"
        ]
        Resource = "*"
      },
      {
        Sid    = "EC2Describe"
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeSecurityGroups"
        ]
        Resource = "*"
      },
      {
        Sid    = "CloudWatchMetrics"
        Effect = "Allow"
        Action = [
          "cloudwatch:GetMetricStatistics"
        ]
        Resource = "*"
      },
      {
        Sid    = "SecurityGroupModify"
        Effect = "Allow"
        Action = [
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupIngress"
        ]
        Resource = "arn:aws:ec2:${data.aws_region.current.name}:*:security-group/${aws_security_group.bastion.id}"
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = [
          "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/workermill-${var.environment}-bastion-control",
          "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/workermill-${var.environment}-bastion-control:*"
        ]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# CloudWatch Log Group for Lambda
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "bastion_lambda" {
  name              = "/aws/lambda/workermill-${var.environment}-bastion-control"
  retention_in_days = 7

  tags = {
    Name = "workermill-${var.environment}-bastion-control"
  }
}

# -----------------------------------------------------------------------------
# Optional: EventBridge Scheduled Start/Stop
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "bastion_start" {
  count               = var.enable_schedule && var.schedule_start != "" ? 1 : 0
  name                = "workermill-${var.environment}-bastion-start"
  description         = "Start bastion on schedule"
  schedule_expression = var.schedule_start

  tags = {
    Name = "workermill-${var.environment}-bastion-start"
  }
}

resource "aws_cloudwatch_event_target" "bastion_start" {
  count     = var.enable_schedule && var.schedule_start != "" ? 1 : 0
  rule      = aws_cloudwatch_event_rule.bastion_start[0].name
  target_id = "bastion-start"
  arn       = aws_lambda_function.bastion_control.arn
  input     = jsonencode({ action = "start" })
}

resource "aws_lambda_permission" "bastion_start" {
  count         = var.enable_schedule && var.schedule_start != "" ? 1 : 0
  statement_id  = "AllowEventBridgeStart"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.bastion_control.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.bastion_start[0].arn
}

resource "aws_cloudwatch_event_rule" "bastion_stop" {
  count               = var.enable_schedule && var.schedule_stop != "" ? 1 : 0
  name                = "workermill-${var.environment}-bastion-stop"
  description         = "Stop bastion on schedule"
  schedule_expression = var.schedule_stop

  tags = {
    Name = "workermill-${var.environment}-bastion-stop"
  }
}

resource "aws_cloudwatch_event_target" "bastion_stop" {
  count     = var.enable_schedule && var.schedule_stop != "" ? 1 : 0
  rule      = aws_cloudwatch_event_rule.bastion_stop[0].name
  target_id = "bastion-stop"
  arn       = aws_lambda_function.bastion_control.arn
  input     = jsonencode({ action = "stop" })
}

resource "aws_lambda_permission" "bastion_stop" {
  count         = var.enable_schedule && var.schedule_stop != "" ? 1 : 0
  statement_id  = "AllowEventBridgeStop"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.bastion_control.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.bastion_stop[0].arn
}

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
