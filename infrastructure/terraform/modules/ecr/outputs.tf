output "api_repository_url" {
  description = "ECR repository URL for API"
  value       = aws_ecr_repository.api.repository_url
}

output "api_repository_arn" {
  description = "ECR repository ARN for API"
  value       = aws_ecr_repository.api.arn
}

output "worker_repository_url" {
  description = "ECR repository URL for worker"
  value       = aws_ecr_repository.worker.repository_url
}

output "worker_repository_arn" {
  description = "ECR repository ARN for worker"
  value       = aws_ecr_repository.worker.arn
}
