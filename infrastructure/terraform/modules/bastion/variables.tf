variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs (multi-AZ for spot availability)"
  type        = list(string)
}

variable "allowed_ssh_cidrs" {
  description = "CIDR blocks allowed to SSH to the bastion"
  type        = list(string)
  default     = []
}

variable "vpc_cidr" {
  description = "VPC CIDR block for restricted egress rules"
  type        = string
}

variable "ssh_public_key" {
  description = "SSH public key to add to the bastion (content of .pub file)"
  type        = string
}

variable "instance_types" {
  description = "EC2 instance types in order of preference (for spot fallback)"
  type        = list(string)
  default     = ["t4g.nano", "t4g.micro", "t3a.nano", "t3a.micro", "t3.nano", "t3.micro"]
}

variable "use_spot" {
  description = "Use spot instances for cost savings"
  type        = bool
  default     = true
}

variable "spot_max_price" {
  description = "Maximum spot price (empty = on-demand price)"
  type        = string
  default     = ""
}

variable "rds_endpoint" {
  description = "RDS endpoint for SSH tunnel command output"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Optional Scheduling
# -----------------------------------------------------------------------------
variable "enable_schedule" {
  description = "Enable automatic start/stop schedule"
  type        = bool
  default     = false
}

variable "schedule_start" {
  description = "Cron expression for starting bastion (UTC). E.g., 'cron(0 13 ? * MON-FRI *)' for 9am ET weekdays"
  type        = string
  default     = ""
}

variable "schedule_stop" {
  description = "Cron expression for stopping bastion (UTC). E.g., 'cron(0 1 ? * MON-FRI *)' for 9pm ET weekdays"
  type        = string
  default     = ""
}
