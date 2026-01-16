# =============================================================================
# WorkerMill Monitoring Module
# CloudWatch Alarms for ECS, ALB, RDS, and Cost Monitoring
# =============================================================================

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  alarm_prefix = "workermill-${var.environment}"
}

# =============================================================================
# SNS Topic for Alarm Notifications
# =============================================================================

resource "aws_sns_topic" "alarms" {
  count = var.create_sns_topic ? 1 : 0

  name         = "${local.alarm_prefix}-alarms"
  display_name = "WorkerMill ${var.environment} Alarms"

  tags = {
    Name = "${local.alarm_prefix}-alarms"
  }
}

resource "aws_sns_topic_subscription" "email" {
  for_each = var.create_sns_topic ? toset(var.alarm_email_endpoints) : []

  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = each.value
}

locals {
  sns_topic_arn = var.create_sns_topic ? aws_sns_topic.alarms[0].arn : var.sns_topic_arn
}

# =============================================================================
# ECS Task Failure Alarms
# =============================================================================

# API Service - Running Task Count
resource "aws_cloudwatch_metric_alarm" "ecs_api_running_tasks" {
  count = var.enable_ecs_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-api-running-tasks-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  alarm_description   = "API service has no running tasks - service may be down"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.ecs_api_service_name
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-api-running-tasks-low"
    Severity = "critical"
  }
}

# API Service - CPU Utilization High
resource "aws_cloudwatch_metric_alarm" "ecs_api_cpu_high" {
  count = var.enable_ecs_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-api-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "API service CPU utilization is above 80% - consider scaling"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.ecs_api_service_name
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-api-cpu-high"
    Severity = "warning"
  }
}

# API Service - Memory Utilization High
resource "aws_cloudwatch_metric_alarm" "ecs_api_memory_high" {
  count = var.enable_ecs_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-api-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  alarm_description   = "API service memory utilization is above 85% - consider scaling"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.ecs_api_service_name
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-api-memory-high"
    Severity = "warning"
  }
}

# =============================================================================
# ALB 5xx Error Rate Alarms
# =============================================================================

# 5xx Error Count Alarm
resource "aws_cloudwatch_metric_alarm" "alb_5xx_errors" {
  count = var.enable_alb_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-alb-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = var.alb_5xx_evaluation_periods
  threshold           = var.alb_5xx_error_threshold_percent
  alarm_description   = "ALB 5xx error rate exceeds ${var.alb_5xx_error_threshold_percent}% - API may be experiencing issues"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "e1"
    expression  = "(m1/m2)*100"
    label       = "5xx Error Rate (%)"
    return_data = true
  }

  metric_query {
    id = "m1"
    metric {
      metric_name = "HTTPCode_Target_5XX_Count"
      namespace   = "AWS/ApplicationELB"
      period      = var.alb_5xx_period_seconds
      stat        = "Sum"

      dimensions = {
        LoadBalancer = var.alb_arn_suffix
        TargetGroup  = var.target_group_arn_suffix
      }
    }
  }

  metric_query {
    id = "m2"
    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ApplicationELB"
      period      = var.alb_5xx_period_seconds
      stat        = "Sum"

      dimensions = {
        LoadBalancer = var.alb_arn_suffix
        TargetGroup  = var.target_group_arn_suffix
      }
    }
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-alb-5xx-errors"
    Severity = "critical"
  }
}

# Target Response Time High
resource "aws_cloudwatch_metric_alarm" "alb_target_response_time" {
  count = var.enable_alb_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-alb-response-time-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  extended_statistic  = "p95"
  threshold           = 5
  alarm_description   = "ALB p95 response time exceeds 5 seconds - API may be slow"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = var.target_group_arn_suffix
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-alb-response-time-high"
    Severity = "warning"
  }
}

# Unhealthy Host Count
resource "aws_cloudwatch_metric_alarm" "alb_unhealthy_hosts" {
  count = var.enable_alb_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-alb-unhealthy-hosts"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 0
  alarm_description   = "ALB has unhealthy hosts - API may be failing health checks"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = var.target_group_arn_suffix
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-alb-unhealthy-hosts"
    Severity = "critical"
  }
}

# =============================================================================
# RDS Database Alarms
# =============================================================================

# Database Connection Count High
resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  count = var.enable_rds_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-rds-connections-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.rds_max_connections * (var.rds_connection_threshold_percent / 100)
  alarm_description   = "RDS connection count exceeds ${var.rds_connection_threshold_percent}% of max (${var.rds_max_connections}) - may experience connection exhaustion"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-rds-connections-high"
    Severity = "warning"
  }
}

# Database CPU Utilization High
resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  count = var.enable_rds_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU utilization exceeds 80% - database may be under heavy load"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-rds-cpu-high"
    Severity = "warning"
  }
}

# Database Free Storage Low
resource "aws_cloudwatch_metric_alarm" "rds_storage_low" {
  count = var.enable_rds_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-rds-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5368709120 # 5 GB in bytes
  alarm_description   = "RDS free storage is below 5GB - database may run out of space"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-rds-storage-low"
    Severity = "critical"
  }
}

# Database Freeable Memory Low
resource "aws_cloudwatch_metric_alarm" "rds_memory_low" {
  count = var.enable_rds_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-rds-memory-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "FreeableMemory"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 104857600 # 100 MB in bytes
  alarm_description   = "RDS freeable memory is below 100MB - database may experience memory pressure"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-rds-memory-low"
    Severity = "warning"
  }
}

# =============================================================================
# AWS Cost Alarms (Monthly Budget Thresholds)
# =============================================================================

# Warning threshold ($100)
resource "aws_cloudwatch_metric_alarm" "cost_warning" {
  count = var.enable_cost_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-cost-warning"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 21600 # 6 hours
  statistic           = "Maximum"
  threshold           = var.cost_threshold_warning
  alarm_description   = "Estimated monthly AWS charges exceed $${var.cost_threshold_warning} - review usage"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Currency = "USD"
  }

  alarm_actions = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-cost-warning"
    Severity = "warning"
  }
}

# Alert threshold ($250)
resource "aws_cloudwatch_metric_alarm" "cost_alert" {
  count = var.enable_cost_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-cost-alert"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 21600 # 6 hours
  statistic           = "Maximum"
  threshold           = var.cost_threshold_alert
  alarm_description   = "Estimated monthly AWS charges exceed $${var.cost_threshold_alert} - immediate review needed"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Currency = "USD"
  }

  alarm_actions = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-cost-alert"
    Severity = "high"
  }
}

# Critical threshold ($500)
resource "aws_cloudwatch_metric_alarm" "cost_critical" {
  count = var.enable_cost_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-cost-critical"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 21600 # 6 hours
  statistic           = "Maximum"
  threshold           = var.cost_threshold_critical
  alarm_description   = "Estimated monthly AWS charges exceed $${var.cost_threshold_critical} - CRITICAL: take immediate action"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Currency = "USD"
  }

  alarm_actions = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-cost-critical"
    Severity = "critical"
  }
}

# =============================================================================
# Worker Task Queue Depth Alarms (Custom Metric)
# =============================================================================

# Custom CloudWatch metric for task queue depth
# Note: This metric must be published by the API service
resource "aws_cloudwatch_metric_alarm" "task_queue_depth" {
  count = var.enable_task_queue_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-task-queue-depth-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TaskQueueDepth"
  namespace           = "WorkerMill"
  period              = 300
  statistic           = "Average"
  threshold           = var.task_queue_threshold
  alarm_description   = "Worker task queue depth exceeds ${var.task_queue_threshold} - tasks may be backing up"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Environment = var.environment
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-task-queue-depth-high"
    Severity = "warning"
  }
}

# Task failure rate alarm
resource "aws_cloudwatch_metric_alarm" "task_failure_rate" {
  count = var.enable_task_queue_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-task-failure-rate-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 25 # 25% failure rate
  alarm_description   = "Worker task failure rate exceeds 25% - investigate task execution issues"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "e1"
    expression  = "(m1/(m1+m2))*100"
    label       = "Task Failure Rate (%)"
    return_data = true
  }

  metric_query {
    id = "m1"
    metric {
      metric_name = "TasksFailed"
      namespace   = "WorkerMill"
      period      = 300
      stat        = "Sum"

      dimensions = {
        Environment = var.environment
      }
    }
  }

  metric_query {
    id = "m2"
    metric {
      metric_name = "TasksCompleted"
      namespace   = "WorkerMill"
      period      = 300
      stat        = "Sum"

      dimensions = {
        Environment = var.environment
      }
    }
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = {
    Name     = "${local.alarm_prefix}-task-failure-rate-high"
    Severity = "warning"
  }
}

# =============================================================================
# CloudWatch Dashboard for Monitoring Overview
# =============================================================================

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${local.alarm_prefix}-monitoring"

  dashboard_body = jsonencode({
    widgets = [
      # Row 1: ECS Overview
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 8
        height = 6
        properties = {
          title  = "ECS API - CPU & Memory"
          region = data.aws_region.current.name
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", var.ecs_api_service_name, { label = "CPU %" }],
            ["AWS/ECS", "MemoryUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", var.ecs_api_service_name, { label = "Memory %" }]
          ]
          period = 300
          stat   = "Average"
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 0
        width  = 8
        height = 6
        properties = {
          title  = "ALB - Request Count & Errors"
          region = data.aws_region.current.name
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix, { label = "Requests" }],
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", var.alb_arn_suffix, { label = "5xx Errors", color = "#d62728" }],
            ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", var.alb_arn_suffix, { label = "4xx Errors", color = "#ff7f0e" }]
          ]
          period = 300
          stat   = "Sum"
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 0
        width  = 8
        height = 6
        properties = {
          title  = "ALB - Response Time (p95)"
          region = data.aws_region.current.name
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.target_group_arn_suffix, { label = "Response Time" }]
          ]
          period = 300
          stat   = "p95"
        }
      },
      # Row 2: RDS Overview
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 8
        height = 6
        properties = {
          title  = "RDS - CPU & Connections"
          region = data.aws_region.current.name
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.rds_instance_identifier, { label = "CPU %" }],
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.rds_instance_identifier, { label = "Connections", yAxis = "right" }]
          ]
          period = 300
          stat   = "Average"
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 6
        width  = 8
        height = 6
        properties = {
          title  = "RDS - Storage & Memory"
          region = data.aws_region.current.name
          metrics = [
            ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", var.rds_instance_identifier, { label = "Free Storage (bytes)" }],
            ["AWS/RDS", "FreeableMemory", "DBInstanceIdentifier", var.rds_instance_identifier, { label = "Freeable Memory (bytes)", yAxis = "right" }]
          ]
          period = 300
          stat   = "Average"
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 6
        width  = 8
        height = 6
        properties = {
          title  = "Worker Tasks"
          region = data.aws_region.current.name
          metrics = [
            ["WorkerMill", "TaskQueueDepth", "Environment", var.environment, { label = "Queue Depth" }],
            ["WorkerMill", "TasksCompleted", "Environment", var.environment, { label = "Completed", color = "#2ca02c" }],
            ["WorkerMill", "TasksFailed", "Environment", var.environment, { label = "Failed", color = "#d62728" }]
          ]
          period = 300
          stat   = "Sum"
        }
      },
      # Row 3: Alarms Status
      {
        type   = "alarm"
        x      = 0
        y      = 12
        width  = 24
        height = 4
        properties = {
          title = "Alarm Status"
          alarms = concat(
            var.enable_ecs_alarms ? [
              aws_cloudwatch_metric_alarm.ecs_api_running_tasks[0].arn,
              aws_cloudwatch_metric_alarm.ecs_api_cpu_high[0].arn,
              aws_cloudwatch_metric_alarm.ecs_api_memory_high[0].arn
            ] : [],
            var.enable_alb_alarms ? [
              aws_cloudwatch_metric_alarm.alb_5xx_errors[0].arn,
              aws_cloudwatch_metric_alarm.alb_target_response_time[0].arn,
              aws_cloudwatch_metric_alarm.alb_unhealthy_hosts[0].arn
            ] : [],
            var.enable_rds_alarms ? [
              aws_cloudwatch_metric_alarm.rds_connections_high[0].arn,
              aws_cloudwatch_metric_alarm.rds_cpu_high[0].arn,
              aws_cloudwatch_metric_alarm.rds_storage_low[0].arn
            ] : []
          )
        }
      }
    ]
  })
}
