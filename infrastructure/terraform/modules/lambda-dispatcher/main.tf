# =============================================================================
# Lambda Webhook Dispatcher
# Receives Jira webhooks and dispatches jobs to SQS
# =============================================================================

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# IAM Role for Lambda
resource "aws_iam_role" "lambda" {
  name = "workermill-${var.environment}-webhook-dispatcher"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = {
    Name = "workermill-${var.environment}-webhook-dispatcher"
  }
}

# Lambda permissions
resource "aws_iam_role_policy" "lambda" {
  name = "workermill-${var.environment}-webhook-dispatcher"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/workermill-${var.environment}-*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = [
          var.jobs_queue_arn,
          var.priority_queue_arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:workermill/${var.environment}/*"
      }
    ]
  })
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/workermill-${var.environment}-webhook-dispatcher"
  retention_in_days = 14

  tags = {
    Name = "workermill-${var.environment}-webhook-dispatcher"
  }
}

# Lambda Function
resource "aws_lambda_function" "webhook_dispatcher" {
  function_name = "workermill-${var.environment}-webhook-dispatcher"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 30
  memory_size   = 256

  # Placeholder - will be updated with actual code
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  environment {
    variables = {
      ENVIRONMENT        = var.environment
      JOBS_QUEUE_URL     = var.jobs_queue_url
      PRIORITY_QUEUE_URL = var.priority_queue_url
      JIRA_SECRET_NAME   = "workermill/${var.environment}/jira-credentials"
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]

  tags = {
    Name = "workermill-${var.environment}-webhook-dispatcher"
  }
}

# Placeholder code archive
data "archive_file" "lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/lambda_placeholder.zip"

  source {
    content = <<-EOF
      exports.handler = async (event) => {
        console.log('Webhook received:', JSON.stringify(event, null, 2));
        return {
          statusCode: 200,
          body: JSON.stringify({ message: 'Placeholder - deploy actual code' })
        };
      };
    EOF
    filename = "index.js"
  }
}

# Lambda Function URL (alternative to API Gateway - free!)
resource "aws_lambda_function_url" "webhook" {
  function_name      = aws_lambda_function.webhook_dispatcher.function_name
  authorization_type = "NONE" # Jira webhooks don't support IAM auth

  cors {
    allow_credentials = false
    allow_origins     = ["*"]
    allow_methods     = ["POST"]
    allow_headers     = ["*"]
    max_age           = 86400
  }
}
