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
