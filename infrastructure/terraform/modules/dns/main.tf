locals {
  # Use hosted_zone_domain if specified, otherwise use domain_name
  hosted_zone_domain = var.hosted_zone_domain != null ? var.hosted_zone_domain : var.domain_name
}

# Route 53 Hosted Zone (must already exist)
data "aws_route53_zone" "main" {
  name         = local.hosted_zone_domain
  private_zone = false
}

# ACM Certificate (conditionally created)
resource "aws_acm_certificate" "main" {
  count = var.create_certificate ? 1 : 0

  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "workermill-${var.environment}"
  }
}

# DNS Validation Records (only if creating certificate)
resource "aws_route53_record" "cert_validation" {
  for_each = var.create_certificate ? {
    for dvo in aws_acm_certificate.main[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.main.zone_id
}

# Certificate Validation (only if creating certificate)
resource "aws_acm_certificate_validation" "main" {
  count = var.create_certificate ? 1 : 0

  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}
