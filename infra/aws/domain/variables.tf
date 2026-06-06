variable "aws_region" {
  type        = string
  description = "AWS region for Route 53 API calls. Route 53 is global, but Terraform still needs a provider region."
  default     = "us-east-1"
}

variable "domain_name" {
  type        = string
  description = "Primary domain name managed by this stack."
  default     = "drasilbot.com"

  validation {
    condition     = length(trimsuffix(var.domain_name, ".")) <= 253 && can(regex("^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$", trimsuffix(var.domain_name, ".")))
    error_message = "domain_name must be a valid DNS name without protocol, path, consecutive dots, or labels starting/ending with a hyphen."
  }
}

variable "project_name" {
  type        = string
  description = "Project tag used for naming and tagging."
  default     = "drasil"
}

variable "environment" {
  type        = string
  description = "Environment tag used for naming and tagging."
  default     = "prod"
}

variable "enable_vercel_records" {
  type        = bool
  description = "Create apex A and www CNAME records for Vercel-hosted web production."
  default     = true
}

variable "vercel_apex_a_records" {
  type        = list(string)
  description = "A records Vercel expects for apex domains."
  default     = ["76.76.21.21"]
}

variable "vercel_cname_target" {
  type        = string
  description = "CNAME target Vercel expects for subdomains."
  default     = "cname.vercel-dns.com"
}

variable "dns_record_ttl" {
  type        = number
  description = "TTL in seconds for managed DNS records."
  default     = 300
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to created resources."
  default     = {}
}
