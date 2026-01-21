variable "environment" {
  description = "Environment name"
  type        = string
}

variable "domain_name" {
  description = "Domain name for this environment (e.g., workermill.com or dev.workermill.com)"
  type        = string
}

variable "hosted_zone_domain" {
  description = "Domain of the Route53 hosted zone. Defaults to domain_name. For subdomains, set to parent domain (e.g., workermill.com)."
  type        = string
  default     = null
}

variable "create_certificate" {
  description = "Whether to create a new ACM certificate. Set to false to use existing wildcard cert."
  type        = bool
  default     = true
}

variable "certificate_arn" {
  description = "ARN of existing certificate to use (required if create_certificate=false)"
  type        = string
  default     = null
}
