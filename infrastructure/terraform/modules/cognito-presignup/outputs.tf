output "lambda_function_arn" {
  description = "ARN of the pre-signup Lambda function"
  value       = aws_lambda_function.presignup.arn
}

output "lambda_function_name" {
  description = "Name of the pre-signup Lambda function"
  value       = aws_lambda_function.presignup.function_name
}

output "lambda_security_group_id" {
  description = "Security group ID of the Lambda function"
  value       = aws_security_group.lambda.id
}

output "lambda_role_arn" {
  description = "ARN of the Lambda IAM role"
  value       = aws_iam_role.lambda.arn
}
