data "aws_caller_identity" "current" {}

locals {
  # Default to [domain_name, www.domain_name] if domain_aliases not specified
  domain_aliases = var.domain_aliases != null ? var.domain_aliases : [var.domain_name, "www.${var.domain_name}"]

  # Use custom API domain if provided, otherwise fall back to ALB DNS name
  # When using custom domain (e.g., api.workermill.com), we can use HTTPS since cert matches
  # When using raw ALB DNS, we must use HTTP since ALB cert is for workermill.com, not the ALB hostname
  api_origin_domain          = var.api_origin_domain != null ? var.api_origin_domain : var.alb_dns_name
  api_origin_protocol_policy = var.api_origin_domain != null ? "https-only" : "http-only"
}

# S3 Bucket for Frontend
resource "aws_s3_bucket" "frontend" {
  bucket = "workermill-${var.environment}-frontend-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "workermill-${var.environment}-frontend"
  }
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront Origin Access Control
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "workermill-${var.environment}-frontend"
  description                       = "OAC for frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# S3 Bucket Policy for CloudFront
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}

# CloudFront Function for SPA routing
# Rewrites non-API, non-file requests to /index.html at the viewer-request stage
# This replaces custom_error_response which incorrectly affected API 403/404 responses
resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "workermill-${var.environment}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "SPA routing: rewrite non-file paths to index.html"
  publish = true
  code    = <<-EOF
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Don't rewrite API, health, or webhook paths
  if (uri.startsWith('/api/') || uri === '/health' || uri === '/jira') {
    return request;
  }

  // Don't rewrite agent binary/installer paths (served directly from S3)
  if (uri.startsWith('/agent/')) {
    return request;
  }

  // Don't rewrite paths with file extensions (static assets)
  if (uri.match(/\.[a-zA-Z0-9]+$/)) {
    return request;
  }

  // Rewrite all other paths to index.html for SPA routing
  request.uri = '/index.html';
  return request;
}
EOF
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # Cheapest
  aliases             = local.domain_aliases

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # API origin
  # Uses api_origin_domain if set (with HTTPS), otherwise falls back to ALB DNS with HTTP
  # HTTPS requires a matching certificate - raw ALB DNS won't match workermill.com cert
  origin {
    domain_name = local.api_origin_domain
    origin_id   = "api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = local.api_origin_protocol_policy
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Frontend - 0 TTL for development
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "s3-frontend"

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # SPA routing via CloudFront Function
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  # API path - no caching
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "api"

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Origin", "Accept", "Content-Type", "Host", "x-api-key", "x-atlassian-webhook-signature", "x-hub-signature-256", "x-github-event"]
      cookies {
        forward = "all"
      }
    }

    viewer_protocol_policy = "https-only"
    compress               = true
  }

  # Jira webhook path - no caching
  ordered_cache_behavior {
    path_pattern     = "/jira"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "api"

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Origin", "Accept", "Content-Type", "Host", "x-api-key", "x-atlassian-webhook-signature"]
      cookies {
        forward = "all"
      }
    }

    viewer_protocol_policy = "https-only"
    compress               = true
  }

  # Health check path - no caching
  ordered_cache_behavior {
    path_pattern     = "/health"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "api"

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "https-only"
    compress               = true
  }

  # Note: SPA routing is handled by CloudFront Function (spa_rewrite)
  # which rewrites non-file paths to /index.html at viewer-request stage.
  # We removed custom_error_response because it incorrectly intercepted
  # API 403/404 responses and replaced them with index.html.

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Name = "workermill-${var.environment}-frontend"
  }
}
