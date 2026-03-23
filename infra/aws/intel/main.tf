locals {
  common_tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "basic-bit/drasil"
      Component   = "spam-intel"
      DataClass   = "evidence"
    },
    var.tags
  )
}

resource "aws_s3_bucket" "intel" {
  #checkov:skip=CKV_AWS_18:Access logging is intentionally deferred for this lightweight evidence bucket.
  #checkov:skip=CKV_AWS_144:Cross-region replication is not required for the initial informal evidence repository.
  #checkov:skip=CKV2_AWS_62:S3 event notifications are not required for the initial informal evidence repository.
  bucket = var.bucket_name

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name = var.bucket_name
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "intel" {
  bucket = aws_s3_bucket.intel.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "intel" {
  bucket = aws_s3_bucket.intel.id

  versioning_configuration {
    status = var.enable_versioning ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "intel" {
  bucket = aws_s3_bucket.intel.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_public_access_block" "intel" {
  bucket = aws_s3_bucket.intel.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "intel" {
  bucket = aws_s3_bucket.intel.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_policy" "intel_tls_only" {
  bucket = aws_s3_bucket.intel.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.intel.arn,
          "${aws_s3_bucket.intel.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}
