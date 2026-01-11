variable "environment" {
  description = "Environment name"
  type        = string
}

variable "domain_name" {
  description = "Domain name (must have existing Route53 hosted zone)"
  type        = string
}
