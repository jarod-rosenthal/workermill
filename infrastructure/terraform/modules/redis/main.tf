# ElastiCache Redis for coordination pub/sub
# Single-node cache.t4g.micro (~$12/month) with encryption

resource "aws_elasticache_subnet_group" "main" {
  name       = "workermill-${var.environment}-redis"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "workermill-${var.environment}-redis"
  }
}

resource "aws_security_group" "redis" {
  name        = "workermill-${var.environment}-redis"
  description = "Security group for ElastiCache Redis"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.api_security_group_id]
    description     = "Redis from API tasks"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "workermill-${var.environment}-redis"
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "workermill-${var.environment}"
  description          = "WorkerMill coordination pub/sub and cache"

  node_type            = "cache.t4g.micro"
  num_cache_clusters   = 1
  engine               = "redis"
  engine_version       = "7.0"
  port                 = 6379
  parameter_group_name = "default.redis7"

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  # Single node — no failover
  automatic_failover_enabled = false
  multi_az_enabled           = false

  # Maintenance window (Sunday 4-5 AM UTC)
  maintenance_window = "sun:04:00-sun:05:00"

  tags = {
    Name = "workermill-${var.environment}-redis"
  }
}
