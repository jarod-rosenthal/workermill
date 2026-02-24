variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for ALB"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for ECS tasks"
  type        = list(string)
}

variable "ecs_cluster_id" {
  description = "ECS cluster ID"
  type        = string
}

variable "ecs_execution_role_arn" {
  description = "ECS task execution role ARN"
  type        = string
}

variable "ecs_task_role_arn" {
  description = "ECS task role ARN"
  type        = string
}

variable "ecs_tasks_security_group_id" {
  description = "Security group ID for ECS tasks"
  type        = string
}

variable "ecr_api_repository_url" {
  description = "ECR repository URL for API image"
  type        = string
}

variable "log_group_name" {
  description = "CloudWatch log group name"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
}

# Secret ARNs
variable "database_url_secret_arn" {
  description = "ARN of DATABASE_URL secret"
  type        = string
}

variable "anthropic_api_key_secret_arn" {
  description = "ARN of ANTHROPIC_API_KEY secret"
  type        = string
}

variable "github_token_secret_arn" {
  description = "ARN of GITHUB_TOKEN secret"
  type        = string
}

variable "jwt_secret_arn" {
  description = "ARN of JWT_SECRET secret"
  type        = string
}

variable "session_secret_arn" {
  description = "ARN of SESSION_SECRET secret"
  type        = string
}

variable "jira_credentials_secret_arn" {
  description = "ARN of JIRA_CREDENTIALS secret"
  type        = string
}

variable "stripe_secret_key_arn" {
  description = "ARN of STRIPE_SECRET_KEY secret"
  type        = string
}

variable "stripe_webhook_secret_arn" {
  description = "ARN of STRIPE_WEBHOOK_SECRET secret"
  type        = string
}

variable "platform_api_key_secret_arn" {
  description = "ARN of PLATFORM_API_KEY secret for warm container pool authentication"
  type        = string
}

variable "ecs_cluster_name" {
  description = "ECS cluster name for orchestrator to spawn workers"
  type        = string
}

variable "worker_task_definition" {
  description = "Worker ECS task definition family for orchestrator"
  type        = string
}

variable "worker_log_group" {
  description = "CloudWatch log group for workers"
  type        = string
}

variable "runner_task_definition" {
  description = "GitHub runner ECS task definition family"
  type        = string
  default     = ""
}

variable "runner_security_group" {
  description = "Security group ID for GitHub runner tasks"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Domain name for API_BASE_URL"
  type        = string
}

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  type        = string
}

variable "cognito_client_id" {
  description = "Cognito Client ID"
  type        = string
}

variable "cognito_domain" {
  description = "Cognito User Pool domain for OAuth"
  type        = string
  default     = ""
}

variable "api_image_digest" {
  description = "API Docker image digest (sha256:...) for pinned deployments"
  type        = string
  default     = ""
}

variable "ses_source_email" {
  description = "SES verified email address for sending notifications"
  type        = string
  default     = "noreply@workermill.com"
}

variable "support_agent_enabled" {
  description = "Enable AI support agent for automatic ticket responses"
  type        = string
  default     = "false"
}

# Microsoft SSO Secrets
variable "microsoft_client_id_secret_arn" {
  description = "ARN of MICROSOFT_CLIENT_ID secret for Azure AD SSO"
  type        = string
  default     = ""
}

variable "microsoft_client_secret_secret_arn" {
  description = "ARN of MICROSOFT_CLIENT_SECRET secret for Azure AD SSO"
  type        = string
  default     = ""
}

# GitHub SSO Secrets
variable "github_client_id_secret_arn" {
  description = "ARN of GITHUB_CLIENT_ID secret for GitHub OAuth SSO"
  type        = string
  default     = ""
}

variable "github_client_secret_secret_arn" {
  description = "ARN of GITHUB_CLIENT_SECRET secret for GitHub OAuth SSO"
  type        = string
  default     = ""
}

# Admin Notification Secrets
variable "admin_phone_number_secret_arn" {
  description = "ARN of ADMIN_PHONE_NUMBER secret for SMS notifications"
  type        = string
  default     = ""
}

variable "admin_email_secret_arn" {
  description = "ARN of ADMIN_EMAIL secret for email notifications"
  type        = string
  default     = ""
}

# GitHub Runner
variable "github_runner_webhook_secret_arn" {
  description = "ARN of GitHub runner webhook secret for signature verification"
  type        = string
  default     = ""
}

# Encryption
variable "encryption_key_secret_arn" {
  description = "ARN of ENCRYPTION_KEY secret (AES-256 hex key for field-level encryption at rest)"
  type        = string
}

# Redis
variable "redis_url" {
  description = "Redis connection URL for coordination pub/sub (rediss://host:port)"
  type        = string
  default     = ""
}

# Monitoring
variable "sentry_dsn" {
  description = "Sentry DSN for error tracking and performance monitoring"
  type        = string
  default     = ""
}
