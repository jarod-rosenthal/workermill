output "certificate_arn" {
  description = "ACM certificate ARN (created or passed in)"
  value       = var.create_certificate ? aws_acm_certificate.main[0].arn : var.certificate_arn
}

output "certificate_validation_id" {
  description = "Certificate validation ID (use as dependency). Null if using existing cert."
  value       = var.create_certificate ? aws_acm_certificate_validation.main[0].id : null
}

output "zone_id" {
  description = "Route53 hosted zone ID"
  value       = data.aws_route53_zone.main.zone_id
}
