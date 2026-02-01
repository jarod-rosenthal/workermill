# =============================================================================
# Outputs
# =============================================================================

output "task_definition_family" {
  description = "ECS task definition family name"
  value       = aws_ecs_task_definition.runner.family
}

output "task_definition_arn" {
  description = "ECS task definition ARN"
  value       = aws_ecs_task_definition.runner.arn
}

output "runner_security_group_id" {
  description = "Security group ID for runner tasks (add to DB allowed SGs)"
  value       = aws_security_group.runner.id
}

output "log_group_name" {
  description = "CloudWatch log group for runner logs"
  value       = aws_cloudwatch_log_group.runner.name
}

output "execution_role_arn" {
  description = "Execution role ARN for ECS"
  value       = aws_iam_role.execution.arn
}

output "task_role_arn" {
  description = "Task role ARN for the runner container"
  value       = aws_iam_role.task.arn
}
