# =============================================================================
# ECS Worker Task Definition
# Task definition for AI worker containers (spawned on-demand by orchestrator)
# =============================================================================

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# CloudWatch Log Group for Workers
resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/workermill-${var.environment}/worker"
  retention_in_days = 14

  tags = {
    Name        = "workermill-${var.environment}-worker"
    Environment = var.environment
  }
}

# Worker Task Definition
# Note: Credentials (ANTHROPIC_API_KEY, GITHUB_TOKEN) are passed as
# environment variable overrides when the orchestrator spawns tasks
resource "aws_ecs_task_definition" "worker" {
  family                   = "workermill-${var.environment}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "2048"  # 2 vCPU for Claude Code
  memory                   = "4096"  # 4 GB RAM
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${var.ecr_worker_repository_url}:latest"
      essential = true

      # No port mappings - workers don't expose any ports
      portMappings = []

      # Base environment - credentials injected at runtime by orchestrator
      # NOTE: NODE_ENV=development ensures npm installs devDependencies when
      # workers run `npm install` in target repositories (for builds/tests)
      environment = [
        { name = "NODE_ENV", value = "development" },
        { name = "AWS_REGION", value = data.aws_region.current.name }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "worker"
        }
      }

      # Increase ulimits for Claude Code
      ulimits = [
        {
          name      = "nofile"
          softLimit = 65536
          hardLimit = 65536
        }
      ]
    }
  ])

  tags = {
    Name        = "workermill-${var.environment}-worker"
    Environment = var.environment
  }
}
