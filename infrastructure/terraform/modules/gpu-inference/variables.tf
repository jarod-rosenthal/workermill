variable "project" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block for security group rules"
  type        = string
}

variable "private_subnet_ids" {
  description = "Existing private subnet IDs to use for spot fleet"
  type        = list(string)
}

variable "ami_id" {
  description = "AMI ID (Deep Learning AMI)"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "p4de.24xlarge"
}

variable "root_volume_size" {
  description = "Root EBS volume size in GB"
  type        = number
  default     = 500
}

variable "spot_max_price" {
  description = "Maximum spot price per hour"
  type        = string
  default     = "15.00"
}

variable "user_data" {
  description = "User data script"
  type        = string
  default     = ""
}

variable "create_instance" {
  description = "Whether to create the spot instance"
  type        = bool
  default     = false
}
