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
