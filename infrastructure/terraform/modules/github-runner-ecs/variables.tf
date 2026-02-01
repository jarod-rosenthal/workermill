variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for runner tasks"
  type        = list(string)
}

variable "github_owner" {
  description = "GitHub repository owner (user or org)"
  type        = string
  default     = "jarod-rosenthal"
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "workermill"
}

variable "runner_labels" {
  description = "Labels for the GitHub Actions runner"
  type        = list(string)
  default     = ["self-hosted", "linux", "x64", "ecs"]
}

variable "runner_cpu" {
  description = "CPU units for the runner task (1024 = 1 vCPU)"
  type        = number
  default     = 2048
}

variable "runner_memory" {
  description = "Memory in MB for the runner task"
  type        = number
  default     = 4096
}
