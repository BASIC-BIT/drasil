variable "aws_region" {
  type        = string
  description = "AWS region to deploy into."
  default     = "us-east-1"
}

variable "state_bucket_name" {
  type        = string
  description = "Globally-unique S3 bucket name for Terraform state."
}

variable "lock_table_name" {
  type        = string
  description = "DynamoDB table name for Terraform state locking."
  default     = "drasil-terraform-locks"
}

variable "project_name" {
  type        = string
  description = "Project tag used for bootstrap resources."
  default     = "drasil"
}

variable "environment" {
  type        = string
  description = "Environment tag used for bootstrap resources."
  default     = "shared"
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to created resources."
  default     = {}
}
