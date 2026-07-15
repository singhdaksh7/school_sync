# ── Core ──────────────────────────────────────────────────────────────────

variable "aws_account_id" {
  description = "AWS account ID these OIDC roles are created in. Every trust policy, role ARN, and resource ARN in this stack is scoped to this exact account — never a wildcard."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be exactly 12 digits."
  }
}

variable "aws_region" {
  description = "AWS region for provider configuration and every regional ARN below."
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Project prefix used by the application stack."
  type        = string
  default     = "schoolsync"
}

variable "deployment_environment" {
  description = "Exact application environment these OIDC roles may deploy."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.deployment_environment)
    error_message = "deployment_environment must be exactly staging or production."
  }
}

# ── GitHub trust — every value here is compiled into an exact `sub`
#    condition; none of them may contain a wildcard (enforced below by both
#    a variable validation block and a resource-level lifecycle precondition,
#    so a bad value fails at plan time no matter which check runs first). ──

variable "github_repository_owner" {
  description = "Exact GitHub org/user that owns the repository."
  type        = string
  default     = "singhdaksh7"

  validation {
    condition     = var.github_repository_owner != "" && !strcontains(var.github_repository_owner, "*")
    error_message = "github_repository_owner must be an exact, non-empty, non-wildcard GitHub org/user name."
  }
}

variable "github_repository_name" {
  description = "Exact repository name (no owner prefix)."
  type        = string
  default     = "school_sync"

  validation {
    condition     = var.github_repository_name != "" && !strcontains(var.github_repository_name, "*")
    error_message = "github_repository_name must be an exact, non-empty, non-wildcard repository name."
  }
}

variable "github_branch" {
  description = "Exact branch the build role's trust policy is scoped to, via the branch-ref subject `repo:OWNER/REPO:ref:refs/heads/BRANCH`."
  type        = string
  default     = "staging"

  validation {
    condition     = var.github_branch != "" && !strcontains(var.github_branch, "*")
    error_message = "github_branch must be an exact, non-empty, non-wildcard branch name."
  }
}

variable "github_environment" {
  description = "Exact protected GitHub Environment name the deploy role's trust policy is scoped to."
  type        = string
  default     = "staging"

  validation {
    condition     = var.github_environment != "" && !strcontains(var.github_environment, "*")
    error_message = "github_environment must be an exact, non-empty, non-wildcard GitHub Environment name."
  }
}

# ── OIDC provider: create or reuse (see README.md, "OIDC provider: create
#    or reuse" for the full decision tree and read-only detection command) ──

variable "github_oidc_provider_arn" {
  description = <<-EOT
    ARN of an EXISTING token.actions.githubusercontent.com OIDC provider in
    this account, if one already exists. Leave empty (default) to have this
    stack create it.

    Before the first `terraform plan`, check (read-only, schoolsync-admin
    profile):

      aws iam list-open-id-connect-providers --profile schoolsync-admin

    If a provider for token.actions.githubusercontent.com is already listed,
    set this variable to its exact ARN. This stack will then treat the
    provider as an external dependency (via a plain ARN reference — no
    resource of this type is created) and will not attempt to create a
    second, duplicate provider. IAM only allows one OIDC provider per URL
    per account, so a duplicate `aws_iam_openid_connect_provider` create
    would fail loudly at apply time regardless — this variable just lets
    you avoid even attempting it, and lets the two role trust policies below
    reference whichever provider is authoritative.
  EOT
  type        = string
  default     = ""
}

# ── Existing AWS resources this stack's IAM policies reference (never
#    created/modified/deleted by this stack — see README.md) ──────────────

variable "ecr_repository_name" {
  description = "Existing ECR repository name the build role may push immutable images to."
  type        = string
  default     = "schoolsync"
}

variable "ecs_cluster_name" {
  type    = string
  default = "schoolsync-staging-cluster"
}

variable "ecs_web_service_name" {
  type    = string
  default = "schoolsync-staging-web"
}

variable "ecs_worker_service_name" {
  type    = string
  default = "schoolsync-staging-worker"
}

variable "ecs_execution_role_name" {
  description = "Existing ECS execution role name (infra/terraform/iam.tf: aws_iam_role.ecs_execution) — the deploy role's iam:PassRole is scoped to exactly this role name, conditioned on iam:PassedToService = ecs-tasks.amazonaws.com."
  type        = string
  default     = "schoolsync-staging-ecs-execution"
}

variable "ecs_task_web_role_name" {
  description = "Existing web task role (infra/terraform/iam.tf: aws_iam_role.ecs_task_web)."
  type        = string
  default     = "schoolsync-staging-ecs-task-web"
}

variable "ecs_task_minimal_role_name" {
  description = "Existing worker/migrate task role, shared by both task definitions (infra/terraform/iam.tf: aws_iam_role.ecs_task_minimal)."
  type        = string
  default     = "schoolsync-staging-ecs-task-minimal"
}

variable "eventbridge_maintenance_role_name" {
  description = "EventBridge API Destination invocation role created by the application stack when maintenance schedules are enabled."
  type        = string
  default     = "schoolsync-staging-eventbridge-maintenance"
}

# ── Application Terraform backend (read/lock only — see
#    iam-deploy-role.tf's TerraformStateReadAndLock statement) ─────────────

variable "terraform_state_bucket" {
  description = "S3 bucket holding this environment's application Terraform state — not this bootstrap stack's own backend."
  type        = string
}

variable "terraform_state_key" {
  description = "State object key within terraform_state_bucket for this application environment."
  type        = string
  default     = "schoolsync/staging/terraform.tfstate"
}

variable "terraform_lock_table" {
  description = "DynamoDB table used for this environment's application Terraform state lock."
  type        = string
}
