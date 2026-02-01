output "security_group_id" {
  description = "Security group ID of the GitHub runner (add to RDS allowed SGs)"
  value       = aws_security_group.runner.id
}

output "instance_id" {
  description = "EC2 instance ID of the runner"
  value       = aws_instance.runner.id
}

output "private_ip" {
  description = "Private IP address of the runner"
  value       = aws_instance.runner.private_ip
}

output "iam_role_arn" {
  description = "IAM role ARN for the runner"
  value       = aws_iam_role.runner.arn
}

output "log_group_name" {
  description = "CloudWatch log group name for runner logs"
  value       = aws_cloudwatch_log_group.runner.name
}
