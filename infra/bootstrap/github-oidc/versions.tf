terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Deliberately a SEPARATE state/backend from the staging application stack
  # (infra/terraform) — this root manages account-level IAM/OIDC trust for
  # GitHub Actions, not the staging application's infrastructure, and must
  # never share a state file or backend key with it (see README.md). Partial
  # backend config, same reasoning as infra/terraform/versions.tf: no
  # bucket/key/region/table hardcoded here, so `terraform init -backend=false`
  # keeps working for offline validation (see .github/workflows/ci.yml), and
  # this file never encodes account-specific details. Supply real values via
  # backend.hcl (copy from backend.hcl.example, gitignored) and
  # `terraform init -backend-config=backend.hcl`.
  backend "s3" {}
}
