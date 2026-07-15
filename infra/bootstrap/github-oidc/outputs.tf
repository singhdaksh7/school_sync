output "github_staging_build_role_arn" {
  description = "Build role ARN for the selected deployment_environment. Store as a GitHub repository variable, not a secret. Legacy output name retained for staging-state compatibility."
  value       = aws_iam_role.github_staging_build.arn
}

output "github_staging_deploy_role_arn" {
  description = "Deploy role ARN for the selected deployment_environment. Store as a GitHub Environment variable, not a secret. Legacy output name retained for staging-state compatibility."
  value       = aws_iam_role.github_staging_deploy.arn
}

output "github_build_role_arn" {
  description = "Build role ARN for this environment; it is an identifier, not a secret."
  value       = aws_iam_role.github_staging_build.arn
}

output "github_deploy_role_arn" {
  description = "Deploy role ARN for this environment; it is an identifier, not a secret."
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
