terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state is intentionally left as a partial ("-backend-config") setup:
  # no bucket/key/region/table is hardcoded here so this file never encodes
  # account-specific or secret-adjacent details, and `terraform init -backend=false`
  # keeps working for offline validation. Supply real values via
  # infra/terraform/backend.hcl (copy from backend.hcl.example, gitignored) and
  # `terraform init -backend-config=backend.hcl`.
  backend "s3" {}
}
