# Orchestrator Task Definition — same image, ENABLE_ORCHESTRATOR=true, no ALB
resource "aws_ecs_task_definition" "orchestrator" {
  family                   = "workermill-${var.environment}-orchestrator"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.api_image_digest != "" ? "${var.ecr_api_repository_url}@${var.api_image_digest}" : "${var.ecr_api_repository_url}:latest"
      essential = true

      # No port mappings — orchestrator receives no inbound traffic
      portMappings = []

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "ENVIRONMENT", value = var.environment },
        { name = "PORT", value = "3000" },
        { name = "AWS_REGION", value = data.aws_region.current.name },
        { name = "ENABLE_ORCHESTRATOR", value = "true" },
        { name = "ECS_CLUSTER", value = var.ecs_cluster_name },
        { name = "WORKER_TASK_DEFINITION", value = var.worker_task_definition },
        { name = "PRIVATE_SUBNETS", value = join(",", var.private_subnet_ids) },
        { name = "SECURITY_GROUPS", value = var.ecs_tasks_security_group_id },
        { name = "WORKER_LOG_GROUP", value = var.worker_log_group },
        { name = "RUNNER_TASK_DEFINITION", value = var.runner_task_definition },
        { name = "RUNNER_SECURITY_GROUP", value = var.runner_security_group },
        { name = "API_BASE_URL", value = "https://${var.domain_name}" },
        { name = "CORS_ORIGINS", value = "http://localhost:5173,https://${var.domain_name}" },
        { name = "COGNITO_USER_POOL_ID", value = var.cognito_user_pool_id },
        { name = "COGNITO_CLIENT_ID", value = var.cognito_client_id },
        { name = "COGNITO_DOMAIN", value = var.cognito_domain },
        { name = "SES_SOURCE_EMAIL", value = var.ses_source_email },
        { name = "SUPPORT_AGENT_ENABLED", value = var.support_agent_enabled },
        { name = "SENTRY_DSN", value = var.sentry_dsn },
        { name = "REDIS_URL", value = var.redis_url },
        # PgBouncer sidecar
        { name = "PGBOUNCER_HOST", value = "127.0.0.1" },
        { name = "PGBOUNCER_PORT", value = "5432" },
        { name = "DB_POOL_MAX", value = "15" },
      ]

      secrets = concat([
        { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
        { name = "ANTHROPIC_API_KEY", valueFrom = var.anthropic_api_key_secret_arn },
        { name = "GITHUB_TOKEN", valueFrom = var.github_token_secret_arn },
        { name = "JWT_SECRET", valueFrom = var.jwt_secret_arn },
        { name = "SESSION_SECRET", valueFrom = var.session_secret_arn },
        { name = "JIRA_CREDENTIALS", valueFrom = var.jira_credentials_secret_arn },
        { name = "STRIPE_SECRET_KEY", valueFrom = var.stripe_secret_key_arn },
        { name = "STRIPE_WEBHOOK_SECRET", valueFrom = var.stripe_webhook_secret_arn },
        { name = "PLATFORM_API_KEY", valueFrom = var.platform_api_key_secret_arn },
        { name = "ENCRYPTION_KEY", valueFrom = var.encryption_key_secret_arn }
        ],
        var.microsoft_client_id_secret_arn != "" ? [{ name = "MICROSOFT_CLIENT_ID", valueFrom = var.microsoft_client_id_secret_arn }] : [],
        var.microsoft_client_secret_secret_arn != "" ? [{ name = "MICROSOFT_CLIENT_SECRET", valueFrom = var.microsoft_client_secret_secret_arn }] : [],
        var.github_client_id_secret_arn != "" ? [{ name = "GITHUB_CLIENT_ID", valueFrom = var.github_client_id_secret_arn }] : [],
        var.github_client_secret_secret_arn != "" ? [{ name = "GITHUB_CLIENT_SECRET", valueFrom = var.github_client_secret_secret_arn }] : [],
        var.admin_phone_number_secret_arn != "" ? [{ name = "ADMIN_PHONE_NUMBER", valueFrom = var.admin_phone_number_secret_arn }] : [],
        var.admin_email_secret_arn != "" ? [{ name = "ADMIN_EMAIL", valueFrom = var.admin_email_secret_arn }] : [],
        var.github_runner_webhook_secret_arn != "" ? [{ name = "GITHUB_RUNNER_WEBHOOK_SECRET", valueFrom = var.github_runner_webhook_secret_arn }] : []
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "orchestrator"
        }
      }

      dependsOn = [
        {
          containerName = "pgbouncer"
          condition     = "START"
        }
      ]
    },
    {
      name      = "pgbouncer"
      image     = "edoburu/pgbouncer:1.22.0"
      essential = true
      portMappings = []

      environment = [
        { name = "POOL_MODE", value = "transaction" },
        { name = "DEFAULT_POOL_SIZE", value = "8" },
        { name = "MAX_CLIENT_CONN", value = "50" },
        { name = "SERVER_IDLE_TIMEOUT", value = "30" },
        { name = "SERVER_LIFETIME", value = "3600" },
        { name = "AUTH_TYPE", value = "plain" },
        { name = "LISTEN_ADDR", value = "127.0.0.1" },
        { name = "LISTEN_PORT", value = "5432" },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "orchestrator-pgbouncer"
        }
      }

      cpu    = 64
      memory = 128
    }
  ])
}

# Orchestrator ECS Service — singleton, no ALB, Fargate Spot
resource "aws_ecs_service" "orchestrator" {
  name            = "workermill-${var.environment}-orchestrator"
  cluster         = var.ecs_cluster_id
  task_definition = aws_ecs_task_definition.orchestrator.arn
  desired_count   = 1

  enable_execute_command = true

  # Use Fargate Spot for cost optimization — orchestrator restarts are safe
  # because tasks are claimed atomically (UPDATE...WHERE status = 'queued')
  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_tasks_security_group_id]
    assign_public_ip = false
  }

  # No load_balancer block — orchestrator receives no inbound traffic

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}
