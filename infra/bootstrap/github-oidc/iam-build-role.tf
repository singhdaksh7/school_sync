# ── schoolsync-github-staging-build ─────────────────────────────────────
#
# Assumed only by CI runs on the exact `staging` branch (push/PR builds never
# get AWS access — see .github/workflows/ci.yml, which has no id-token
# permission at all). Its only job: push/scan immutable images to the
# existing `schoolsync` ECR repository. No ECS, no Terraform state, no
# Secrets Manager, no iam:PassRole, no RDS, no S3 application data, and no
# infrastructure-mutation permission of any kind.

data "aws_iam_policy_document" "build_trust" {
  statement {
    sid     = "GithubActionsStagingBranchOidc"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Exact branch-ref subject — not `repo:OWNER/REPO:*`, not an
    # environment subject, not a wildcard anywhere in owner/repo/branch.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository_owner}/${var.github_repository_name}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "github_staging_build" {
  name                 = "schoolsync-github-staging-build"
  description          = "Assumed via GitHub OIDC by CI on refs/heads/${var.github_branch} only. ECR push/scan-read on the schoolsync repository only - no ECS/Terraform/Secrets/PassRole/RDS/S3-app-data access."
  assume_role_policy   = data.aws_iam_policy_document.build_trust.json
  max_session_duration = 3600

  lifecycle {
    precondition {
      condition = alltrue([
        !strcontains(var.github_repository_owner, "*"),
        !strcontains(var.github_repository_name, "*"),
        !strcontains(var.github_branch, "*"),
      ])
      error_message = "Wildcard repository/branch trust is not permitted for schoolsync-github-staging-build — every one of github_repository_owner/github_repository_name/github_branch must be an exact value."
    }
  }
}

data "aws_iam_policy_document" "build_permissions" {
  statement {
    sid    = "EcrPushImmutableImages"
    effect = "Allow"
    actions = [
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:BatchCheckLayerAvailability",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:DescribeImageScanFindings",
      "ecr:DescribeRepositories",
    ]
    # Tag immutability itself is enforced by the ECR repository's own
    # imageTagMutability setting (out of scope for this stack — the
    # repository already exists and is looked up via data source only, see
    # infra/terraform/ecr.tf); this policy just scopes WHO can push, to
    # exactly this one repository.
    resources = [
      "arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/${var.ecr_repository_name}"
    ]
  }

  statement {
    sid    = "EcrAuthToken"
    effect = "Allow"
    # ecr:GetAuthorizationToken has no resource-level permissions — AWS
    # requires Resource: "*" for this action (every AWS-managed ECR policy,
    # e.g. AmazonEC2ContainerRegistryPowerUser, scopes it identically).
    # Actual repository access stays fully scoped by EcrPushImmutableImages
    # above; this statement only lets the caller obtain a docker-login
    # token, which grants no access by itself.
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_staging_build" {
  name   = "schoolsync-github-staging-build-ecr-push"
  role   = aws_iam_role.github_staging_build.id
  policy = data.aws_iam_policy_document.build_permissions.json
}
