variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "domain_name" {
  description = "Domain name (must have existing Route53 hosted zone)"
  type        = string
  default     = "workermill.com"
}

variable "api_image_digest" {
  description = "API Docker image digest (sha256:...) for pinned deployments"
  type        = string
  default     = ""
}

variable "worker_image_digest" {
  description = "Worker Docker image digest (sha256:...) for pinned deployments"
  type        = string
  default     = ""
}

variable "alarm_email_endpoints" {
  description = "List of email addresses to receive CloudWatch alarm notifications"
  type        = list(string)
  default     = []
}
