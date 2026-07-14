# Creates the token.actions.githubusercontent.com OIDC provider ONLY when
# var.github_oidc_provider_arn is empty (the default) — i.e. only when the
# operator has confirmed (README.md, "OIDC provider: create or reuse") that
# no such provider already exists in this account. IAM permits at most one
# OIDC provider per URL per account, so this `count` guard is what makes
# "never create a duplicate provider" true by construction, not just by
# convention: setting github_oidc_provider_arn to an existing ARN takes this
# resource's count to 0 and no create is even attempted.

data "tls_certificate" "github_actions" {
  count = var.github_oidc_provider_arn == "" ? 1 : 0
  url   = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.github_oidc_provider_arn == "" ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_actions[0].certificates[0].sha1_fingerprint]

  lifecycle {
    precondition {
      condition     = var.github_oidc_provider_arn == ""
      error_message = "github_oidc_provider_arn must be empty for this stack to create the provider. If a token.actions.githubusercontent.com provider already exists in this account, set github_oidc_provider_arn to its ARN instead of leaving this precondition to fail — see README.md's 'OIDC provider: create or reuse'."
    }
  }
}

locals {
  # Whichever provider is authoritative — the one this stack just created,
  # or the pre-existing one supplied via var.github_oidc_provider_arn. Every
  # role trust policy below references this, never the resource directly,
  # so both paths (create vs. reuse) produce an identical trust policy.
  oidc_provider_arn = var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn
}
