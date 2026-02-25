data "aws_region" "current" {}

# ALB Security Group
resource "aws_security_group" "alb" {
  name        = "workermill-${var.environment}-alb"
  description = "Security group for ALB"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "workermill-${var.environment}-alb"
  }
}

# Allow ALB to reach ECS tasks
resource "aws_security_group_rule" "ecs_from_alb" {
  type                     = "ingress"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  security_group_id        = var.ecs_tasks_security_group_id
  source_security_group_id = aws_security_group.alb.id
  description              = "API from ALB"
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "workermill-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = true

  tags = {
    Name = "workermill-${var.environment}"
  }
}

# Target Group for API
resource "aws_lb_target_group" "api" {
  name        = "workermill-${var.environment}-api"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = {
    Name = "workermill-${var.environment}-api"
  }
}

# HTTP Listener (redirects to HTTPS)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# HTTPS Listener
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# API Task Definition
resource "aws_ecs_task_definition" "api" {
  family                   = "workermill-${var.environment}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.api_image_digest != "" ? "${var.ecr_api_repository_url}@${var.api_image_digest}" : "${var.ecr_api_repository_url}:latest"
      essential = true

      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "ENVIRONMENT", value = var.environment },
        { name = "PORT", value = "3000" },
        { name = "AWS_REGION", value = data.aws_region.current.name },
        { name = "ENABLE_ORCHESTRATOR", value = "false" },
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
        { name = "PGBOUNCER_HOST", value = "127.0.0.1" },
        { name = "PGBOUNCER_PORT", value = "5432" },
        { name = "DB_POOL_MAX", value = "20" }
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
        # Microsoft SSO secrets (optional)
        var.microsoft_client_id_secret_arn != "" ? [{ name = "MICROSOFT_CLIENT_ID", valueFrom = var.microsoft_client_id_secret_arn }] : [],
        var.microsoft_client_secret_secret_arn != "" ? [{ name = "MICROSOFT_CLIENT_SECRET", valueFrom = var.microsoft_client_secret_secret_arn }] : [],
        # GitHub SSO secrets (optional)
        var.github_client_id_secret_arn != "" ? [{ name = "GITHUB_CLIENT_ID", valueFrom = var.github_client_id_secret_arn }] : [],
        var.github_client_secret_secret_arn != "" ? [{ name = "GITHUB_CLIENT_SECRET", valueFrom = var.github_client_secret_secret_arn }] : [],
        # Admin notification secrets (optional)
        var.admin_phone_number_secret_arn != "" ? [{ name = "ADMIN_PHONE_NUMBER", valueFrom = var.admin_phone_number_secret_arn }] : [],
        var.admin_email_secret_arn != "" ? [{ name = "ADMIN_EMAIL", valueFrom = var.admin_email_secret_arn }] : [],
        # GitHub runner webhook secret (optional)
        var.github_runner_webhook_secret_arn != "" ? [{ name = "GITHUB_RUNNER_WEBHOOK_SECRET", valueFrom = var.github_runner_webhook_secret_arn }] : []
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "api"
        }
      }

      dependsOn = [
        { containerName = "pgbouncer", condition = "START" }
      ]
    },
    {
      name      = "pgbouncer"
      image     = var.pgbouncer_image
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
        { name = "LISTEN_PORT", value = "5432" }
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "pgbouncer"
        }
      }

      cpu    = 64
      memory = 128
    }
  ])
}

# ECS Service for API
resource "aws_ecs_service" "api" {
  name            = "workermill-${var.environment}-api"
  cluster         = var.ecs_cluster_id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 2

  enable_execute_command = true

  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    base              = 1
    weight            = 0
  }

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_tasks_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.https]

  lifecycle {
    ignore_changes = [desired_count]
  }
}
