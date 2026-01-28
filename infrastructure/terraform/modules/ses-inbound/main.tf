# SES Inbound Email Module
# Enables receiving emails and forwarding them to the API for processing

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  bucket_name = var.s3_bucket_name != "" ? var.s3_bucket_name : "workermill-${var.environment}-email-${data.aws_caller_identity.current.account_id}"
  tags = merge(var.tags, {
    Module = "ses-inbound"
    Environment = var.environment
  })
}

# =============================================================================
# S3 Bucket for Email Storage
# =============================================================================

resource "aws_s3_bucket" "email_storage" {
  bucket = local.bucket_name
  tags   = local.tags
}

resource "aws_s3_bucket_lifecycle_configuration" "email_lifecycle" {
  bucket = aws_s3_bucket.email_storage.id

  rule {
    id     = "delete-old-emails"
    status = "Enabled"

    expiration {
      days = var.retention_days
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "email_encryption" {
  bucket = aws_s3_bucket.email_storage.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "email_public_access" {
  bucket = aws_s3_bucket.email_storage.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Policy to allow SES to write to the bucket
resource "aws_s3_bucket_policy" "ses_write" {
  bucket = aws_s3_bucket.email_storage.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSESPut"
        Effect    = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.email_storage.arn}/*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

# =============================================================================
# SNS Topic for Email Notifications
# =============================================================================

resource "aws_sns_topic" "email_notifications" {
  name = "workermill-${var.environment}-email-notifications"
  tags = local.tags
}

resource "aws_sns_topic_policy" "email_notifications" {
  arn = aws_sns_topic.email_notifications.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSESPublish"
        Effect    = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.email_notifications.arn
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

# =============================================================================
# Lambda Function for Email Processing
# =============================================================================

# IAM role for Lambda
resource "aws_iam_role" "email_processor" {
  name = "workermill-${var.environment}-email-processor"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "email_processor" {
  name = "workermill-${var.environment}-email-processor"
  role = aws_iam_role.email_processor.id

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
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.email_storage.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "ses:FromAddress" = "noreply@${var.domain_name}"
          }
        }
      }
    ]
  })
}

# Lambda function code (inline)
data "archive_file" "email_processor" {
  type        = "zip"
  output_path = "${path.module}/lambda/email_processor.zip"

  source {
    content  = <<-EOF
import json
import boto3
import urllib.request
import urllib.parse
import hmac
import hashlib
import os
import email
from email import policy
from email.parser import BytesParser
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

def lambda_handler(event, context):
    """
    Process incoming emails from SES via SNS.
    Parses the email, forwards to personal inbox, and sends to WorkerMill API.
    """
    print(f"Received event: {json.dumps(event)}")

    for record in event.get('Records', []):
        # Parse SNS message
        sns_message = json.loads(record['Sns']['Message'])
        message_type = sns_message.get('notificationType')

        if message_type != 'Received':
            print(f"Skipping non-received message type: {message_type}")
            continue

        # Get email content
        mail_data = sns_message.get('mail', {})
        receipt_data = sns_message.get('receipt', {})

        # Extract key information
        message_id = mail_data.get('messageId')
        source = mail_data.get('source')
        recipients = receipt_data.get('recipients', [])
        timestamp = mail_data.get('timestamp')

        # Get S3 location if email is stored there
        s3_info = receipt_data.get('action', {})
        bucket_name = s3_info.get('bucketName')
        object_key = s3_info.get('objectKey')

        # Retrieve full email from S3 if available
        email_content = None
        raw_email = None
        if bucket_name and object_key:
            s3 = boto3.client('s3')
            try:
                response = s3.get_object(Bucket=bucket_name, Key=object_key)
                raw_email = response['Body'].read()
                msg = BytesParser(policy=policy.default).parsebytes(raw_email)
                email_content = {
                    'subject': str(msg.get('Subject', '')),
                    'body': get_email_body(msg),
                    'html': get_email_html(msg),
                }
            except Exception as e:
                print(f"Error retrieving email from S3: {e}")

        # Forward email to personal inbox if configured
        forward_to = os.environ.get('FORWARD_TO_EMAIL', '')
        if forward_to and email_content:
            forward_email(
                source=source,
                recipients=recipients,
                subject=email_content.get('subject', 'No Subject'),
                body=email_content.get('body', ''),
                html=email_content.get('html', ''),
                forward_to=forward_to
            )

        # Build webhook payload
        payload = {
            'messageId': message_id,
            'source': source,
            'recipients': recipients,
            'timestamp': timestamp,
            'content': email_content,
        }

        # Generate HMAC signature
        secret = os.environ.get('WEBHOOK_SECRET', '')
        payload_str = json.dumps(payload, sort_keys=True)
        signature = hmac.new(
            secret.encode('utf-8'),
            payload_str.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()

        # Forward to API
        api_endpoint = os.environ.get('API_ENDPOINT', '')
        if not api_endpoint:
            print("API_ENDPOINT not configured")
            continue

        try:
            req = urllib.request.Request(
                f"{api_endpoint}/api/webhooks/email",
                data=payload_str.encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'X-Email-Signature': signature,
                },
                method='POST'
            )

            with urllib.request.urlopen(req, timeout=30) as response:
                response_body = response.read().decode('utf-8')
                print(f"API response: {response.status} - {response_body}")

        except Exception as e:
            print(f"Error forwarding to API: {e}")

    return {'statusCode': 200, 'body': 'OK'}


def forward_email(source, recipients, subject, body, html, forward_to):
    """Forward email to personal inbox via SES."""
    ses_region = os.environ.get('SES_SENDING_REGION', 'us-east-2')
    from_domain = os.environ.get('FROM_DOMAIN', 'workermill.com')

    ses = boto3.client('ses', region_name=ses_region)

    # Build the forwarded email
    msg = MIMEMultipart('alternative')
    msg['Subject'] = f"[Fwd: {recipients[0] if recipients else 'workermill.com'}] {subject}"
    msg['From'] = f"noreply@{from_domain}"
    msg['To'] = forward_to
    msg['Reply-To'] = source

    # Add forward header to body
    forward_header = f"---------- Forwarded message ----------\\nFrom: {source}\\nTo: {', '.join(recipients)}\\nSubject: {subject}\\n\\n"

    # Add plain text part
    text_content = forward_header + body
    msg.attach(MIMEText(text_content, 'plain'))

    # Add HTML part if available
    if html:
        html_header = f"<p><strong>---------- Forwarded message ----------</strong><br>From: {source}<br>To: {', '.join(recipients)}<br>Subject: {subject}</p><hr>"
        html_content = html_header + html
        msg.attach(MIMEText(html_content, 'html'))

    try:
        response = ses.send_raw_email(
            Source=f"noreply@{from_domain}",
            Destinations=[forward_to],
            RawMessage={'Data': msg.as_string()}
        )
        print(f"Forwarded email to {forward_to}, MessageId: {response['MessageId']}")
    except Exception as e:
        print(f"Error forwarding email: {e}")


def get_email_body(msg):
    """Extract plain text body from email."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == 'text/plain':
                return part.get_payload(decode=True).decode('utf-8', errors='replace')
    else:
        if msg.get_content_type() == 'text/plain':
            return msg.get_payload(decode=True).decode('utf-8', errors='replace')
    return ''


def get_email_html(msg):
    """Extract HTML body from email."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == 'text/html':
                return part.get_payload(decode=True).decode('utf-8', errors='replace')
    else:
        if msg.get_content_type() == 'text/html':
            return msg.get_payload(decode=True).decode('utf-8', errors='replace')
    return ''
EOF
    filename = "index.py"
  }
}

resource "aws_lambda_function" "email_processor" {
  filename         = data.archive_file.email_processor.output_path
  function_name    = "workermill-${var.environment}-email-processor"
  role             = aws_iam_role.email_processor.arn
  handler          = "index.lambda_handler"
  source_code_hash = data.archive_file.email_processor.output_base64sha256
  runtime          = "python3.11"
  timeout          = 60
  memory_size      = 256

  environment {
    variables = {
      API_ENDPOINT       = var.api_endpoint
      WEBHOOK_SECRET     = var.email_webhook_secret
      FORWARD_TO_EMAIL   = var.forward_to_email
      SES_SENDING_REGION = var.ses_sending_region
      FROM_DOMAIN        = var.domain_name
    }
  }

  tags = local.tags
}

# Allow SNS to invoke Lambda
resource "aws_lambda_permission" "sns_invoke" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.email_processor.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.email_notifications.arn
}

# Subscribe Lambda to SNS topic
resource "aws_sns_topic_subscription" "email_to_lambda" {
  topic_arn = aws_sns_topic.email_notifications.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.email_processor.arn
}

# =============================================================================
# SES Receipt Rule Set
# =============================================================================

resource "aws_ses_receipt_rule_set" "main" {
  rule_set_name = "workermill-${var.environment}-email-rules"
}

# Activate the rule set
resource "aws_ses_active_receipt_rule_set" "main" {
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
}

# Rule to receive emails for our domain
resource "aws_ses_receipt_rule" "main" {
  name          = "workermill-${var.environment}-receive"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = [var.domain_name]
  enabled       = true
  scan_enabled  = true

  # Store email in S3 and notify via SNS (which triggers Lambda)
  # Using topic_arn on s3_action ensures the SNS notification includes S3 bucket/key info
  s3_action {
    bucket_name       = aws_s3_bucket.email_storage.id
    object_key_prefix = "emails/"
    topic_arn         = aws_sns_topic.email_notifications.arn
    position          = 1
  }

  depends_on = [
    aws_s3_bucket_policy.ses_write,
    aws_sns_topic_policy.email_notifications
  ]
}

# =============================================================================
# CloudWatch Log Group for Lambda
# =============================================================================

resource "aws_cloudwatch_log_group" "email_processor" {
  name              = "/aws/lambda/${aws_lambda_function.email_processor.function_name}"
  retention_in_days = 14
  tags              = local.tags
}
