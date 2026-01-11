variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "secrets_arn_pattern" {
  description = "ARN pattern for secrets access (e.g., arn:aws:secretsmanager:region:account:secret:workermill/env/*)"
  type        = string
}
