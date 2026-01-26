# =============================================================================
# Development Environment Variables
# =============================================================================
#
# This is the DEVELOPMENT environment for testing and iteration.
# Accessible at: dev.workermill.com
#
# Resources are named workermill-sandbox-* to distinguish from production.
#
# Folder structure:
#   environments/prod/  -> PRODUCTION (workermill.com)
#   environments/dev/   -> DEVELOPMENT (dev.workermill.com)
#
# =============================================================================

variable "environment" {
  description = "Environment name (used in resource naming)"
  type        = string
  default     = "sandbox"
}

variable "domain_name" {
  description = "Domain name for this environment"
  type        = string
  default     = "dev.workermill.com"
}

variable "vpc_cidr" {
  description = "VPC CIDR block (must not overlap with production)"
  type        = string
  default     = "10.2.0.0/16" # Production uses 10.1.0.0/16
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
  description = "Enable GPU inference infrastructure"
  type        = bool
  default     = false
}

variable "gpu_create_instance" {
  description = "Launch the GPU spot instance (requires gpu_enabled=true)"
  type        = bool
  default     = false
}

variable "gpu_instance_type" {
  description = "GPU instance type"
  type        = string
  default     = "g4dn.xlarge" # Smaller/cheaper for dev
}

# -----------------------------------------------------------------------------
# Social SSO Providers (Optional)
# -----------------------------------------------------------------------------
variable "google_client_id" {
  description = "Google OAuth 2.0 Client ID for SSO"
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth 2.0 Client Secret for SSO"
  type        = string
  default     = ""
  sensitive   = true
}

variable "microsoft_client_id" {
  description = "Microsoft/Azure AD Client ID for SSO"
  type        = string
  default     = ""
}

variable "microsoft_client_secret" {
  description = "Microsoft/Azure AD Client Secret for SSO"
  type        = string
  default     = ""
  sensitive   = true
}

variable "microsoft_tenant_id" {
  description = "Microsoft/Azure AD Tenant ID (use 'common' for multi-tenant)"
  type        = string
  default     = "common"
}
