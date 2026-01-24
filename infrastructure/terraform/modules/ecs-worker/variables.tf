variable "environment" {
  description = "Environment name (e.g., dev, staging, prod)"
  type        = string
}

variable "ecs_execution_role_arn" {
  description = "ECS task execution role ARN"
  type        = string
}

variable "ecs_task_role_arn" {
  description = "ECS task role ARN (deprecated - use ecs_worker_task_role_arn for workers)"
  type        = string
  default     = ""
}

variable "ecs_worker_task_role_arn" {
  description = "ECS worker task role ARN (minimal permissions - workers assume customer roles)"
  type        = string
  default     = ""
}

variable "ecr_worker_repository_url" {
  description = "ECR repository URL for worker image"
  type        = string
}

variable "worker_image_digest" {
  description = "Worker Docker image digest (sha256:...) for pinned deployments"
  type        = string
  default     = ""
}
