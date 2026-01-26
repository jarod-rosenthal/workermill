variable "environment" {
  description = "Environment name"
  type        = string
}

variable "domain_name" {
  description = "Application domain name for callback URLs"
  type        = string
}

# =============================================================================
# Social Identity Providers
# =============================================================================

variable "google_client_id" {
  description = "Google OAuth 2.0 Client ID"
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth 2.0 Client Secret"
  type        = string
  default     = ""
  sensitive   = true
}

variable "microsoft_client_id" {
  description = "Microsoft/Azure AD OAuth 2.0 Client ID"
  type        = string
  default     = ""
}

variable "microsoft_client_secret" {
  description = "Microsoft/Azure AD OAuth 2.0 Client Secret"
  type        = string
  default     = ""
  sensitive   = true
}

variable "microsoft_tenant_id" {
  description = "Microsoft/Azure AD Tenant ID (use 'common' for multi-tenant)"
  type        = string
  default     = "common"
}
