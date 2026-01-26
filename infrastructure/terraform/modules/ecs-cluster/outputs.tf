output "cluster_id" {
  description = "ECS cluster ID"
  value       = aws_ecs_cluster.main.id
}

output "cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "execution_role_arn" {
  description = "ECS task execution role ARN"
  value       = aws_iam_role.ecs_execution.arn
}

output "task_role_arn" {
  description = "ECS task role ARN (for API service - full platform access)"
  value       = aws_iam_role.ecs_task.arn
}

output "worker_task_role_arn" {
  description = "ECS worker task role ARN (minimal permissions - workers assume customer roles for deployments)"
  value       = aws_iam_role.ecs_worker_task.arn
}

output "oncallshift_customer_role_arn" {
  description = "OnCallShift customer deployment role ARN (workers assume this for oncallshift deployments)"
  value       = aws_iam_role.oncallshift_customer.arn
}

output "improver_role_arn" {
  description = "WorkerMill improver role ARN (workers assume this for self-improvement operations)"
  value       = aws_iam_role.workermill_improver.arn
}

output "tasks_security_group_id" {
  description = "Security group ID for ECS tasks"
  value       = aws_security_group.ecs_tasks.id
}

output "api_log_group_name" {
  description = "CloudWatch log group name for API"
  value       = aws_cloudwatch_log_group.api.name
}

output "worker_log_group_name" {
  description = "CloudWatch log group name for worker"
  value       = aws_cloudwatch_log_group.worker.name
}

