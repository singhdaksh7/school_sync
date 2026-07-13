# ── Core ──────────────────────────────────────────────────────────────────

variable "aws_region" {
  description = "AWS region. Task requirement: must be ap-south-1 (Mumbai)."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = var.aws_region == "ap-south-1"
    error_message = "aws_region must be ap-south-1 per project requirements."
  }
}

variable "project_name" {
  description = "Short project name, used as a resource-naming prefix."
  type        = string
  default     = "schoolsync"
}

variable "environment" {
  description = "Deployment environment name. Must be exactly \"staging\" or \"production\" — the RDS production safety preconditions (rds.tf) match on the literal string \"production\", so an unrestricted/typo'd value (e.g. \"prod\", \"Production\") would silently bypass them instead of tripping an error."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be exactly \"staging\" or \"production\"."
  }
}

variable "tags" {
  description = "Extra tags merged into every resource's default tags."
  type        = map(string)
  default     = {}
}

# ── Networking ────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Two AZs in ap-south-1 to spread public/private subnets across."
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b"]
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDRs (ALB + ECS Fargate tasks — tasks get a public IP for outbound egress instead of a NAT Gateway; inbound is locked down by security group, not subnet routing)."
  type        = list(string)
  default     = ["10.0.0.0/24", "10.0.1.0/24"]
}

variable "private_subnet_cidrs" {
  description = "Isolated subnet CIDRs for RDS + ElastiCache. No route to an Internet Gateway or NAT Gateway exists for these subnets — they are unreachable from the internet by construction, not just by security group."
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "enable_nat_gateway" {
  description = <<-EOT
    Off by default for staging: ECS tasks run in public subnets with a
    security-group-restricted public IP for egress (no inbound path except
    via the ALB), which needs no NAT Gateway (~$32-40/mo + data processing).
    When true, provisions a single NAT Gateway and gives the isolated
    (RDS/ElastiCache) route table internet egress — a prerequisite if this
    config is later extended to also run ECS tasks in fully private subnets
    (not done automatically by this flag; see infra/terraform/README.md).
  EOT
  type        = bool
  default     = false
}

# ── ECR (existing repository — never created/destroyed by this config) ────

variable "ecr_repository_name" {
  description = "Name of the EXISTING ECR repository (created out-of-band). Looked up via data source only — Terraform never creates, modifies, or deletes it."
  type        = string
  default     = "schoolsync"
}

variable "image_tag" {
  description = "Baseline image tag for the initial task definitions. Day-to-day deploys update this via infra/scripts/update-web-service.ps1 / update-worker-service.ps1 (AWS CLI task-def revision + service update) rather than terraform apply — see ecs.tf lifecycle note."
  type        = string
  default     = "latest"
}

# ── Application runtime ─────────────────────────────────────────────────

variable "container_port" {
  description = "Port the Next.js server listens on inside the container (matches Dockerfile ENV PORT)."
  type        = number
  default     = 3000
}

variable "health_check_path" {
  description = "ALB target group + container health check path. Uses the liveness probe (no ?check=readiness) so transient DB blips don't flap ALB health."
  type        = string
  default     = "/api/health"
}

variable "web_desired_count" {
  type    = number
  default = 1
}

variable "web_cpu" {
  description = "Fargate task CPU units for the web/API service."
  type        = number
  default     = 512
}

variable "web_memory" {
  description = "Fargate task memory (MiB) for the web/API service."
  type        = number
  default     = 1024
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "worker_cpu" {
  description = "Fargate task CPU units for the worker service (lightweight HTTP poller — no Prisma/S3 in-process)."
  type        = number
  default     = 256
}

variable "worker_memory" {
  type    = number
  default = 512
}

variable "migration_cpu" {
  type    = number
  default = 512
}

variable "migration_memory" {
  type    = number
  default = 1024
}

# ── RDS ──────────────────────────────────────────────────────────────────

variable "db_name" {
  type    = string
  default = "schoolsync"
}

variable "db_master_username" {
  type    = string
  default = "schoolsync_app"
}

variable "db_major_engine_version" {
  description = "PostgreSQL major version to look up the latest available minor for."
  type        = string
  default     = "16"
}

variable "db_instance_class" {
  description = "Cost-conscious staging default: Graviton burstable instance."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Storage in GB (gp3)."
  type        = number
  default     = 20
}

variable "db_backup_retention_days" {
  type    = number
  default = 3
}

variable "db_skip_final_snapshot" {
  description = "true for disposable staging DBs. Set false if this staging DB should be recoverable after a `terraform destroy`."
  type        = bool
  default     = true
}

variable "db_deletion_protection" {
  type    = bool
  default = false
}

# ── ElastiCache (Valkey) ────────────────────────────────────────────────

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "redis_engine_version" {
  description = "ElastiCache Valkey engine version."
  type        = string
  default     = "8.0"
}

# ── S3 ───────────────────────────────────────────────────────────────────

variable "s3_bucket_name" {
  description = "Explicit bucket name override. Leave empty to auto-generate a globally-unique name (project-environment-account_id)."
  type        = string
  default     = ""
}

variable "enable_public_asset_access" {
  description = "When true, adds a bucket policy allowing public GetObject under the public/ prefix (for STORAGE_PUBLIC_BASE_URL branding assets). Off by default — the target architecture has no CDN in front of S3, so 'public' defaults to 'not exposed' until a CloudFront/public-URL decision is made."
  type        = bool
  default     = false
}

# ── Domain / TLS (optional — required for the mobile app's HTTPS requirement) ──

variable "domain_name" {
  description = "Staging domain to serve the app on (e.g. staging-api.schoolsync.example). Leave empty to stand up HTTP-only on the ALB's default DNS name — NOT suitable for the Android app, which requires HTTPS."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Existing Route 53 hosted zone ID for domain_name. Leave empty if DNS is not managed in this AWS account/Route53 — ACM validation records and the ALB alias record will be surfaced as outputs for manual creation instead."
  type        = string
  default     = ""
}

variable "alb_certificate_arn" {
  description = "Existing ACM certificate ARN to use instead of provisioning one. Leave empty to have Terraform create + DNS-validate a certificate for domain_name (requires route53_zone_id, or manual validation via outputs)."
  type        = string
  default     = ""
}

# ── Email provider selection ────────────────────────────────────────────
#
# Explicit, no-fallback selector — mirrors EMAIL_PROVIDER in
# src/lib/email.ts getEmailProviderKind() exactly. "console" is deliberately
# not a valid value here: every ECS task runs with NODE_ENV=production (see
# locals.web_environment), and console is never a valid production delivery
# path, so it would just be a self-defeating default. Production/staging
# both default to "ses" per project policy — Resend stays available for
# explicit backward-compatible opt-in only.
variable "email_provider" {
  description = "Which email provider the web task selects. Must be \"ses\" or \"resend\" — mirrors src/lib/email.ts's EMAIL_PROVIDER contract (no \"console\": ECS tasks always run with NODE_ENV=production)."
  type        = string
  default     = "ses"

  validation {
    condition     = contains(["ses", "resend"], lower(var.email_provider))
    error_message = "email_provider must be \"ses\" or \"resend\"."
  }
}

# ── SES ──────────────────────────────────────────────────────────────────

variable "ses_domain" {
  description = <<-EOT
    Domain to verify for SES sending. Required when email_provider = "ses"
    (the default) for the app to actually be able to send — leaving this
    empty with email_provider = "ses" means EMAIL_FROM is never set, so
    getEmailProviderKind() reports "unavailable" (readiness degrades;
    password-reset/invite emails fail safe rather than silently using
    another provider — see src/lib/email.ts, "no fallback between
    providers"). When set, EMAIL_FROM is derived as
    "$${ses_from_local_part}@$${ses_domain}" (see locals.tf) and the web ECS
    task role is granted ses:SendEmail/ses:SendRawEmail scoped to this one
    verified identity (see ses.tf).
  EOT
  type        = string
  default     = ""
}

variable "ses_from_local_part" {
  description = "Local part of the SES sender address (before the @) — combined with ses_domain to form EMAIL_FROM. Only used when ses_domain is set."
  type        = string
  default     = "noreply"
}

# ── Secrets (sensitive — no defaults containing real values; optional
#    features stay optional so `terraform apply` never requires them) ──────

variable "resend_api_key" {
  description = "Only used when email_provider = \"resend\" (explicit backward-compatibility opt-in). Ignored when email_provider = \"ses\" — there is no fallback between providers (see src/lib/email.ts)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "resend_from_email" {
  type    = string
  default = "onboarding@resend.dev"
}

variable "anthropic_api_key" {
  description = "Optional — only used by schools with the AI_FEATURES flag."
  type        = string
  default     = ""
  sensitive   = true
}

variable "app_base_url" {
  description = "Public base URL for NEXTAUTH_URL/AUTH_URL (e.g. https://staging-api.schoolsync.example). Leave empty to fall back to request-origin-derived links."
  type        = string
  default     = ""
}

# ── Observability / cost knobs ─────────────────────────────────────────────

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "enable_container_insights" {
  description = "ECS Container Insights adds CloudWatch cost; off by default for staging."
  type        = bool
  default     = false
}

# ── CloudWatch alarms ────────────────────────────────────────────────────
#
# Alarms are always created (they're near-zero cost) — only the notification
# destination is optional. Provide at most one of the two below; if neither
# is set, alarms still exist (visible/queryable in the console) but have no
# alarm_actions, so nothing gets notified until one is configured.

variable "alarm_sns_topic_arn" {
  description = "Existing SNS topic ARN to notify on alarm. Takes precedence over alarm_notification_email. Leave empty to have this config create nothing here and (if alarm_notification_email is also empty) manage no notification destination at all."
  type        = string
  default     = ""
}

variable "alarm_notification_email" {
  description = "Optional email to subscribe to a NEW SNS topic this config creates (only used when alarm_sns_topic_arn is empty). Never a default value — must be explicitly supplied, e.g. via -var or TF_VAR_, never committed to a tfvars file."
  type        = string
  default     = ""
}

variable "alarm_web_cpu_threshold_percent" {
  type    = number
  default = 80
}

variable "alarm_web_memory_threshold_percent" {
  type    = number
  default = 80
}

variable "alarm_worker_cpu_threshold_percent" {
  type    = number
  default = 80
}

variable "alarm_rds_cpu_threshold_percent" {
  type    = number
  default = 80
}

variable "alarm_rds_free_storage_threshold_bytes" {
  description = "Default: 2 GiB — alarm before db_allocated_storage actually fills up."
  type        = number
  default     = 2147483648
}

variable "alarm_rds_connections_threshold" {
  description = "db.t4g.micro's max_connections is in the low hundreds by default; this is a conservative early-warning threshold, not the hard ceiling."
  type        = number
  default     = 80
}

variable "alarm_redis_cpu_threshold_percent" {
  type    = number
  default = 80
}

variable "alarm_redis_memory_threshold_percent" {
  type    = number
  default = 80
}
