data "aws_caller_identity" "current" {}

locals {
  s3_bucket_name = var.s3_bucket_name != "" ? var.s3_bucket_name : "${local.name_prefix}-storage-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "storage" {
  bucket = local.s3_bucket_name
  tags   = { Name = local.s3_bucket_name }
}

resource "aws_s3_bucket_versioning" "storage" {
  bucket = aws_s3_bucket.storage.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "storage" {
  bucket = aws_s3_bucket.storage.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "storage" {
  bucket = aws_s3_bucket.storage.id

  block_public_acls       = true
  block_public_policy     = !var.enable_public_asset_access
  ignore_public_acls      = true
  restrict_public_buckets = !var.enable_public_asset_access
}

resource "aws_s3_bucket_lifecycle_configuration" "storage" {
  bucket = aws_s3_bucket.storage.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"
    filter {} # applies to every object — required explicitly since provider v5
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Public-read policy for the public/ prefix (STORAGE_PUBLIC_BASE_URL branding
# assets), only when explicitly opted in — the target architecture has no
# CloudFront distribution, so this serves directly from the S3 website/object
# endpoint at var.s3_bucket_name.s3.ap-south-1.amazonaws.com.
resource "aws_s3_bucket_policy" "public_assets" {
  count  = var.enable_public_asset_access ? 1 : 0
  bucket = aws_s3_bucket.storage.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadForPublicPrefix"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.storage.arn}/public/*"
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.storage]
}

# ── S3 permissions on the web ECS task role (no IAM user, no access keys) ──
#
# src/lib/storage-s3.ts resolves credentials via the AWS SDK default
# provider chain when STORAGE_ACCESS_KEY_ID/STORAGE_SECRET_ACCESS_KEY are
# unset (see resolveS3Credentials in that file) — on ECS Fargate that chain
# resolves to this task role's temporary, auto-rotating credentials via the
# container credential provider. No long-lived access key exists anywhere
# in this stack.
#
# Scoped to exactly the three object-level operations the code actually
# calls (PutObjectCommand, GetObjectCommand — including the presigned
# getDownloadUrl, which needs the same s3:GetObject grant as the signing
# principal — DeleteObjectCommand; HeadObjectCommand is authorized under
# s3:GetObject too, there is no separate IAM action for HEAD). The code
# never calls ListObjectsV2/ListBucket, so that action is deliberately not
# granted. Attached to aws_iam_role.ecs_task_web only — worker and migrate
# use aws_iam_role.ecs_task_minimal, which has no S3 policy (see iam.tf).
data "aws_iam_policy_document" "storage_object_rw" {
  statement {
    sid       = "ObjectRW"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.storage.arn}/*"]
  }
}

resource "aws_iam_role_policy" "web_storage" {
  name   = "${local.name_prefix}-web-s3-object-rw"
  role   = aws_iam_role.ecs_task_web.id
  policy = data.aws_iam_policy_document.storage_object_rw.json
}
