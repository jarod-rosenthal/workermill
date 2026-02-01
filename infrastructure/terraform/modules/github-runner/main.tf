# =============================================================================
# Self-Hosted GitHub Actions Runner
# =============================================================================
#
# Creates an EC2 instance in a private subnet that runs as a GitHub Actions
# self-hosted runner. This provides:
# - Direct VPC access to RDS for integration tests
# - Predictable costs (~$10-15/month) vs pay-per-use alternatives
# - Familiar GitHub Actions workflow syntax
#
# The runner auto-registers with GitHub on first boot and maintains connection.
# =============================================================================

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# Latest Amazon Linux 2023 AMI
data "aws_ami" "amazon_linux_2023" {
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

# =============================================================================
# Security Group
# =============================================================================
resource "aws_security_group" "runner" {
  name        = "workermill-${var.environment}-github-runner"
  description = "Security group for GitHub Actions self-hosted runner"
  vpc_id      = var.vpc_id

  # Allow all outbound traffic (GitHub API, npm, Docker Hub, etc.)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  # Allow SSH from within VPC only (for debugging via SSM or bastion)
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "SSH from VPC"
  }

  tags = {
    Name = "workermill-${var.environment}-github-runner"
  }
}

# =============================================================================
# IAM Role for EC2 Instance
# =============================================================================
resource "aws_iam_role" "runner" {
  name = "workermill-${var.environment}-github-runner"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "workermill-${var.environment}-github-runner"
  }
}

# SSM access for debugging and parameter retrieval
resource "aws_iam_role_policy" "runner_ssm" {
  name = "ssm-access"
  role = aws_iam_role.runner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = [
          "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/workermill/${var.environment}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2messages:GetMessages",
          "ec2messages:AcknowledgeMessage",
          "ec2messages:SendReply"
        ]
        Resource = "*"
      }
    ]
  })
}

# CloudWatch Logs access for runner logs
resource "aws_iam_role_policy" "runner_logs" {
  name = "cloudwatch-logs"
  role = aws_iam_role.runner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = [
          "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/github-runner/*"
        ]
      }
    ]
  })
}

# Attach SSM managed policy for Session Manager
resource "aws_iam_role_policy_attachment" "runner_ssm_managed" {
  role       = aws_iam_role.runner.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "runner" {
  name = "workermill-${var.environment}-github-runner"
  role = aws_iam_role.runner.name
}

# =============================================================================
# EC2 Instance
# =============================================================================
resource "aws_instance" "runner" {
  ami                    = data.aws_ami.amazon_linux_2023.id
  instance_type          = var.instance_type
  subnet_id              = var.private_subnet_id
  vpc_security_group_ids = [aws_security_group.runner.id]
  iam_instance_profile   = aws_iam_instance_profile.runner.name

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  user_data = base64encode(templatefile("${path.module}/user-data.sh", {
    github_org           = var.github_org
    github_repo          = var.github_repo
    runner_name          = "workermill-${var.environment}"
    runner_labels        = join(",", var.runner_labels)
    runner_version       = var.runner_version
    ssm_token_param_name = "/workermill/${var.environment}/github-runner-token"
    aws_region           = data.aws_region.current.name
    node_version         = var.node_version
  }))

  tags = {
    Name        = "workermill-${var.environment}-github-runner"
    Environment = var.environment
    Purpose     = "GitHub Actions self-hosted runner"
  }

  lifecycle {
    # Ignore changes to AMI (managed separately) and user_data (requires replacement)
    ignore_changes = [ami]
  }
}

# =============================================================================
# CloudWatch Log Group for Runner Logs
# =============================================================================
resource "aws_cloudwatch_log_group" "runner" {
  name              = "/github-runner/workermill-${var.environment}"
  retention_in_days = 14

  tags = {
    Name        = "workermill-${var.environment}-github-runner"
    Environment = var.environment
  }
}
