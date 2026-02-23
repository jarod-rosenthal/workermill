output "endpoint" {
  description = "Redis primary endpoint address"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "port" {
  description = "Redis port"
  value       = aws_elasticache_replication_group.main.port
}

output "redis_url" {
  description = "Full Redis connection URL (TLS)"
  value       = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:${aws_elasticache_replication_group.main.port}"
}

output "security_group_id" {
  description = "Security group ID for the Redis cluster"
  value       = aws_security_group.redis.id
}
