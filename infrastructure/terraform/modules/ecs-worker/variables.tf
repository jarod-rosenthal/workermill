variable "environment" {
  description = "Environment name (e.g., dev, staging, prod)"
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

variable "ecr_worker_repository_url" {
  description = "ECR repository URL for worker image"
  type        = string
}

variable "worker_image_digest" {
  description = "Worker Docker image digest (sha256:...) for pinned deployments"
  type        = string
  default     = ""
}
