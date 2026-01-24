data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "workermill-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "disabled" # Cost savings
  }

  tags = {
    Name = "workermill-${var.environment}"
  }
}

# ECS Cluster Capacity Providers
resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE_SPOT" # Cost savings
  }
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/workermill-${var.environment}/api"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/workermill-${var.environment}/worker"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "war_room" {
  name              = "/ecs/workermill-${var.environment}/war-room"
  retention_in_days = 14
}

# ECS Task Execution Role
resource "aws_iam_role" "ecs_execution" {
  name = "workermill-${var.environment}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "secrets-access"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [var.secrets_arn_pattern]
      }
    ]
  })
}

# ECS Task Role (for the application)
resource "aws_iam_role" "ecs_task" {
  name = "workermill-${var.environment}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "ecs_task" {
  name = "workermill-${var.environment}-ecs-task"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:GetLogEvents"
        ]
        Resource = [
          "${aws_cloudwatch_log_group.api.arn}:*",
          "${aws_cloudwatch_log_group.worker.arn}:*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:DescribeTasks",
          "ecs:RunTask",
          "ecs:StopTask",
          "ecs:TagResource"
        ]
        Resource = "*"
        Condition = {
          ArnEquals = {
            "ecs:cluster" = aws_ecs_cluster.main.arn
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = [
          aws_iam_role.ecs_execution.arn,
          aws_iam_role.ecs_task.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:CreateSecret",
          "secretsmanager:UpdateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [var.secrets_arn_pattern]
      },
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel"
        ]
        Resource = "*"
      },
      # ECR permissions for workers to push Docker images via Kaniko
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ]
        Resource = "arn:aws:ecr:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:repository/workermill-*"
      },
      # ECS permissions for workers to trigger deployments
      {
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices"
        ]
        Resource = "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:service/workermill-*"
      },
      # =============================================================================
      # OnCallShift Deployment Permissions (same AWS account, different VPC)
      # Workers need these to deploy the oncallshift application
      # =============================================================================
      # S3 permissions for frontend deployment
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::oncallshift-*",
          "arn:aws:s3:::oncallshift-*/*"
        ]
      },
      # CloudFront invalidation for frontend deployments
      {
        Effect = "Allow"
        Action = [
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
          "cloudfront:ListInvalidations"
        ]
        Resource = "*"
      },
      # ECR permissions for oncallshift container images
      # Note: OnCallShift resources use BOTH patterns - oncallshift-* and pagerduty-lite-*
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
          "ecr:ListImages",
          "ecr:CreateRepository"
        ]
        Resource = [
          "arn:aws:ecr:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:repository/oncallshift-*",
          "arn:aws:ecr:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:repository/pagerduty-lite-*"
        ]
      },
      # ECS permissions for oncallshift backend deployments
      {
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:DescribeTasks",
          "ecs:ListTasks"
        ]
        Resource = [
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:service/oncallshift-*/*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:service/pagerduty-lite-*/*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task/oncallshift-*/*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task/pagerduty-lite-*/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:DescribeClusters"
        ]
        Resource = [
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:cluster/oncallshift-*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:cluster/pagerduty-lite-*"
        ]
      },
      # =============================================================================
      # Worker State Checkpointing
      # S3 permissions for saving/loading task state checkpoints
      # =============================================================================
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::workermill-${var.environment}-worker-state-*",
          "arn:aws:s3:::workermill-${var.environment}-worker-state-*/*"
        ]
      },
      # =============================================================================
      # SES Email Sending Permissions
      # API service can send emails for notifications, alerts, and invites
      # =============================================================================
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
      }
    ]
  })
}

# =============================================================================
# Worker Task Role (MINIMAL - for AI worker containers only)
# This role has extremely limited permissions. Workers assume customer roles
# for actual deployments via STS AssumeRole.
# =============================================================================
resource "aws_iam_role" "ecs_worker_task" {
  name = "workermill-${var.environment}-worker-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "ecs_worker_task" {
  name = "workermill-${var.environment}-worker-task"
  role = aws_iam_role.ecs_worker_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # CloudWatch Logs - Workers and War Room can write their own logs
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = [
          "${aws_cloudwatch_log_group.worker.arn}:*",
          "${aws_cloudwatch_log_group.war_room.arn}:*"
        ]
      },
      # SSM for ECS Exec debugging (optional, can be removed in production)
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel"
        ]
        Resource = "*"
      },
      # STS AssumeRole - Workers can assume customer IAM roles for deployments
      # The external ID validation happens on the customer's role trust policy
      {
        Effect = "Allow"
        Action = [
          "sts:AssumeRole"
        ]
        Resource = "*"
        Condition = {
          # Only allow assuming roles that are NOT in the WorkerMill platform
          # This prevents workers from escalating privileges to platform roles
          StringNotLike = {
            "aws:ResourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
      # Allow assuming ONLY designated customer deployment roles in the SAME account
      # (for oncallshift which shares the AWS account)
      # These roles MUST have the naming pattern: workermill-customer-*
      {
        Effect = "Allow"
        Action = [
          "sts:AssumeRole"
        ]
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/workermill-customer-*"
      }
    ]
  })
}

# =============================================================================
# OnCallShift Customer Role (Same-Account Deployment)
# This role allows workers to deploy to oncallshift infrastructure.
# Workers assume this role via STS with external ID validation.
# =============================================================================
resource "aws_iam_role" "oncallshift_customer" {
  name = "workermill-customer-oncallshift-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = [
            aws_iam_role.ecs_worker_task.arn, # Workers assume this for deployments
            aws_iam_role.ecs_task.arn         # API assumes this for "Test Connection" feature
          ]
        }
        Action = "sts:AssumeRole"
        # Note: External ID validation happens at the application level
        # The worker role can only assume workermill-customer-* roles anyway
      }
    ]
  })

  tags = {
    Name      = "workermill-customer-oncallshift-${var.environment}"
    Purpose   = "OnCallShift deployment by WorkerMill workers"
    ManagedBy = "Terraform"
  }
}

resource "aws_iam_role_policy" "oncallshift_customer" {
  name = "oncallshift-deployment-policy"
  role = aws_iam_role.oncallshift_customer.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # =============================================================================
      # ECR - Full container registry access for oncallshift repos
      # =============================================================================
      {
        Sid    = "ECRAuth"
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Sid    = "ECRFullAccess"
        Effect = "Allow"
        Action = [
          "ecr:*"
        ]
        Resource = [
          "arn:aws:ecr:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:repository/oncallshift-*",
          "arn:aws:ecr:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:repository/pagerduty-lite-*"
        ]
      },
      # =============================================================================
      # ECS - Full cluster and service management
      # =============================================================================
      {
        Sid    = "ECSFullAccess"
        Effect = "Allow"
        Action = [
          "ecs:*"
        ]
        Resource = [
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:cluster/oncallshift-*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:cluster/pagerduty-lite-*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:service/oncallshift-*/*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:service/pagerduty-lite-*/*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task/oncallshift-*/*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task/pagerduty-lite-*/*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task-definition/oncallshift-*:*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task-definition/pagerduty-lite-*:*"
        ]
      },
      {
        Sid    = "ECSDescribeAll"
        Effect = "Allow"
        Action = [
          "ecs:DescribeClusters",
          "ecs:DescribeServices",
          "ecs:DescribeTasks",
          "ecs:DescribeTaskDefinition",
          "ecs:ListServices",
          "ecs:ListTasks",
          "ecs:ListTaskDefinitions",
          "ecs:ListClusters"
        ]
        Resource = "*"
      },
      {
        Sid    = "ECSTaskDefinitions"
        Effect = "Allow"
        Action = [
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition"
        ]
        Resource = "*"
      },
      # =============================================================================
      # S3 - Full access for oncallshift buckets
      # =============================================================================
      {
        Sid    = "S3FullAccess"
        Effect = "Allow"
        Action = [
          "s3:*"
        ]
        Resource = [
          "arn:aws:s3:::oncallshift-*",
          "arn:aws:s3:::oncallshift-*/*",
          "arn:aws:s3:::pagerduty-lite-*",
          "arn:aws:s3:::pagerduty-lite-*/*"
        ]
      },
      # =============================================================================
      # CloudFront - Full distribution management
      # =============================================================================
      {
        Sid    = "CloudFrontFullAccess"
        Effect = "Allow"
        Action = [
          "cloudfront:*"
        ]
        Resource = "*"
      },
      # =============================================================================
      # IAM - Pass roles for ECS task execution
      # =============================================================================
      {
        Sid    = "IAMPassRole"
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = [
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/oncallshift-*",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/pagerduty-lite-*"
        ]
      },
      {
        Sid    = "IAMGetRole"
        Effect = "Allow"
        Action = [
          "iam:GetRole"
        ]
        Resource = "*"
      },
      # =============================================================================
      # Secrets Manager - Application secrets
      # =============================================================================
      {
        Sid    = "SecretsManagerAccess"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
          "secretsmanager:CreateSecret",
          "secretsmanager:UpdateSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:DeleteSecret"
        ]
        Resource = [
          "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:oncallshift/*",
          "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:pagerduty-lite/*"
        ]
      },
      # =============================================================================
      # SSM Parameter Store - Application configuration
      # =============================================================================
      {
        Sid    = "SSMParameterAccess"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
          "ssm:PutParameter",
          "ssm:DeleteParameter"
        ]
        Resource = [
          "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/oncallshift/*",
          "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/pagerduty-lite/*"
        ]
      },
      # =============================================================================
      # CloudWatch Logs - Application logging
      # =============================================================================
      {
        Sid    = "CloudWatchLogsAccess"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:GetLogEvents"
        ]
        Resource = [
          "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/oncallshift-*",
          "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/oncallshift-*:*",
          "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/pagerduty-lite-*",
          "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/pagerduty-lite-*:*"
        ]
      },
      # =============================================================================
      # RDS - Database access if needed
      # =============================================================================
      {
        Sid    = "RDSDescribe"
        Effect = "Allow"
        Action = [
          "rds:DescribeDBInstances",
          "rds:DescribeDBClusters"
        ]
        Resource = "*"
      },
      # =============================================================================
      # Route53 - DNS management for oncallshift domains
      # =============================================================================
      {
        Sid    = "Route53Access"
        Effect = "Allow"
        Action = [
          "route53:ChangeResourceRecordSets",
          "route53:GetHostedZone",
          "route53:ListResourceRecordSets"
        ]
        Resource = "arn:aws:route53:::hostedzone/*"
      },
      {
        Sid    = "Route53List"
        Effect = "Allow"
        Action = [
          "route53:ListHostedZones"
        ]
        Resource = "*"
      },
      # =============================================================================
      # ACM - Certificate management
      # =============================================================================
      {
        Sid    = "ACMAccess"
        Effect = "Allow"
        Action = [
          "acm:DescribeCertificate",
          "acm:ListCertificates",
          "acm:GetCertificate"
        ]
        Resource = "*"
      },
      # =============================================================================
      # Application Load Balancer
      # =============================================================================
      {
        Sid    = "ELBAccess"
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:Describe*",
          "elasticloadbalancing:ModifyRule",
          "elasticloadbalancing:ModifyTargetGroup",
          "elasticloadbalancing:ModifyTargetGroupAttributes",
          "elasticloadbalancing:RegisterTargets",
          "elasticloadbalancing:DeregisterTargets"
        ]
        Resource = "*"
      }
    ]
  })
}

# Security Group for ECS Tasks
resource "aws_security_group" "ecs_tasks" {
  name        = "workermill-${var.environment}-ecs-tasks"
  description = "Security group for ECS tasks"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "workermill-${var.environment}-ecs-tasks"
  }
}
