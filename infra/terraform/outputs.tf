output "alb_dns_name" {
  description = "ALB's default DNS name. Usable directly (HTTP only, or HTTPS if a domain+cert is configured) even before any custom domain is wired up."
  value       = aws_lb.main.dns_name
}

output "app_url" {
  description = "Best-known public URL for the app — the custom domain if configured, otherwise the ALB DNS name over HTTP."
  value       = local.has_domain ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
}

output "verification_url" {
  description = "Temporary verified-TLS origin URL used before the primary production DNS cutover."
  value       = local.has_verification_domain ? "https://${var.verification_domain_name}" : null
}

output "ecr_repository_url" {
  value = data.aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_web_service_name" {
  value = aws_ecs_service.web.name
}

output "ecs_worker_service_name" {
  value = aws_ecs_service.worker.name
}

output "ecs_web_task_family" {
  value = aws_ecs_task_definition.web.family
}

output "ecs_worker_task_family" {
  value = aws_ecs_task_definition.worker.family
}

output "ecs_migrate_task_definition_arn" {
  description = "Family:revision to pass to `aws ecs run-task` for migrations (infra/scripts/run-migrations.ps1 resolves this itself)."
  value       = aws_ecs_task_definition.migrate.arn
}

output "ecs_migrate_task_family" {
  description = "Family name only (no revision) — infra/scripts/update-migrate-task.ps1 uses this to describe+patch the currently registered revision, mirroring ecs_web_task_family/ecs_worker_task_family."
  value       = aws_ecs_task_definition.migrate.family
}

output "rds_endpoint" {
  description = "Hostname only — never the credentialed connection string (that lives in Secrets Manager)."
  value       = aws_db_instance.main.address
}

output "redis_primary_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "s3_bucket_name" {
  value = aws_s3_bucket.storage.bucket
}

output "secrets_manager_secret_arn" {
  value = aws_secretsmanager_secret.app.arn
}

output "cloudwatch_log_groups" {
  value = {
    web     = aws_cloudwatch_log_group.web.name
    worker  = aws_cloudwatch_log_group.worker.name
    migrate = aws_cloudwatch_log_group.migrate.name
  }
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "ecs_task_subnet_ids" {
  description = "Subnets used by ECS services and one-off migration tasks."
  value       = local.ecs_task_subnet_ids
}

output "ecs_assign_public_ip" {
  description = "Whether ECS tasks receive public IPs (false for production)."
  value       = local.ecs_assign_public_ip
}

output "ecs_tasks_security_group_id" {
  value = aws_security_group.ecs_tasks.id
}

# ── Manual DNS actions (only populated when they actually require one) ────

output "acm_certificate_arn" {
  value = local.certificate_arn != "" ? local.certificate_arn : null
}

output "manual_acm_validation_records_required" {
  description = "Non-null only when a certificate was requested (var.domain_name set) but no Route 53 zone was supplied. Create these DNS records wherever domain_name's DNS is actually hosted. This is a two-stage process: re-running terraform apply alone does NOT enable HTTPS, because no aws_acm_certificate_validation resource exists for this path (nothing here can create the validation records without a zone) — local.certificate_arn stays empty and no HTTPS listener is created until the certificate is safely validated. Once ACM shows the certificate as ISSUED (check via the AWS console/CLI after the DNS record propagates), re-apply with var.alb_certificate_arn set to acm_certificate_arn's value to enable HTTPS."
  value = local.create_managed_cert && !local.has_zone ? [
    for dvo in aws_acm_certificate.app[0].domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ] : null
}

output "manual_alb_alias_record_required" {
  description = "Non-null only when a domain was supplied but no Route 53 zone was — point domain_name at the ALB (CNAME/ALIAS, per your DNS provider) using this target."
  value       = local.has_domain && (!local.has_zone || !var.manage_domain_dns_record) ? aws_lb.main.dns_name : null
}

output "manual_ses_verification_records_required" {
  description = "Non-null only when var.ses_domain was set but no Route 53 zone was supplied."
  value = local.create_ses && !local.has_zone ? {
    txt_verification = {
      name  = "_amazonses.${var.ses_domain}"
      type  = "TXT"
      value = aws_ses_domain_identity.app[0].verification_token
    }
    dkim_cnames = [
      for token in aws_ses_domain_dkim.app[0].dkim_tokens : {
        name  = "${token}._domainkey.${var.ses_domain}"
        type  = "CNAME"
        value = "${token}.dkim.amazonses.com"
      }
    ]
  } : null
}
