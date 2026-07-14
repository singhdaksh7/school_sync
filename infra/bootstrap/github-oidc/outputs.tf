output "github_staging_build_role_arn" {
  description = "Configure as the STAGING_BUILD_ROLE_ARN repository variable (Settings > Secrets and variables > Actions > Variables tab) — this is not sensitive, never store it as a secret."
  value       = aws_iam_role.github_staging_build.arn
}

output "github_staging_deploy_role_arn" {
  description = "Configure as the STAGING_DEPLOY_ROLE_ARN variable on the `staging` GitHub Environment (Settings > Environments > staging > Environment variables) — not a repository-level variable, and not a secret."
  value       = aws_iam_role.github_staging_deploy.arn
}

output "github_oidc_provider_arn" {
  description = "The token.actions.githubusercontent.com OIDC provider ARN in effect — either newly created by this stack, or the pre-existing one passed in via var.github_oidc_provider_arn."
  value       = local.oidc_provider_arn
}

output "github_oidc_provider_created_by_this_stack" {
  description = "true if this apply created the OIDC provider; false if var.github_oidc_provider_arn pointed at a pre-existing one."
  value       = var.github_oidc_provider_arn == ""
}
