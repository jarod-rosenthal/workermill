output "security_group_id" {
  description = "Security group ID for the bastion (add to RDS allowed security groups)"
  value       = aws_security_group.bastion.id
}

output "asg_name" {
  description = "Auto Scaling Group name"
  value       = aws_autoscaling_group.bastion.name
}

output "lambda_function_name" {
  description = "Lambda function name for start/stop control"
  value       = aws_lambda_function.bastion_control.function_name
}

output "lambda_function_arn" {
  description = "Lambda function ARN"
  value       = aws_lambda_function.bastion_control.arn
}

output "cli_commands" {
  description = "CLI commands to control the bastion (auto-whitelists your IP on start)"
  value = {
    start     = "aws lambda invoke --function-name ${aws_lambda_function.bastion_control.function_name} --payload '{\"action\":\"start\"}' --cli-binary-format raw-in-base64-out /dev/stdout 2>&1 | head -1 | jq"
    stop      = "aws lambda invoke --function-name ${aws_lambda_function.bastion_control.function_name} --payload '{\"action\":\"stop\"}' --cli-binary-format raw-in-base64-out /dev/stdout 2>&1 | head -1 | jq"
    status    = "aws lambda invoke --function-name ${aws_lambda_function.bastion_control.function_name} --payload '{\"action\":\"status\"}' --cli-binary-format raw-in-base64-out /dev/stdout 2>&1 | head -1 | jq"
    whitelist = "aws lambda invoke --function-name ${aws_lambda_function.bastion_control.function_name} --payload '{\"action\":\"whitelist\"}' --cli-binary-format raw-in-base64-out /dev/stdout 2>&1 | head -1 | jq"
  }
}
