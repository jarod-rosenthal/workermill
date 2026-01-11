output "jobs_queue_url" {
  description = "URL of the main jobs queue"
  value       = aws_sqs_queue.jobs.url
}

output "jobs_queue_arn" {
  description = "ARN of the main jobs queue"
  value       = aws_sqs_queue.jobs.arn
}

output "jobs_queue_name" {
  description = "Name of the main jobs queue"
  value       = aws_sqs_queue.jobs.name
}

output "priority_queue_url" {
  description = "URL of the priority jobs queue"
  value       = aws_sqs_queue.jobs_priority.url
}

output "priority_queue_arn" {
  description = "ARN of the priority jobs queue"
  value       = aws_sqs_queue.jobs_priority.arn
}

output "dlq_url" {
  description = "URL of the dead letter queue"
  value       = aws_sqs_queue.jobs_dlq.url
}

output "dlq_arn" {
  description = "ARN of the dead letter queue"
  value       = aws_sqs_queue.jobs_dlq.arn
}
