# =============================================================================
# Worker State Checkpointing
# S3 bucket for storing worker task checkpoints
# =============================================================================

# S3 bucket for worker state checkpoints
resource "aws_s3_bucket" "worker_state" {
  bucket = "workermill-dev-worker-state-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "workermill-dev-worker-state"
    Environment = "dev"
    Purpose     = "Worker checkpoint storage"
  }
}

# Block public access
resource "aws_s3_bucket_public_access_block" "worker_state" {
  bucket = aws_s3_bucket.worker_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable versioning for safety (can recover old checkpoints if needed)
resource "aws_s3_bucket_versioning" "worker_state" {
  bucket = aws_s3_bucket.worker_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Lifecycle policy: delete state after 7 days (only needed for retries)
resource "aws_s3_bucket_lifecycle_configuration" "worker_state" {
  bucket = aws_s3_bucket.worker_state.id

  rule {
    id     = "cleanup-old-checkpoints"
    status = "Enabled"

    filter {}

    expiration {
      days = 7
    }

    # Also clean up incomplete multipart uploads
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Server-side encryption by default
resource "aws_s3_bucket_server_side_encryption_configuration" "worker_state" {
  bucket = aws_s3_bucket.worker_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Output bucket name for Terraform and scripts
output "worker_state_bucket_name" {
  description = "S3 bucket name for worker state checkpoints"
  value       = aws_s3_bucket.worker_state.id
}

output "worker_state_bucket_arn" {
  description = "S3 bucket ARN for worker state checkpoints"
  value       = aws_s3_bucket.worker_state.arn
}
