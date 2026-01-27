output "db_credentials_arn" {
  description = "ARN of database credentials secret"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "database_url_arn" {
  description = "ARN of database URL secret"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "anthropic_api_key_arn" {
  description = "ARN of Anthropic API key secret"
  value       = aws_secretsmanager_secret.anthropic_api_key.arn
}

output "github_token_arn" {
  description = "ARN of GitHub token secret"
  value       = aws_secretsmanager_secret.github_token.arn
}

output "jira_credentials_arn" {
  description = "ARN of Jira credentials secret"
  value       = aws_secretsmanager_secret.jira_credentials.arn
}

output "jwt_secret_arn" {
  description = "ARN of JWT secret"
  value       = aws_secretsmanager_secret.jwt_secret.arn
}

output "session_secret_arn" {
  description = "ARN of session secret"
  value       = aws_secretsmanager_secret.session_secret.arn
}

output "email_webhook_secret_arn" {
  description = "ARN of email webhook secret"
  value       = aws_secretsmanager_secret.email_webhook_secret.arn
}

output "email_webhook_secret_value" {
  description = "Value of email webhook secret (for SES Lambda)"
  value       = random_password.email_webhook_secret.result
  sensitive   = true
}

output "stripe_secret_key_arn" {
  description = "ARN of Stripe secret key"
  value       = aws_secretsmanager_secret.stripe_secret_key.arn
}

output "stripe_webhook_secret_arn" {
  description = "ARN of Stripe webhook secret"
  value       = aws_secretsmanager_secret.stripe_webhook_secret.arn
}

output "secrets_prefix" {
  description = "Secrets Manager prefix for this environment"
  value       = "workermill/${var.environment}"
}

output "all_secret_arns" {
  description = "All secret ARNs for IAM policies"
  value = [
    aws_secretsmanager_secret.db_credentials.arn,
    aws_secretsmanager_secret.database_url.arn,
    aws_secretsmanager_secret.anthropic_api_key.arn,
    aws_secretsmanager_secret.github_token.arn,
    aws_secretsmanager_secret.jira_credentials.arn,
    aws_secretsmanager_secret.jwt_secret.arn,
    aws_secretsmanager_secret.session_secret.arn,
    aws_secretsmanager_secret.email_webhook_secret.arn,
    aws_secretsmanager_secret.stripe_secret_key.arn,
    aws_secretsmanager_secret.stripe_webhook_secret.arn,
  ]
}
