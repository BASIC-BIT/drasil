data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "kms" {
  #checkov:skip=CKV_AWS_109:KMS key policies require wildcard resources; access is constrained to account root.
  #checkov:skip=CKV_AWS_111:KMS key policies require wildcard resources; access is constrained to account root.
  #checkov:skip=CKV_AWS_356:KMS key policies require wildcard resources by design.
  statement {
    sid = "EnableRootPermissions"

    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
}

resource "aws_s3_bucket" "tf_state" {
  #checkov:skip=CKV_AWS_18:Access logging for the Terraform state bucket is deferred to avoid recursive logging complexity.
  #checkov:skip=CKV_AWS_144:Cross-region replication is deferred; state resilience is currently provided by versioning + backups.
  #checkov:skip=CKV2_AWS_62:S3 event notifications are not required for a Terraform backend bucket.
  bucket = var.state_bucket_name
  tags   = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id

  rule {
    id     = "state-retention"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }

    noncurrent_version_expiration {
      noncurrent_days           = 90
      newer_noncurrent_versions = 20
    }
  }

  depends_on = [aws_s3_bucket_versioning.tf_state]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.bootstrap.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_policy" "tf_state_tls_only" {
  bucket = aws_s3_bucket.tf_state.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.tf_state.arn,
          "${aws_s3_bucket.tf_state.arn}/*"
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

resource "aws_dynamodb_table" "tf_lock" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.bootstrap.arn
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_key" "bootstrap" {
  description         = "CMK for Terraform bootstrap backend resources"
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.kms.json
}

resource "aws_kms_alias" "bootstrap" {
  name          = "alias/drasil-bootstrap-state"
  target_key_id = aws_kms_key.bootstrap.key_id
}
