locals {
  domain_name = trimsuffix(lower(var.domain_name), ".")

  common_tags = merge(
    var.tags,
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "basic-bit/drasil"
      Service     = "web-dashboard"
      Component   = "domain"
    }
  )
}

resource "aws_route53_zone" "primary" {
  #checkov:skip=CKV2_AWS_38:DNSSEC requires registrar DS-record coordination and is deferred until the initial domain cutover is stable.
  #checkov:skip=CKV2_AWS_39:Query logging is deferred; DNS query logs can contain user lookup metadata and need a privacy-aware retention policy.
  name          = local.domain_name
  comment       = "Public hosted zone for Drasil Bot."
  force_destroy = false

  tags = {
    Name = local.domain_name
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_route53_record" "vercel_apex" {
  #checkov:skip=CKV2_AWS_23:Vercel apex records intentionally point to Vercel's provider-managed global edge IP.
  # Allow overwrite keeps apply idempotent if these records were pre-created during cutover.
  count = var.enable_vercel_records ? 1 : 0

  zone_id         = aws_route53_zone.primary.zone_id
  name            = local.domain_name
  type            = "A"
  ttl             = var.dns_record_ttl
  records         = var.vercel_apex_a_records
  allow_overwrite = true
}

resource "aws_route53_record" "vercel_www" {
  # Allow overwrite keeps apply idempotent if this record was pre-created during cutover.
  count = var.enable_vercel_records ? 1 : 0

  zone_id         = aws_route53_zone.primary.zone_id
  name            = "www.${local.domain_name}"
  type            = "CNAME"
  ttl             = var.dns_record_ttl
  records         = [var.vercel_cname_target]
  allow_overwrite = true
}
