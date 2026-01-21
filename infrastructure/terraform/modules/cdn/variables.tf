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
  description = "ALB DNS name for API origin"
  type        = string
}
