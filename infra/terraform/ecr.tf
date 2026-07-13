# The ECR repository already exists (created out-of-band during earlier
# manual Docker/ECR work) and must never be created, modified, or deleted by
# this configuration — data source lookup only. `terraform apply` will fail
# loudly if var.ecr_repository_name doesn't match a real repository, which is
# the correct behavior: it forces the actual name to be confirmed rather than
# silently provisioning a duplicate.
data "aws_ecr_repository" "app" {
  name = var.ecr_repository_name
}
