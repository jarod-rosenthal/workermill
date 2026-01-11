output "function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.webhook_dispatcher.function_name
}

output "function_arn" {
  description = "Lambda function ARN"
  value       = aws_lambda_function.webhook_dispatcher.arn
}

output "function_url" {
  description = "Lambda function URL (webhook endpoint)"
  value       = aws_lambda_function_url.webhook.function_url
}

output "log_group_name" {
  description = "CloudWatch log group name"
  value       = aws_cloudwatch_log_group.lambda.name
}
