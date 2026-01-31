variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for DB subnet group"
  type        = list(string)
}

variable "allowed_security_group_id" {
  description = "Security group ID allowed to connect to RDS"
  type        = string
}

variable "additional_allowed_security_group_ids" {
  description = "Additional security group IDs allowed to connect to RDS (e.g., Cloudflare Tunnel connector)"
  type        = list(string)
  default     = []
}
