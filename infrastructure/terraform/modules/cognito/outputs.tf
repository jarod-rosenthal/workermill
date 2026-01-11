output "user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_endpoint" {
  description = "Cognito User Pool endpoint"
  value       = aws_cognito_user_pool.main.endpoint
}

output "web_client_id" {
  description = "Cognito User Pool Client ID for web app"
  value       = aws_cognito_user_pool_client.web.id
}

output "api_client_id" {
  description = "Cognito User Pool Client ID for API"
  value       = aws_cognito_user_pool_client.api.id
}

output "api_client_secret" {
  description = "Cognito User Pool Client Secret for API"
  value       = aws_cognito_user_pool_client.api.client_secret
  sensitive   = true
}

output "domain" {
  description = "Cognito User Pool domain"
  value       = aws_cognito_user_pool_domain.main.domain
}

output "hosted_ui_url" {
  description = "Cognito Hosted UI URL"
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

data "aws_region" "current" {}
