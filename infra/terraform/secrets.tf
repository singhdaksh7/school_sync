# One JSON Secrets Manager secret holding every sensitive/environment-
# specific value the app needs, keyed by the EXACT env var names already used
# in the codebase (.env.example / src/lib/*.ts) — no invented names. ECS
# container `secrets` blocks pull individual JSON keys out of this one ARN
# (":KEY::" JMESPath-ish suffix), which keeps Secrets Manager cost to a
# single secret ($0.40/mo) instead of one per variable.
#
# Nothing here is ever written to a .tf file as a literal value: DB
# password, Redis auth token, NEXTAUTH/AUTH/JOB_WORKER secrets are
# `random_password` resources; RESEND_API_KEY / ANTHROPIC_API_KEY are
# optional sensitive input variables (empty by default) — see variables.tf.
#
# STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY are deliberately NOT
# present here (and not on any ECS task): src/lib/storage-s3.ts treats them
# as optional and falls back to the AWS SDK default credential provider
# chain, which on ECS resolves to the web task's IAM role (see s3.tf /
# iam.tf ecs_task_web). There is no IAM user, no aws_iam_access_key, and no
# static S3 credential anywhere in this stack.

resource "random_password" "nextauth_secret" {
  length  = 48
  special = false
}

resource "random_password" "job_worker_secret" {
  length  = 48
  special = false
}

locals {
  db_url = "postgresql://${var.db_master_username}:${random_password.db_master.result}@${aws_db_instance.main.address}:5432/${var.db_name}?sslmode=require"

  redis_url = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"

  app_secret_map = {
    DATABASE_URL = local.db_url
    DIRECT_URL   = local.db_url

    NEXTAUTH_SECRET = random_password.nextauth_secret.result
    AUTH_SECRET     = random_password.nextauth_secret.result

    JOB_WORKER_SECRET = random_password.job_worker_secret.result
    # WORKER_INTERNAL_URL is not a secret (it's a VPC-internal URL) — it's
    # set as a plain container `environment` value on the worker task
    # definition instead (ecs.tf), pointing at the Cloud Map name in
    # locals.tf (local.worker_internal_url).

    STORAGE_BUCKET          = aws_s3_bucket.storage.bucket
    STORAGE_REGION          = var.aws_region
    STORAGE_PUBLIC_BASE_URL = var.enable_public_asset_access ? "https://${aws_s3_bucket.storage.bucket}.s3.${var.aws_region}.amazonaws.com" : ""
    # No STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY key — see the
    # file-header note above. The web container gets S3 access from its task
    # role instead (ecs.tf sets task_role_arn = aws_iam_role.ecs_task_web.arn).

    RATE_LIMIT_REDIS_URL   = local.redis_url
    RATE_LIMIT_REDIS_TOKEN = random_password.redis_auth.result

    RESEND_API_KEY    = var.resend_api_key
    RESEND_FROM_EMAIL = var.resend_from_email

    # AWS SES: EMAIL_FROM is the only email-related value the web container
    # needs for SES — there is no SES API key/secret, credentials come from
    # the task role (aws_iam_role.ecs_task_web, see ses.tf). SES_REGION is
    # deliberately omitted: src/lib/email.ts falls back to STORAGE_REGION
    # (already set above) when SES_REGION is unset, and SES is provisioned
    # in var.aws_region here, same as everything else in this stack.
    EMAIL_FROM = local.create_ses ? "${var.ses_from_local_part}@${var.ses_domain}" : ""

    ANTHROPIC_API_KEY = var.anthropic_api_key
  }
}

resource "aws_secretsmanager_secret" "app" {
  name        = "${local.name_prefix}/app"
  description = "SchoolSync ${var.environment} application secrets, consumed by ECS task definitions (web/worker/migrate)."
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode(local.app_secret_map)
}
