# SES Inbound Email Module Variables

variable "environment" {
  description = "Environment name (e.g., prod, dev)"
  type        = string
}

variable "domain_name" {
  description = "Domain name for receiving emails (e.g., workermill.com)"
  type        = string
}

variable "api_endpoint" {
  description = "API endpoint URL for the email webhook"
  type        = string
}

variable "email_webhook_secret" {
  description = "Secret for authenticating email webhook requests"
  type        = string
  sensitive   = true
}

variable "s3_bucket_name" {
  description = "Name for the S3 bucket to store incoming emails"
  type        = string
  default     = ""
}

variable "retention_days" {
  description = "Number of days to retain emails in S3 before deletion"
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
