variable "environment" {
  description = "Environment name"
  type        = string
}

variable "domain_name" {
  description = "Primary domain name for CloudFront"
  type        = string
}

variable "domain_aliases" {
  description = "List of domain aliases for CloudFront. Defaults to [domain_name, www.domain_name] if not specified."
  type        = list(string)
  default     = null
}

variable "certificate_arn" {
  description = "ACM certificate ARN"
  type        = string
}

variable "alb_dns_name" {
  description = "ALB DNS name for API origin (used when api_origin_domain is not set)"
  type        = string
}

variable "api_origin_domain" {
  description = "Custom domain for API origin (e.g., api.workermill.com). Must have valid SSL cert. If not set, falls back to alb_dns_name with http-only (insecure, not recommended)."
  type        = string
  default     = null
}
