# =============================================================================
# Production Environment Variables
# =============================================================================
#
# IMPORTANT: This is the PRODUCTION environment folder.
#
# The 'environment' variable is set to "dev" to preserve existing AWS resource
# names (workermill-dev-*). Changing this would trigger destroy/recreate of
# all resources. This is a Terraform best practice - resource names are
# immutable once created.
#
# Folder structure:
#   environments/prod/  -> PRODUCTION (workermill.com)
#   environments/dev/   -> DEVELOPMENT (dev.workermill.com)
#
# =============================================================================

variable "environment" {
  description = "Environment name (resource prefix - do NOT change for existing resources)"
  type        = string
  default     = "dev" # Preserves existing resource names: workermill-dev-*
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

variable "support_email_forward_to" {
  description = "Email address to forward incoming support emails to"
  type        = string
  default     = "jarod.rosenthal@protonmail.com"
}

# -----------------------------------------------------------------------------
# Cloudflare Tunnel (Optional - disabled by default)
# -----------------------------------------------------------------------------
variable "cloudflare_tunnel_enabled" {
  description = "Enable Cloudflare Tunnel connector for private VPC access (DB, internal services)"
  type        = bool
  default     = false
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

variable "cognito_domain" {
  description = "Custom domain for Cognito hosted UI"
  type        = string
  default     = "auth.workermill.com"
}

# -----------------------------------------------------------------------------
# Bastion Host (Optional - for local development DB access)
# -----------------------------------------------------------------------------
variable "bastion_enabled" {
  description = "Enable bastion host for SSH tunneling to RDS"
  type        = bool
  default     = true
}

variable "bastion_ssh_public_key" {
  description = "SSH public key for bastion access"
  type        = string
  default     = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINJOGizlrHvYdLfQTUGyHX8JDQZ0x8Ow0w/0wu8TVIn6 workermill-bastion"
}

variable "bastion_allowed_ssh_cidrs" {
  description = "Static CIDR blocks for SSH (Lambda dynamically adds your IP on start)"
  type        = list(string)
  default     = []
}
