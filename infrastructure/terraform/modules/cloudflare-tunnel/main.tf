data "aws_region" "current" {}

# =============================================================================
# CloudWatch Log Group
# =============================================================================
resource "aws_cloudwatch_log_group" "cloudflared" {
  name              = "/ecs/workermill-${var.environment}/cloudflared"
  retention_in_days = 14

  tags = {
    Name = "workermill-${var.environment}-cloudflared"
  }
}

# =============================================================================
# Security Group
# Cloudflared only needs outbound access - it creates outbound-only connections
# to Cloudflare's edge network. No inbound rules needed.
# =============================================================================
resource "aws_security_group" "cloudflared" {
  name        = "workermill-${var.environment}-cloudflared"
  description = "Security group for Cloudflare Tunnel connector"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound traffic (Cloudflare edge + VPC resources)"
  }

  tags = {
    Name = "workermill-${var.environment}-cloudflared"
  }
}

# =============================================================================
# ECS Task Definition
# Runs cloudflare/cloudflared as a tunnel connector. The TUNNEL_TOKEN env var
# is read natively by cloudflared to authenticate with Cloudflare's edge.
# =============================================================================
resource "aws_ecs_task_definition" "cloudflared" {
  family                   = "workermill-${var.environment}-cloudflared"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = var.execution_role_arn

  container_definitions = jsonencode([
    {
      name      = "cloudflared"
      image     = "cloudflare/cloudflared:latest"
      essential = true
      command   = ["tunnel", "--no-autoupdate", "run"]

      secrets = [
        {
          name      = "TUNNEL_TOKEN"
          valueFrom = var.tunnel_token_secret_arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.cloudflared.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "cloudflared"
        }
      }
    }
  ])

  tags = {
    Name = "workermill-${var.environment}-cloudflared"
  }
}

# =============================================================================
# ECS Service
# Runs exactly 1 cloudflared connector. Uses standard FARGATE (not Spot)
# because this is always-on infrastructure - Spot interruptions would drop
# the tunnel and disconnect VPN clients.
# =============================================================================
resource "aws_ecs_service" "cloudflared" {
  name            = "workermill-${var.environment}-cloudflared"
  cluster         = var.ecs_cluster_id
  task_definition = aws_ecs_task_definition.cloudflared.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.cloudflared.id]
    assign_public_ip = false
  }

  tags = {
    Name = "workermill-${var.environment}-cloudflared"
  }
}
