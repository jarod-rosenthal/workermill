output "security_group_id" {
  description = "ID of the GPU security group"
  value       = aws_security_group.gpu.id
}

output "iam_role_arn" {
  description = "ARN of the GPU instance IAM role"
  value       = aws_iam_role.gpu.arn
}

output "launch_template_id" {
  description = "ID of the launch template"
  value       = aws_launch_template.gpu.id
}

output "spot_fleet_request_id" {
  description = "ID of the spot fleet request (if created)"
  value       = var.create_instance ? aws_spot_fleet_request.gpu[0].id : null
}

output "instance_id" {
  description = "ID of the GPU instance (if created)"
  value       = var.create_instance && length(data.aws_instances.gpu[0].ids) > 0 ? data.aws_instances.gpu[0].ids[0] : null
}

output "instance_private_ip" {
  description = "Private IP of the GPU instance (if created)"
  value       = var.create_instance && length(data.aws_instances.gpu[0].private_ips) > 0 ? data.aws_instances.gpu[0].private_ips[0] : null
}

output "ssm_connect_command" {
  description = "Command to connect via SSM"
  value       = var.create_instance && length(data.aws_instances.gpu[0].ids) > 0 ? "aws ssm start-session --target ${data.aws_instances.gpu[0].ids[0]} --region ${var.region}" : null
}
