# =============================================================================
# Monitoring Module Variables
# =============================================================================

variable "environment" {
  description = "Environment name (e.g., dev, staging, prod)"
  type        = string
}

# =============================================================================
# Resource References
# =============================================================================

variable "ecs_cluster_name" {
  description = "Name of the ECS cluster to monitor"
  type        = string
}

variable "ecs_api_service_name" {
  description = "Name of the API ECS service"
  type        = string
}

variable "alb_arn_suffix" {
  description = "ARN suffix of the ALB (for CloudWatch metrics)"
  type        = string
}

variable "target_group_arn_suffix" {
  description = "ARN suffix of the API target group (for CloudWatch metrics)"
  type        = string
}

variable "rds_instance_identifier" {
  description = "RDS instance identifier"
  type        = string
}

# =============================================================================
# Alarm Thresholds
# =============================================================================

variable "alb_5xx_error_threshold_percent" {
  description = "Threshold percentage for ALB 5xx error rate alarm"
  type        = number
  default     = 5
}

variable "alb_5xx_evaluation_periods" {
  description = "Number of evaluation periods for ALB 5xx error alarm"
  type        = number
  default     = 2
}

variable "alb_5xx_period_seconds" {
  description = "Period in seconds for ALB 5xx error alarm evaluation"
  type        = number
  default     = 300
}

variable "rds_connection_threshold_percent" {
  description = "Threshold percentage of max connections for RDS alarm"
  type        = number
  default     = 80
}

variable "rds_max_connections" {
  description = "Maximum number of RDS connections (db.t4g.micro default ~85)"
  type        = number
  default     = 85
}

# =============================================================================
# Cost Thresholds
# =============================================================================

variable "cost_threshold_warning" {
  description = "Monthly cost threshold for warning alarm (USD)"
  type        = number
  default     = 100
}

variable "cost_threshold_alert" {
  description = "Monthly cost threshold for alert alarm (USD)"
  type        = number
  default     = 250
}

variable "cost_threshold_critical" {
  description = "Monthly cost threshold for critical alarm (USD)"
  type        = number
  default     = 500
}

# =============================================================================
# SNS Configuration
# =============================================================================

variable "alarm_email_endpoints" {
  description = "List of email addresses to receive alarm notifications"
  type        = list(string)
  default     = []
}

variable "create_sns_topic" {
  description = "Whether to create a new SNS topic for alarms"
  type        = bool
  default     = true
}

variable "sns_topic_arn" {
  description = "Existing SNS topic ARN (if create_sns_topic is false)"
  type        = string
  default     = ""
}

# =============================================================================
# Feature Flags
# =============================================================================

variable "enable_ecs_alarms" {
  description = "Enable ECS task failure alarms"
  type        = bool
  default     = true
}

variable "enable_alb_alarms" {
  description = "Enable ALB 5xx error rate alarms"
  type        = bool
  default     = true
}

variable "enable_rds_alarms" {
  description = "Enable RDS connection alarms"
  type        = bool
  default     = true
}

variable "enable_cost_alarms" {
  description = "Enable cost threshold alarms"
  type        = bool
  default     = true
}

variable "enable_task_queue_alarms" {
  description = "Enable worker task queue depth alarms"
  type        = bool
  default     = true
}

variable "task_queue_threshold" {
  description = "Threshold for task queue depth alarm"
  type        = number
  default     = 10
}

# =============================================================================
# Slack Integration
# =============================================================================

variable "slack_webhook_url" {
  description = "Slack Incoming Webhook URL for alarm notifications. When non-empty, creates a Lambda that forwards SNS alarm messages to Slack."
  type        = string
  default     = ""
  sensitive   = true
}
