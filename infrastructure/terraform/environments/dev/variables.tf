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

# -----------------------------------------------------------------------------
# GPU Inference (Optional - disabled by default)
# -----------------------------------------------------------------------------
variable "gpu_enabled" {
  description = "Enable GPU inference infrastructure (subnet, SG, IAM, launch template)"
  type        = bool
  default     = false
}

variable "gpu_create_instance" {
  description = "Launch the GPU spot instance (requires gpu_enabled=true)"
  type        = bool
  default     = false
}

variable "gpu_instance_type" {
  description = "GPU instance type (p4de.24xlarge = 8x A100 80GB for Kimi K2)"
  type        = string
  default     = "p4de.24xlarge"
}
