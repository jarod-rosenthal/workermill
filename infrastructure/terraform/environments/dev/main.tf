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
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
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
  source      = "../../modules/networking"
  environment = var.environment
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
# ECS Service (API)
# =============================================================================
module "ecs_service" {
  source                       = "../../modules/ecs-service"
  environment                  = var.environment
  vpc_id                       = module.networking.vpc_id
  public_subnet_ids            = module.networking.public_subnet_ids
  private_subnet_ids           = module.networking.private_subnet_ids
  ecs_cluster_id               = module.ecs_cluster.cluster_id
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

  depends_on = [module.dns]
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
# SQS Queues (Job Queue)
# =============================================================================
module "sqs" {
  source      = "../../modules/sqs"
  environment = var.environment
}

# =============================================================================
# Lambda Dispatcher (Webhook Handler)
# =============================================================================
module "lambda_dispatcher" {
  source             = "../../modules/lambda-dispatcher"
  environment        = var.environment
  jobs_queue_url     = module.sqs.jobs_queue_url
  jobs_queue_arn     = module.sqs.jobs_queue_arn
  priority_queue_url = module.sqs.priority_queue_url
  priority_queue_arn = module.sqs.priority_queue_arn
}

# =============================================================================
# Cognito (Authentication)
# =============================================================================
module "cognito" {
  source      = "../../modules/cognito"
  environment = var.environment
  domain_name = var.domain_name
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
