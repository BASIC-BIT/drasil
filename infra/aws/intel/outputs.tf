output "bucket_name" {
  value       = aws_s3_bucket.intel.bucket
  description = "S3 bucket name for intelligence evidence."
}

output "bucket_arn" {
  value       = aws_s3_bucket.intel.arn
  description = "S3 bucket ARN for intelligence evidence."
}

output "intel_prefix" {
  value       = var.intel_prefix
  description = "Top-level prefix reserved for intelligence data uploads."
}

output "cases_s3_prefix" {
  value       = "s3://${aws_s3_bucket.intel.bucket}/${var.intel_prefix}/cases/"
  description = "S3 prefix for case JSON manifests."
}

output "evidence_s3_prefix" {
  value       = "s3://${aws_s3_bucket.intel.bucket}/${var.intel_prefix}/evidence/"
  description = "S3 prefix for screenshot and evidence uploads."
}
