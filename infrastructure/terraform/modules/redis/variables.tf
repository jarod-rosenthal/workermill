variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for Redis subnet group"
  type        = list(string)
}

variable "api_security_group_id" {
  description = "Security group ID for ECS API tasks (allowed to connect to Redis)"
  type        = string
}
