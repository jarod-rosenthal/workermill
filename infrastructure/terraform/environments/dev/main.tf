# =============================================================================
# Development Environment
# =============================================================================
#
# This creates a completely isolated development environment accessible at
# dev.workermill.com. It uses a separate VPC, database, and ECS cluster.
#
# Resources are named workermill-sandbox-* to distinguish from production.
#
# =============================================================================

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "workermill"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# =============================================================================
# Data: Production Certificate
# =============================================================================
# The production certificate has *.workermill.com as a SAN, which covers
# dev.workermill.com. We reuse it to avoid certificate duplication.
data "aws_acm_certificate" "prod" {
  domain      = "workermill.com"
  statuses    = ["ISSUED"]
  most_recent = true
}

# =============================================================================
# Networking (separate VPC from production)
# =============================================================================
module "networking" {
  source             = "../../modules/networking"
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr                 # 10.2.0.0/16 - different from prod
  availability_zones = ["us-east-1a", "us-east-1b"] # Fewer AZs for cost savings
}

# =============================================================================
# DNS (uses parent hosted zone, reuses prod certificate)
# =============================================================================
module "dns" {
  source             = "../../modules/dns"
  environment        = var.environment
  domain_name        = var.domain_name  # dev.workermill.com
  hosted_zone_domain = "workermill.com" # Parent hosted zone
  create_certificate = false            # Reuse prod's *.workermill.com cert
  certificate_arn    = data.aws_acm_certificate.prod.arn
}

# =============================================================================
# ECR Repositories
# =============================================================================
module "ecr" {
  source      = "../../modules/ecr"
  environment = var.environment
}

# =============================================================================
# ECS Cluster
# =============================================================================
module "ecs_cluster" {
  source              = "../../modules/ecs-cluster"
  environment         = var.environment
  vpc_id              = module.networking.vpc_id
  secrets_arn_pattern = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:workermill/${var.environment}/*"
}

# =============================================================================
# Database
# =============================================================================
module "database" {
  source                    = "../../modules/database"
  environment               = var.environment
  vpc_id                    = module.networking.vpc_id
  private_subnet_ids        = module.networking.private_subnet_ids
  allowed_security_group_id = module.ecs_cluster.tasks_security_group_id
}

# =============================================================================
# Secrets
# =============================================================================
module "secrets" {
  source      = "../../modules/secrets"
  environment = var.environment
  db_host     = module.database.address
  db_port     = module.database.port
  db_name     = module.database.database_name
  db_username = module.database.username
  db_password = module.database.password
}

# =============================================================================
# ECS Worker (Task Definition for AI Workers)
# =============================================================================
module "ecs_worker" {
  source                    = "../../modules/ecs-worker"
  environment               = var.environment
  ecs_execution_role_arn    = module.ecs_cluster.execution_role_arn
  ecs_worker_task_role_arn  = module.ecs_cluster.worker_task_role_arn # Minimal worker role
  ecr_worker_repository_url = module.ecr.worker_repository_url
  worker_image_digest       = var.worker_image_digest
}

# =============================================================================
# ECS Service (API)
# =============================================================================
module "ecs_service" {
  source                       = "../../modules/ecs-service"
  environment                  = var.environment
  vpc_id                       = module.networking.vpc_id
  public_subnet_ids            = module.networking.public_subnet_ids
  private_subnet_ids           = module.networking.private_subnet_ids
  ecs_cluster_id               = module.ecs_cluster.cluster_id
  ecs_cluster_name             = module.ecs_cluster.cluster_name
  ecs_execution_role_arn       = module.ecs_cluster.execution_role_arn
  ecs_task_role_arn            = module.ecs_cluster.task_role_arn
  ecs_tasks_security_group_id  = module.ecs_cluster.tasks_security_group_id
  ecr_api_repository_url       = module.ecr.api_repository_url
  log_group_name               = module.ecs_cluster.api_log_group_name
  certificate_arn              = module.dns.certificate_arn
  database_url_secret_arn      = module.secrets.database_url_arn
  anthropic_api_key_secret_arn = module.secrets.anthropic_api_key_arn
  github_token_secret_arn      = module.secrets.github_token_arn
  jwt_secret_arn               = module.secrets.jwt_secret_arn
  session_secret_arn           = module.secrets.session_secret_arn
  jira_credentials_secret_arn  = module.secrets.jira_credentials_arn
  domain_name                  = var.domain_name
  worker_task_definition       = module.ecs_worker.task_definition_family
  worker_log_group             = module.ecs_worker.log_group_name
  cognito_user_pool_id         = module.cognito.user_pool_id
  cognito_client_id            = module.cognito.web_client_id
  cognito_domain               = module.cognito.domain
  api_image_digest             = var.api_image_digest
  ses_source_email             = "noreply@workermill.com"

  depends_on = [module.dns, module.ecs_worker]
}

# =============================================================================
# CDN (CloudFront + S3)
# =============================================================================
module "cdn" {
  source          = "../../modules/cdn"
  environment     = var.environment
  domain_name     = var.domain_name
  domain_aliases  = [var.domain_name] # Just dev.workermill.com, no www
  certificate_arn = module.dns.certificate_arn
  alb_dns_name    = module.ecs_service.alb_dns_name

  depends_on = [module.dns]
}

# =============================================================================
# Cognito (Authentication)
# =============================================================================
module "cognito" {
  source      = "../../modules/cognito"
  environment = var.environment
  domain_name = var.domain_name

  # Social SSO Providers
  google_client_id        = var.google_client_id
  google_client_secret    = var.google_client_secret
  microsoft_client_id     = var.microsoft_client_id
  microsoft_client_secret = var.microsoft_client_secret
  microsoft_tenant_id     = var.microsoft_tenant_id
}

# =============================================================================
# Route53 Record (subdomain under workermill.com)
# =============================================================================
resource "aws_route53_record" "dev" {
  zone_id = module.dns.zone_id
  name    = var.domain_name # dev.workermill.com
  type    = "A"

  alias {
    name                   = module.cdn.distribution_domain_name
    zone_id                = module.cdn.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

# =============================================================================
# Monitoring & Alerting (lighter config for dev)
# =============================================================================
module "monitoring" {
  source      = "../../modules/monitoring"
  environment = var.environment

  # Resource references
  ecs_cluster_name        = module.ecs_cluster.cluster_name
  ecs_api_service_name    = module.ecs_service.api_service_name
  alb_arn_suffix          = module.ecs_service.alb_arn_suffix
  target_group_arn_suffix = module.ecs_service.target_group_arn_suffix
  rds_instance_identifier = module.database.instance_identifier

  # SNS configuration
  create_sns_topic      = true
  alarm_email_endpoints = var.alarm_email_endpoints

  # Higher thresholds for dev (less sensitive)
  cost_threshold_warning  = 50
  cost_threshold_alert    = 100
  cost_threshold_critical = 200

  alb_5xx_error_threshold_percent = 10
  alb_5xx_evaluation_periods      = 3
  alb_5xx_period_seconds          = 300

  rds_max_connections              = 85
  rds_connection_threshold_percent = 90

  task_queue_threshold = 20

  # Feature flags - fewer alarms for dev
  enable_ecs_alarms        = true
  enable_alb_alarms        = true
  enable_rds_alarms        = true
  enable_cost_alarms       = true
  enable_task_queue_alarms = false # Less critical for dev

  depends_on = [module.ecs_service, module.database]
}

# =============================================================================
# Worker State Checkpointing
# =============================================================================
resource "aws_s3_bucket" "worker_state" {
  bucket = "workermill-${var.environment}-worker-state-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "workermill-${var.environment}-worker-state"
    Environment = var.environment
    Purpose     = "Worker checkpoint storage"
  }
}

resource "aws_s3_bucket_public_access_block" "worker_state" {
  bucket = aws_s3_bucket.worker_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "worker_state" {
  bucket = aws_s3_bucket.worker_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "worker_state" {
  bucket = aws_s3_bucket.worker_state.id

  rule {
    id     = "cleanup-old-checkpoints"
    status = "Enabled"

    filter {}

    expiration {
      days = 7
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "worker_state" {
  bucket = aws_s3_bucket.worker_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
