data "aws_rds_engine_version" "postgres" {
  engine  = "postgres"
  version = var.db_major_engine_version
  latest  = true
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = "${local.name_prefix}-db-subnet-group" }
}

resource "random_password" "db_master" {
  length  = 32
  special = false # DATABASE_URL is a connection-string; keep the password URL-safe.
}

resource "aws_db_instance" "main" {
  identifier = "${local.name_prefix}-pg"
  engine     = "postgres"
  # `version` on the data source above is an input, not an output — it
  # echoes back whatever partial version (e.g. "16") was queried, not the
  # concrete version AWS resolved it to. `version_actual` is the fully
  # resolved minor AWS selected, which is what engine_version needs.
  engine_version = data.aws_rds_engine_version.postgres.version_actual

  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true # always on, every environment — not exposed as a variable, so this can never be accidentally disabled.

  db_name  = var.db_name
  username = var.db_master_username
  password = random_password.db_master.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false # always off, every environment — not exposed as a variable, so this can never be accidentally enabled.

  multi_az = var.db_multi_az

  backup_retention_period   = var.db_backup_retention_days
  skip_final_snapshot       = var.db_skip_final_snapshot
  final_snapshot_identifier = var.db_skip_final_snapshot ? null : "${local.name_prefix}-pg-final"
  deletion_protection       = var.db_deletion_protection

  performance_insights_enabled = var.db_performance_insights_enabled
  monitoring_interval          = 0     # avoid enhanced-monitoring IAM role + cost

  apply_immediately = true

  tags = { Name = "${local.name_prefix}-pg" }

  # ── Production database safety guardrails ─────────────────────────────
  #
  # Staging keeps its disposable, cost-conscious defaults (db_skip_final_
  # snapshot=true, db_deletion_protection=false, 3-day backups — see
  # variables.tf). This config does not create or apply a production
  # environment. If `environment = "production"` is set, these preconditions
  # make `terraform plan`/`apply` refuse to proceed unless the
  # production-appropriate values are explicitly set too — a production
  # deploy can never accidentally inherit the staging defaults by omission.
  lifecycle {
    precondition {
      condition     = var.environment != "production" || var.db_deletion_protection == true
      error_message = "environment=production requires db_deletion_protection=true (staging default is false)."
    }
    precondition {
      condition     = var.environment != "production" || var.db_skip_final_snapshot == false
      error_message = "environment=production requires db_skip_final_snapshot=false, so a final snapshot is always taken on destroy (staging default is true)."
    }
    precondition {
      condition     = var.environment != "production" || var.db_backup_retention_days >= local.production_min_backup_retention_days
      error_message = "environment=production requires db_backup_retention_days >= ${local.production_min_backup_retention_days} (staging default is 3)."
    }
    precondition {
      condition     = var.environment != "production" || var.db_multi_az
      error_message = "environment=production requires db_multi_az=true."
    }
    # postcondition, not precondition: `self` (the resource's own resulting
    # attributes) is only available after the resource is planned/applied.
    # These two check the ACTUAL value AWS reports back, in every
    # environment — not just production — as a defense-in-depth guard
    # against a future edit that turns storage_encrypted/publicly_accessible
    # into variables without also updating this check.
    postcondition {
      condition     = self.storage_encrypted == true
      error_message = "RDS storage encryption must be enabled — this should be structurally impossible to fail (storage_encrypted is hardcoded true above, not a variable)."
    }
    postcondition {
      condition     = self.publicly_accessible == false
      error_message = "RDS must not be publicly accessible — this should be structurally impossible to fail (publicly_accessible is hardcoded false above, not a variable)."
    }
  }
}
