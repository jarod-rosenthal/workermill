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
# Networking
# =============================================================================
module "networking" {
  source             = "../../modules/networking"
  environment        = var.environment
  availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c", "us-east-1d", "us-east-1e", "us-east-1f"]
}

# =============================================================================
# DNS & Certificate (must be created before CDN)
# =============================================================================
module "dns" {
  source      = "../../modules/dns"
  environment = var.environment
  domain_name = var.domain_name
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
# Must be created before ECS Service so we can pass worker_task_definition
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
  certificate_arn = module.dns.certificate_arn
  alb_dns_name    = module.ecs_service.alb_dns_name

  depends_on = [module.dns]
}

# =============================================================================
# SSO Credentials from Secrets Manager
# =============================================================================
data "aws_secretsmanager_secret_version" "google_oauth" {
  count     = 1 # Set to 0 to disable Google SSO
  secret_id = "workermill/prod/google-oauth"
}

locals {
  google_oauth = length(data.aws_secretsmanager_secret_version.google_oauth) > 0 ? jsondecode(data.aws_secretsmanager_secret_version.google_oauth[0].secret_string) : null
}

# =============================================================================
# Cognito (Authentication)
# =============================================================================
module "cognito" {
  source      = "../../modules/cognito"
  environment = var.environment
  domain_name = var.domain_name

  # Social SSO Providers (from Secrets Manager)
  google_client_id        = local.google_oauth != null ? local.google_oauth.client_id : ""
  google_client_secret    = local.google_oauth != null ? local.google_oauth.client_secret : ""
  microsoft_client_id     = var.microsoft_client_id
  microsoft_client_secret = var.microsoft_client_secret
  microsoft_tenant_id     = var.microsoft_tenant_id
}

# =============================================================================
# Route53 Records (created after CDN)
# =============================================================================
resource "aws_route53_record" "root" {
  zone_id = module.dns.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.cdn.distribution_domain_name
    zone_id                = module.cdn.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www" {
  zone_id = module.dns.zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = module.cdn.distribution_domain_name
    zone_id                = module.cdn.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

# =============================================================================
# Monitoring & Alerting
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

  # SNS configuration - add email endpoints for notifications
  create_sns_topic      = true
  alarm_email_endpoints = var.alarm_email_endpoints

  # Cost thresholds (USD)
  cost_threshold_warning  = 100
  cost_threshold_alert    = 250
  cost_threshold_critical = 500

  # ALB error rate thresholds
  alb_5xx_error_threshold_percent = 5
  alb_5xx_evaluation_periods      = 2
  alb_5xx_period_seconds          = 300

  # RDS connection thresholds
  rds_max_connections              = 85 # db.t4g.micro default
  rds_connection_threshold_percent = 80

  # Task queue thresholds
  task_queue_threshold = 10

  # Feature flags - enable all alarms
  enable_ecs_alarms        = true
  enable_alb_alarms        = true
  enable_rds_alarms        = true
  enable_cost_alarms       = true
  enable_task_queue_alarms = true

  depends_on = [module.ecs_service, module.database]
}

# =============================================================================
# SES Inbound Email Processing
# =============================================================================
module "ses_inbound" {
  source = "../../modules/ses-inbound"

  environment          = var.environment
  domain_name          = var.domain_name
  api_endpoint         = "https://${var.domain_name}"
  email_webhook_secret = module.secrets.email_webhook_secret_value

  tags = {
    Project     = "workermill"
    Environment = var.environment
  }

  depends_on = [module.dns, module.secrets]
}

# MX record for receiving email
resource "aws_route53_record" "mx" {
  zone_id = module.dns.zone_id
  name    = var.domain_name
  type    = "MX"
  ttl     = 600
  records = [module.ses_inbound.mx_record_value]
}
