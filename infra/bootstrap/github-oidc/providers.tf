provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "schoolsync"
      Component = "github-oidc-bootstrap"
      ManagedBy = "terraform"
    }
  }
}
