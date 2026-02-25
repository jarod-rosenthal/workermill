/**
 * Cognito Pre-Sign-Up Lambda Module
 *
 * Creates a Lambda function that validates user invitations before
 * allowing Cognito account creation. This enforces invite-only access
 * to the platform.
 *
 * Architecture:
 * - Lambda deployed in VPC private subnets for RDS access
 * - Security group allows outbound to RDS on port 5432
 * - IAM role with minimal permissions (logs, VPC ENI, secrets)
 * - Cognito Pre-Sign-Up trigger integration
 */

locals {
  function_name = "workermill-${var.environment}-cognito-presignup"

  default_tags = {
    Module      = "cognito-presignup"
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  tags = merge(local.default_tags, var.tags)
}

# -----------------------------------------------------------------------------
# IAM Role for Lambda
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = local.tags
}

# CloudWatch Logs permissions
data "aws_iam_policy_document" "lambda_logs" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = [
      "${aws_cloudwatch_log_group.lambda.arn}:*"
    ]
  }
}

resource "aws_iam_role_policy" "lambda_logs" {
  name   = "cloudwatch-logs"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_logs.json
}

# VPC ENI permissions (required for Lambda in VPC)
data "aws_iam_policy_document" "lambda_vpc" {
  statement {
    effect = "Allow"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "lambda_vpc" {
  name   = "vpc-access"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_vpc.json
}

# -----------------------------------------------------------------------------
# Security Group for Lambda
# -----------------------------------------------------------------------------

resource "aws_security_group" "lambda" {
  name        = "${local.function_name}-sg"
  description = "Security group for Cognito pre-signup Lambda"
  vpc_id      = var.vpc_id

  # Outbound to RDS
  egress {
    description     = "PostgreSQL to RDS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.rds_security_group_id]
  }

  # Outbound HTTPS for AWS API calls (Secrets Manager, etc.)
  egress {
    description = "HTTPS for AWS APIs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${local.function_name}-sg"
  })
}

# Allow Lambda security group to access RDS
resource "aws_security_group_rule" "rds_from_lambda" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.lambda.id
  security_group_id        = var.rds_security_group_id
  description              = "PostgreSQL from Cognito pre-signup Lambda"
}

# -----------------------------------------------------------------------------
# CloudWatch Log Group
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days

  tags = local.tags
}

# -----------------------------------------------------------------------------
# Lambda Layer for pg8000 (PostgreSQL driver)
# -----------------------------------------------------------------------------

# Create the layer package
# pg8000 is a pure Python PostgreSQL driver (no native compilation needed)
resource "null_resource" "lambda_layer" {
  triggers = {
    requirements = filemd5("${path.module}/lambda/index.py")
  }

  provisioner "local-exec" {
    command = <<-EOT
      rm -rf ${path.module}/lambda/layer
      mkdir -p ${path.module}/lambda/layer/python
      pip install pg8000 -t ${path.module}/lambda/layer/python --quiet
    EOT
  }
}

data "archive_file" "lambda_layer" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/layer"
  output_path = "${path.module}/lambda/layer.zip"

  depends_on = [null_resource.lambda_layer]
}

resource "aws_lambda_layer_version" "pg8000" {
  layer_name          = "workermill-${var.environment}-pg8000"
  filename            = data.archive_file.lambda_layer.output_path
  compatible_runtimes = ["python3.11", "python3.12"]
  description         = "pg8000 PostgreSQL driver for Python"

  depends_on = [null_resource.lambda_layer]

  lifecycle {
    ignore_changes = [source_code_hash]
  }
}

# -----------------------------------------------------------------------------
# Lambda Function
# -----------------------------------------------------------------------------

data "archive_file" "lambda_function" {
  type        = "zip"
  source_file = "${path.module}/lambda/index.py"
  output_path = "${path.module}/lambda/function.zip"
}

resource "aws_lambda_function" "presignup" {
  function_name    = local.function_name
  filename         = data.archive_file.lambda_function.output_path
  source_code_hash = data.archive_file.lambda_function.output_base64sha256
  handler          = "index.lambda_handler"
  runtime          = "python3.11"
  role             = aws_iam_role.lambda.arn
  timeout          = 10
  memory_size      = 256

  layers = [aws_lambda_layer_version.pg8000.arn]

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DB_HOST     = var.db_host
      DB_PORT     = tostring(var.db_port)
      DB_NAME     = var.db_name
      DB_USER     = var.db_username
      DB_PASSWORD = var.db_password
    }
  }

  depends_on = [
    aws_iam_role_policy.lambda_logs,
    aws_iam_role_policy.lambda_vpc,
    aws_cloudwatch_log_group.lambda
  ]

  # Ignore environment changes - password was manually corrected
  # TODO: Sync db-credentials secret with actual RDS password
  lifecycle {
    ignore_changes = [environment, source_code_hash, layers]
  }

  tags = local.tags
}

# Note: Lambda permission is created in the cognito module to avoid circular dependency
