# =============================================================================
# Data Sources
# =============================================================================

data "aws_region" "current" {}

# =============================================================================
# Cognito User Pool for Authentication
# =============================================================================

resource "aws_cognito_user_pool" "main" {
  name = "workermill-${var.environment}"

  # Username settings
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Password policy
  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  # MFA - optional for users
  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Email configuration - use Cognito's default email (free tier)
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Schema attributes
  schema {
    name                     = "email"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    name                     = "name"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = false
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # Verification message
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "WorkerMill - Verify your email"
    email_message        = "Your verification code is {####}"
  }

  # User pool add-ons
  user_pool_add_ons {
    advanced_security_mode = "OFF" # Cost optimization - use ENFORCED for production
  }

  tags = {
    Name = "workermill-${var.environment}"
  }
}

# =============================================================================
# User Pool Domain (for hosted UI)
# =============================================================================

# Prefix domain (used when custom_domain is not set)
resource "aws_cognito_user_pool_domain" "prefix" {
  count = var.custom_domain == "" ? 1 : 0

  domain       = "workermill-${var.environment}-${random_string.domain_suffix.result}"
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "random_string" "domain_suffix" {
  length  = 8
  special = false
  upper   = false
}

# Custom domain (used when custom_domain is set)
resource "aws_cognito_user_pool_domain" "custom" {
  count = var.custom_domain != "" ? 1 : 0

  domain          = var.custom_domain
  certificate_arn = var.certificate_arn
  user_pool_id    = aws_cognito_user_pool.main.id
}

# Local to get the active domain
locals {
  domain_name = var.custom_domain != "" ? var.custom_domain : "workermill-${var.environment}-${random_string.domain_suffix.result}"
  hosted_ui_base_url = var.custom_domain != "" ? "https://${var.custom_domain}" : "https://${local.domain_name}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

# =============================================================================
# Google Identity Provider
# =============================================================================

resource "aws_cognito_identity_provider" "google" {
  count = var.google_client_id != "" ? 1 : 0

  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "profile email openid"
  }

  # Map Google attributes to Cognito attributes
  attribute_mapping = {
    email    = "email"
    name     = "name"
    username = "sub"
  }
}

# =============================================================================
# Microsoft Identity Provider (Azure AD / Microsoft Entra ID)
# =============================================================================

resource "aws_cognito_identity_provider" "microsoft" {
  count = var.microsoft_client_id != "" ? 1 : 0

  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Microsoft"
  provider_type = "OIDC"

  provider_details = {
    client_id                     = var.microsoft_client_id
    client_secret                 = var.microsoft_client_secret
    authorize_scopes              = "openid profile email"
    oidc_issuer                   = "https://login.microsoftonline.com/${var.microsoft_tenant_id}/v2.0"
    attributes_request_method     = "GET"
    authorize_url                 = "https://login.microsoftonline.com/${var.microsoft_tenant_id}/oauth2/v2.0/authorize"
    token_url                     = "https://login.microsoftonline.com/${var.microsoft_tenant_id}/oauth2/v2.0/token"
    attributes_url                = "https://graph.microsoft.com/oidc/userinfo"
    jwks_uri                      = "https://login.microsoftonline.com/${var.microsoft_tenant_id}/discovery/v2.0/keys"
  }

  # Map Microsoft attributes to Cognito attributes
  attribute_mapping = {
    email    = "email"
    name     = "name"
    username = "sub"
  }
}

# Local to determine supported identity providers
locals {
  identity_providers = concat(
    ["COGNITO"],
    var.google_client_id != "" ? ["Google"] : [],
    var.microsoft_client_id != "" ? ["Microsoft"] : []
  )
}

# =============================================================================
# User Pool Client (Web App)
# =============================================================================

resource "aws_cognito_user_pool_client" "web" {
  name         = "workermill-${var.environment}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  # Token validity - extended for better UX
  access_token_validity  = 24   # hours (max allowed)
  id_token_validity      = 24   # hours (max allowed)
  refresh_token_validity = 365  # days (1 year)

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # OAuth flows
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = local.identity_providers

  # Ensure identity providers are created before the client references them
  depends_on = [
    aws_cognito_identity_provider.google,
    aws_cognito_identity_provider.microsoft
  ]

  # Callback URLs
  callback_urls = [
    "https://${var.domain_name}/auth/callback",
    "https://${var.domain_name}/",
    "http://localhost:3000/auth/callback", # Local dev
    "http://localhost:5173/auth/callback", # Vite dev
  ]

  logout_urls = [
    "https://${var.domain_name}/",
    "http://localhost:3000/",
    "http://localhost:5173/",
  ]

  # Security settings
  generate_secret                      = false # Public client (SPA)
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  enable_propagate_additional_user_context_data = false

  # Auth flows
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]
}

# =============================================================================
# User Pool Client (API/Backend)
# =============================================================================

resource "aws_cognito_user_pool_client" "api" {
  name         = "workermill-${var.environment}-api"
  user_pool_id = aws_cognito_user_pool.main.id

  # Token validity - extended for better UX
  access_token_validity  = 24   # hours (max allowed)
  id_token_validity      = 24   # hours (max allowed)
  refresh_token_validity = 365  # days (1 year)

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Security settings - server-side client with secret
  generate_secret               = true
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  # Auth flows for backend
  explicit_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}
