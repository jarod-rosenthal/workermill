# =============================================================================
# Secrets Manager - All application secrets
# =============================================================================
# Manual secrets created with placeholder values. Update via AWS Console or CLI:
#   aws secretsmanager put-secret-value --secret-id <name> --secret-string '<value>'
# =============================================================================

# Database credentials
resource "aws_secretsmanager_secret" "db_credentials" {
  name                    = "workermill/${var.environment}/db-credentials"
  recovery_window_in_days = 0

  tags = {
    Name = "workermill-${var.environment}-db-credentials"
  }
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = var.db_password
    host     = var.db_host
    port     = var.db_port
    database = var.db_name
  })
}

# Database URL (convenience format for ORMs)
resource "aws_secretsmanager_secret" "database_url" {
  name                    = "workermill/${var.environment}/database-url"
  recovery_window_in_days = 0

  tags = {
    Name = "workermill-${var.environment}-database-url"
  }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://${var.db_username}:${var.db_password}@${var.db_host}:${var.db_port}/${var.db_name}"
}

# Anthropic API Key (for AI workers)
resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name                    = "workermill/${var.environment}/anthropic-api-key"
  recovery_window_in_days = 0

  tags = {
    Name = "workermill-${var.environment}-anthropic-api-key"
  }
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = "PLACEHOLDER_UPDATE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# GitHub Token (for AI workers to create PRs)
resource "aws_secretsmanager_secret" "github_token" {
  name                    = "workermill/${var.environment}/github-token"
  recovery_window_in_days = 0

  tags = {
    Name = "workermill-${var.environment}-github-token"
  }
}

resource "aws_secretsmanager_secret_version" "github_token" {
  secret_id     = aws_secretsmanager_secret.github_token.id
  secret_string = "PLACEHOLDER_UPDATE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Jira Credentials (for task source integration)
resource "aws_secretsmanager_secret" "jira_credentials" {
  name                    = "workermill/${var.environment}/jira-credentials"
  recovery_window_in_days = 0

  tags = {
    Name = "workermill-${var.environment}-jira-credentials"
  }
}

resource "aws_secretsmanager_secret_version" "jira_credentials" {
  secret_id = aws_secretsmanager_secret.jira_credentials.id
  secret_string = jsonencode({
    domain    = "PLACEHOLDER_UPDATE_ME"
    email     = "PLACEHOLDER_UPDATE_ME"
    api_token = "PLACEHOLDER_UPDATE_ME"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# JWT Secret (for API authentication)
resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "workermill/${var.environment}/jwt-secret"
  recovery_window_in_days = 0

  tags = {
    Name = "workermill-${var.environment}-jwt-secret"
  }
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result
}

# Session Secret (for web sessions)
resource "random_password" "session_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "session_secret" {
  name                    = "workermill/${var.environment}/session-secret"
  recovery_window_in_days = 0

  tags = {
    Name = "workermill-${var.environment}-session-secret"
  }
}

resource "aws_secretsmanager_secret_version" "session_secret" {
  secret_id     = aws_secretsmanager_secret.session_secret.id
  secret_string = random_password.session_secret.result
}
