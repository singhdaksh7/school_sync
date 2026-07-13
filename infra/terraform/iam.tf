data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ── Execution role: pulls the image from ECR, writes to CloudWatch Logs, and
#    resolves the ECS `secrets` block from Secrets Manager. Used by all three
#    task definitions (web, worker, migrate). ────────────────────────────────
resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    sid       = "ReadAppSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name   = "${local.name_prefix}-ecs-execution-secrets"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_secrets.json
}

# ── Task roles: the in-container AWS identity, split by actual need ────────
#
# src/lib/storage-s3.ts resolves credentials via the AWS SDK default
# provider chain when no explicit STORAGE_ACCESS_KEY_ID/SECRET_ACCESS_KEY is
# set (see resolveS3Credentials) — on ECS that chain resolves to whatever
# this task role grants, via the container credential provider. Only the web
# container calls S3 (PutObject/GetObject/DeleteObject via
# S3StorageProvider — see s3.tf for the exact policy). The worker only makes
# authenticated HTTP calls to the web service's internal endpoint (no AWS
# SDK use at all), and the migration task only runs `prisma migrate deploy`
# against RDS (also no AWS SDK use) — so both get a role with no attached
# policy beyond the trust relationship, keeping S3 access off two task types
# that never touch S3.
resource "aws_iam_role" "ecs_task_web" {
  name               = "${local.name_prefix}-ecs-task-web"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role" "ecs_task_minimal" {
  name               = "${local.name_prefix}-ecs-task-minimal"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}
