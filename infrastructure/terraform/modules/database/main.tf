# RDS Security Group
resource "aws_security_group" "rds" {
  name        = "workermill-${var.environment}-rds"
  description = "Security group for RDS"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.allowed_security_group_id]
    description     = "PostgreSQL from ECS tasks"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "workermill-${var.environment}-rds"
  }
}

# DB Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "workermill-${var.environment}"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "workermill-${var.environment}"
  }
}

# Generate random password for RDS
resource "random_password" "rds" {
  length  = 32
  special = false
}

# RDS Instance - Cheapest configuration
resource "aws_db_instance" "main" {
  identifier = "workermill-${var.environment}"

  # Cheapest options
  instance_class        = "db.t4g.micro"
  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"

  # PostgreSQL
  engine         = "postgres"
  engine_version = "16.8"

  # Credentials
  db_name  = "workermill"
  username = "workermill"
  password = random_password.rds.result

  # Network - Single AZ (cheapest)
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  # Backup - minimal
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  # Other settings
  skip_final_snapshot       = false
  final_snapshot_identifier = "workermill-${var.environment}-final"
  deletion_protection       = true
  copy_tags_to_snapshot     = true

  # Performance Insights disabled (cost)
  performance_insights_enabled = false

  tags = {
    Name = "workermill-${var.environment}"
  }
}
