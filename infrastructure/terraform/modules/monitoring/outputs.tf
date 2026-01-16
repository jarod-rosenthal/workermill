# =============================================================================
# Monitoring Module Outputs
# =============================================================================

output "sns_topic_arn" {
  description = "ARN of the SNS topic for alarm notifications"
  value       = var.create_sns_topic ? aws_sns_topic.alarms[0].arn : var.sns_topic_arn
}

output "sns_topic_name" {
  description = "Name of the SNS topic for alarm notifications"
  value       = var.create_sns_topic ? aws_sns_topic.alarms[0].name : null
}

output "dashboard_name" {
  description = "Name of the CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.main.dashboard_name
}

output "dashboard_arn" {
  description = "ARN of the CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.main.dashboard_arn
}

# =============================================================================
# Alarm ARNs
# =============================================================================

output "ecs_alarm_arns" {
  description = "ARNs of ECS-related alarms"
  value = var.enable_ecs_alarms ? {
    api_running_tasks = aws_cloudwatch_metric_alarm.ecs_api_running_tasks[0].arn
    api_cpu_high      = aws_cloudwatch_metric_alarm.ecs_api_cpu_high[0].arn
    api_memory_high   = aws_cloudwatch_metric_alarm.ecs_api_memory_high[0].arn
  } : {}
}

output "alb_alarm_arns" {
  description = "ARNs of ALB-related alarms"
  value = var.enable_alb_alarms ? {
    error_5xx       = aws_cloudwatch_metric_alarm.alb_5xx_errors[0].arn
    response_time   = aws_cloudwatch_metric_alarm.alb_target_response_time[0].arn
    unhealthy_hosts = aws_cloudwatch_metric_alarm.alb_unhealthy_hosts[0].arn
  } : {}
}

output "rds_alarm_arns" {
  description = "ARNs of RDS-related alarms"
  value = var.enable_rds_alarms ? {
    connections_high = aws_cloudwatch_metric_alarm.rds_connections_high[0].arn
    cpu_high         = aws_cloudwatch_metric_alarm.rds_cpu_high[0].arn
    storage_low      = aws_cloudwatch_metric_alarm.rds_storage_low[0].arn
    memory_low       = aws_cloudwatch_metric_alarm.rds_memory_low[0].arn
  } : {}
}

output "cost_alarm_arns" {
  description = "ARNs of cost-related alarms"
  value = var.enable_cost_alarms ? {
    warning  = aws_cloudwatch_metric_alarm.cost_warning[0].arn
    alert    = aws_cloudwatch_metric_alarm.cost_alert[0].arn
    critical = aws_cloudwatch_metric_alarm.cost_critical[0].arn
  } : {}
}

output "task_queue_alarm_arns" {
  description = "ARNs of task queue related alarms"
  value = var.enable_task_queue_alarms ? {
    queue_depth_high  = aws_cloudwatch_metric_alarm.task_queue_depth[0].arn
    failure_rate_high = aws_cloudwatch_metric_alarm.task_failure_rate[0].arn
  } : {}
}
