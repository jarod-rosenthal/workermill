# SES Inbound Email Module Outputs

output "ses_verification_token" {
  description = "SES domain identity verification token for DNS TXT record"
  value       = aws_ses_domain_identity.main.verification_token
}

output "email_bucket_name" {
  description = "Name of the S3 bucket for storing emails"
  value       = aws_s3_bucket.email_storage.id
}

output "email_bucket_arn" {
  description = "ARN of the S3 bucket for storing emails"
  value       = aws_s3_bucket.email_storage.arn
}

output "sns_topic_arn" {
  description = "ARN of the SNS topic for email notifications"
  value       = aws_sns_topic.email_notifications.arn
}

output "lambda_function_arn" {
  description = "ARN of the Lambda function that processes emails"
  value       = aws_lambda_function.email_processor.arn
}

output "lambda_function_name" {
  description = "Name of the Lambda function that processes emails"
  value       = aws_lambda_function.email_processor.function_name
}

output "receipt_rule_set_name" {
  description = "Name of the SES receipt rule set"
  value       = aws_ses_receipt_rule_set.main.rule_set_name
}

output "mx_record_value" {
  description = "MX record value to add to DNS for receiving emails"
  value       = "10 inbound-smtp.${data.aws_region.current.name}.amazonaws.com"
}

output "email_addresses" {
  description = "Email address patterns configured for receiving"
  value = {
    task_email = "task@${var.domain_name}"
    backend    = "backend@${var.domain_name}"
    frontend   = "frontend@${var.domain_name}"
  }
}
