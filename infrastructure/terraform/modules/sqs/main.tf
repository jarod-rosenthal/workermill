# =============================================================================
# SQS Queue for Worker Jobs
# =============================================================================

# Dead Letter Queue for failed jobs
resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "workermill-${var.environment}-jobs-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Name = "workermill-${var.environment}-jobs-dlq"
  }
}

# Main job queue
resource "aws_sqs_queue" "jobs" {
  name                       = "workermill-${var.environment}-jobs"
  visibility_timeout_seconds = 900    # 15 minutes (workers can take a while)
  message_retention_seconds  = 345600 # 4 days
  receive_wait_time_seconds  = 20     # Long polling

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name = "workermill-${var.environment}-jobs"
  }
}

# High priority queue for urgent jobs
resource "aws_sqs_queue" "jobs_priority" {
  name                       = "workermill-${var.environment}-jobs-priority"
  visibility_timeout_seconds = 900
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name = "workermill-${var.environment}-jobs-priority"
  }
}
