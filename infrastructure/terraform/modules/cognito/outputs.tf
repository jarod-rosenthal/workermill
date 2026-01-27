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
  value       = local.domain_name
}

output "hosted_ui_url" {
  description = "Cognito Hosted UI URL"
  value       = local.hosted_ui_base_url
}

output "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN for custom domain (null if using prefix domain)"
  value       = var.custom_domain != "" ? aws_cognito_user_pool_domain.custom[0].cloudfront_distribution_arn : null
}

output "cloudfront_distribution_domain" {
  description = "CloudFront distribution domain for custom domain Route53 alias (null if using prefix domain)"
  value       = var.custom_domain != "" ? aws_cognito_user_pool_domain.custom[0].cloudfront_distribution : null
}

output "google_enabled" {
  description = "Whether Google SSO is enabled"
  value       = var.google_client_id != ""
}

output "microsoft_enabled" {
  description = "Whether Microsoft SSO is enabled"
  value       = var.microsoft_client_id != ""
}

output "oauth_callback_url" {
  description = "OAuth callback URL for identity providers"
  value       = "${local.hosted_ui_base_url}/oauth2/idpresponse"
}
