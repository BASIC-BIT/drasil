variable "aws_region" {
  type        = string
  description = "AWS region to deploy into."
  default     = "us-east-1"
}

variable "bucket_name" {
  type        = string
  description = "Globally unique S3 bucket name for scam/spam intelligence evidence."
}

variable "project_name" {
  type        = string
  description = "Project tag used for naming and tagging."
  default     = "drasil"
}

variable "environment" {
  type        = string
  description = "Environment tag used for naming and tagging."
  default     = "shared"
}

variable "intel_prefix" {
  type        = string
  description = "Top-level S3 prefix for intelligence data."
  default     = "spam-intel"
}

variable "enable_versioning" {
  type        = bool
  description = "Enable S3 versioning for uploaded intelligence records."
  default     = true
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to created resources."
  default     = {}
}
