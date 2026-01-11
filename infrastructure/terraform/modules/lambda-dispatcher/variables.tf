variable "environment" {
  description = "Environment name"
  type        = string
}

variable "jobs_queue_url" {
  description = "URL of the main jobs SQS queue"
  type        = string
}

variable "jobs_queue_arn" {
  description = "ARN of the main jobs SQS queue"
  type        = string
}

variable "priority_queue_url" {
  description = "URL of the priority jobs SQS queue"
  type        = string
}

variable "priority_queue_arn" {
  description = "ARN of the priority jobs SQS queue"
  type        = string
}
