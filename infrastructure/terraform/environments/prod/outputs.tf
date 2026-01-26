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
# ECS Worker
# =============================================================================
output "worker_task_definition" {
  description = "Worker ECS task definition family"
  value       = module.ecs_worker.task_definition_family
}

output "worker_log_group" {
  description = "Worker CloudWatch log group"
  value       = module.ecs_worker.log_group_name
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

# =============================================================================
# Monitoring
# =============================================================================
output "monitoring_sns_topic_arn" {
  description = "SNS topic ARN for alarm notifications"
  value       = module.monitoring.sns_topic_arn
}

output "monitoring_dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = module.monitoring.dashboard_name
}

output "monitoring_dashboard_url" {
  description = "CloudWatch dashboard URL"
  value       = "https://${data.aws_region.current.name}.console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.current.name}#dashboards:name=${module.monitoring.dashboard_name}"
}

# =============================================================================
# GPU Inference (Optional - only shown when gpu_enabled=true)
# =============================================================================
output "gpu_instance_id" {
  description = "GPU instance ID (if running)"
  value       = var.gpu_enabled ? module.gpu_inference[0].instance_id : null
}

output "gpu_instance_private_ip" {
  description = "GPU instance private IP (if running)"
  value       = var.gpu_enabled ? module.gpu_inference[0].instance_private_ip : null
}

output "gpu_ssm_connect_command" {
  description = "Command to connect to GPU instance via SSM"
  value       = var.gpu_enabled ? module.gpu_inference[0].ssm_connect_command : null
}

# =============================================================================
# Customer Deployment Roles
# =============================================================================
output "worker_task_role_arn" {
  description = "Worker task role ARN (minimal permissions for customer role assumption)"
  value       = module.ecs_cluster.worker_task_role_arn
}

output "oncallshift_customer_role_arn" {
  description = "OnCallShift customer deployment role ARN (for WorkerMill Settings)"
  value       = module.ecs_cluster.oncallshift_customer_role_arn
}

output "workermill_improver_role_arn" {
  description = "WorkerMill improver role ARN (for self-improvement operations)"
  value       = module.ecs_cluster.improver_role_arn
}
