output "task_definition_arn" {
  description = "ARN of the worker task definition"
  value       = aws_ecs_task_definition.worker.arn
}

output "task_definition_family" {
  description = "Family name of the worker task definition"
  value       = aws_ecs_task_definition.worker.family
}

output "log_group_name" {
  description = "CloudWatch log group name for workers"
  value       = aws_cloudwatch_log_group.worker.name
}
