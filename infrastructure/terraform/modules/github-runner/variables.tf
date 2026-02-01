variable "environment" {
  description = "Environment name (e.g., dev, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where the runner will be deployed"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block for security group rules"
  type        = string
}

variable "private_subnet_id" {
  description = "Private subnet ID for the runner (single AZ for cost savings)"
  type        = string
}

variable "github_org" {
  description = "GitHub organization name"
  type        = string
  default     = "jarodtowner"
}

variable "github_repo" {
  description = "GitHub repository name (for repo-level runner, or empty for org-level)"
  type        = string
  default     = "workermill"
}

variable "instance_type" {
  description = "EC2 instance type for the runner"
  type        = string
  default     = "t3.small"
}

variable "root_volume_size" {
  description = "Root volume size in GB"
  type        = number
  default     = 30
}

variable "runner_labels" {
  description = "Labels for the GitHub Actions runner"
  type        = list(string)
  default     = ["self-hosted", "linux", "x64", "vpc"]
}

variable "runner_version" {
  description = "GitHub Actions runner version"
  type        = string
  default     = "2.321.0"
}

variable "node_version" {
  description = "Node.js version to install"
  type        = string
  default     = "20"
}
