variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the cloudflared task"
  type        = list(string)
}

variable "ecs_cluster_id" {
  description = "ECS cluster ID"
  type        = string
}

variable "execution_role_arn" {
  description = "ECS task execution role ARN (needs access to Secrets Manager)"
  type        = string
}

variable "tunnel_token_secret_arn" {
  description = "ARN of the Secrets Manager secret containing the Cloudflare Tunnel token"
  type        = string
}
