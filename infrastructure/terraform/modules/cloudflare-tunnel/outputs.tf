output "security_group_id" {
  description = "Security group ID of the cloudflared connector"
  value       = aws_security_group.cloudflared.id
}

output "service_name" {
  description = "ECS service name for the cloudflared connector"
  value       = aws_ecs_service.cloudflared.name
}
