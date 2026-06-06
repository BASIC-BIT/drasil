output "domain_name" {
  value       = local.domain_name
  description = "Domain name managed by this stack."
}

output "hosted_zone_id" {
  value       = aws_route53_zone.primary.zone_id
  description = "Route 53 hosted zone ID."
}

output "name_servers" {
  value       = aws_route53_zone.primary.name_servers
  description = "Authoritative nameservers to set on the Route 53 Domains registration."
}

output "apex_record" {
  value       = try(aws_route53_record.vercel_apex[0].fqdn, null)
  description = "Apex Vercel DNS record FQDN, or null when Vercel records are disabled."
}

output "www_record" {
  value       = try(aws_route53_record.vercel_www[0].fqdn, null)
  description = "www Vercel DNS record FQDN, or null when Vercel records are disabled."
}
