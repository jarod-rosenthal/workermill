output "certificate_arn" {
  description = "ACM certificate ARN"
  value       = aws_acm_certificate.main.arn
}

output "certificate_validation_id" {
  description = "Certificate validation ID (use as dependency)"
  value       = aws_acm_certificate_validation.main.id
}

output "zone_id" {
  description = "Route53 hosted zone ID"
  value       = data.aws_route53_zone.main.zone_id
}
