# =============================================================================
# Ephemeral GitHub Actions Runner on ECS Fargate
# =============================================================================
#
# Infrastructure for running GitHub Actions self-hosted runners on-demand.
# Runners are ephemeral - they spin up per workflow job, run it, then exit.
#
# Flow:
# 1. GitHub sends workflow_job webhook to WorkerMill API (/api/webhooks/github-runner)
# 2. API receives webhook, validates it, gets a JIT runner token
# 3. API starts ECS Fargate task with the token
# 4. Runner registers with GitHub, runs the job, exits
# 5. ECS task terminates (ephemeral mode auto-deregisters)
#
# Cost: ~$0.01-0.02 per test run (Fargate Spot pricing)
# =============================================================================

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# =============================================================================
# ECS Task Definition for GitHub Runner
# =============================================================================
resource "aws_ecs_task_definition" "runner" {
  family                   = "workermill-${var.environment}-github-runner"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.runner_cpu
  memory                   = var.runner_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "runner"
      image     = "ghcr.io/actions/actions-runner:latest"
      essential = true

      environment = [
        { name = "RUNNER_NAME", value = "workermill-${var.environment}-ecs" },
        { name = "RUNNER_LABELS", value = join(",", var.runner_labels) },
        { name = "RUNNER_SCOPE", value = "repo" },
        { name = "REPO_URL", value = "https://github.com/${var.github_owner}/${var.github_repo}" },
        { name = "EPHEMERAL", value = "true" },
        { name = "DISABLE_AUTO_UPDATE", value = "true" },
      ]

      # RUNNER_TOKEN is passed at runtime via container overrides
      secrets = []

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.runner.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "runner"
        }
      }

      # Entry point script that configures and runs the runner
      entryPoint = ["/bin/bash", "-c"]
      command = [
        <<-EOT
        set -e
        cd /home/runner

        # Configure the runner with the JIT token passed via environment
        ./config.sh \
          --url "$REPO_URL" \
          --token "$RUNNER_TOKEN" \
          --name "$RUNNER_NAME-$(hostname)" \
          --labels "$RUNNER_LABELS" \
          --ephemeral \
          --unattended \
          --replace

        # Run the runner (will exit after one job due to --ephemeral)
        ./run.sh
        EOT
      ]
    }
  ])

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  tags = {
    Name = "workermill-${var.environment}-github-runner"
  }
}

# =============================================================================
# CloudWatch Log Group
# =============================================================================
resource "aws_cloudwatch_log_group" "runner" {
  name              = "/ecs/workermill-${var.environment}/github-runner"
  retention_in_days = 7

  tags = {
    Name = "workermill-${var.environment}-github-runner"
  }
}

# =============================================================================
# Security Group for Runner Tasks
# =============================================================================
resource "aws_security_group" "runner" {
  name        = "workermill-${var.environment}-github-runner"
  description = "Security group for GitHub Actions runner ECS tasks"
  vpc_id      = var.vpc_id

  # Allow all outbound (GitHub API, npm, Docker Hub, etc.)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  tags = {
    Name = "workermill-${var.environment}-github-runner"
  }
}

# =============================================================================
# IAM Role - Task Execution (for ECS to pull images, write logs)
# =============================================================================
resource "aws_iam_role" "execution" {
  name = "workermill-${var.environment}-runner-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "secrets-access"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = ["arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:workermill/${var.environment}/*"]
    }]
  })
}

# =============================================================================
# IAM Role - Task Role (for the runner container itself)
# =============================================================================
resource "aws_iam_role" "task" {
  name = "workermill-${var.environment}-runner-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "task" {
  name = "runner-task-policy"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = ["${aws_cloudwatch_log_group.runner.arn}:*"]
      },
      {
        Effect = "Allow"
        Action = ["ssmmessages:*"]
        Resource = "*"
      }
    ]
  })
}
