variable "aws_region" {
  type        = string
  description = "AWS region to deploy into."
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Project name used for resource naming."
  default     = "drasil"
}

variable "environment" {
  type        = string
  description = "Environment name (e.g. prod, staging)."
  default     = "prod"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR block."
  default     = "10.10.0.0/16"
}

variable "desired_count" {
  type        = number
  description = "Number of ECS tasks to run. Keep at 1 for a non-sharded Discord bot."
  default     = 1
}

variable "task_cpu" {
  type        = number
  description = "Fargate task CPU units."
  default     = 256
}

variable "task_memory" {
  type        = number
  description = "Fargate task memory (MiB)."
  default     = 512
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch Logs retention in days."
  default     = 30
}

variable "container_insights" {
  type        = bool
  description = "Enable ECS Container Insights."
  default     = true
}

variable "github_repo" {
  type        = string
  description = "GitHub repo in OWNER/REPO format used to restrict OIDC role assumption."
  default     = "basic-bit/drasil"
}

variable "github_oidc_provider_arn" {
  type        = string
  description = "Existing GitHub Actions OIDC provider ARN for token.actions.githubusercontent.com. If set, this stack will reuse it instead of creating a new provider."
  default     = null
}

variable "github_oidc_thumbprints" {
  type        = list(string)
  description = "Thumbprints for the GitHub Actions OIDC provider. Only used when this stack creates the provider."
  default     = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to created resources."
  default     = {}
}
