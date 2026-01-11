# =============================================================================
# Network
# =============================================================================
output "vpc_id" {
  description = "VPC ID"
  value       = module.networking.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.networking.private_subnet_ids
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.networking.public_subnet_ids
}

# =============================================================================
# Database
# =============================================================================
output "rds_endpoint" {
  description = "RDS endpoint"
  value       = module.database.endpoint
}

# =============================================================================
# ECS
# =============================================================================
output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs_cluster.cluster_name
}

output "api_service_name" {
  description = "API ECS service name"
  value       = module.ecs_service.api_service_name
}

# =============================================================================
# ECR
# =============================================================================
output "ecr_api_repository_url" {
  description = "ECR repository URL for API"
  value       = module.ecr.api_repository_url
}

output "ecr_worker_repository_url" {
  description = "ECR repository URL for worker"
  value       = module.ecr.worker_repository_url
}

# =============================================================================
# Frontend
# =============================================================================
output "frontend_bucket_name" {
  description = "S3 bucket name for frontend"
  value       = module.cdn.frontend_bucket_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = module.cdn.distribution_id
}

# =============================================================================
# URLs
# =============================================================================
output "app_url" {
  description = "Application URL"
  value       = "https://${var.domain_name}"
}

output "api_url" {
  description = "API URL"
  value       = "https://${var.domain_name}/api"
}

# =============================================================================
# Deployment Info (for CI/CD)
# =============================================================================
output "deployment_info" {
  description = "Information needed for deployments"
  value = {
    aws_region         = data.aws_region.current.name
    aws_account_id     = data.aws_caller_identity.current.account_id
    ecr_api_repo       = module.ecr.api_repository_url
    ecr_worker_repo    = module.ecr.worker_repository_url
    ecs_cluster        = module.ecs_cluster.cluster_name
    ecs_api_service    = module.ecs_service.api_service_name
    frontend_bucket    = module.cdn.frontend_bucket_name
    cloudfront_dist_id = module.cdn.distribution_id
  }
}

# =============================================================================
# Secrets
# =============================================================================
output "secrets_prefix" {
  description = "Secrets Manager prefix"
  value       = module.secrets.secrets_prefix
}

# =============================================================================
# SQS
# =============================================================================
output "jobs_queue_url" {
  description = "SQS jobs queue URL"
  value       = module.sqs.jobs_queue_url
}

output "priority_queue_url" {
  description = "SQS priority queue URL"
  value       = module.sqs.priority_queue_url
}

# =============================================================================
# Lambda
# =============================================================================
output "webhook_url" {
  description = "Lambda function URL for webhooks"
  value       = module.lambda_dispatcher.function_url
}

# =============================================================================
# Cognito
# =============================================================================
output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.cognito.user_pool_id
}

output "cognito_web_client_id" {
  description = "Cognito Web Client ID"
  value       = module.cognito.web_client_id
}

output "cognito_hosted_ui_url" {
  description = "Cognito Hosted UI URL"
  value       = module.cognito.hosted_ui_url
}
