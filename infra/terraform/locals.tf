locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )

  has_domain              = var.domain_name != ""
  has_redirect_domain     = var.redirect_domain_name != ""
  has_verification_domain = var.verification_domain_name != ""
  has_zone                = var.route53_zone_id != ""
  has_existing_cert       = var.alb_certificate_arn != ""
  create_managed_cert     = local.has_domain && !local.has_existing_cert

  # NEVER aws_acm_certificate.app[0].arn directly — that ARN exists the
  # instant the certificate resource is created, while the certificate
  # itself is still PENDING_VALIDATION, well before DNS validation
  # completes. The HTTPS listener (alb.tf) must not attach a cert ACM
  # hasn't finished validating.
  #   - An explicitly supplied var.alb_certificate_arn always wins (assumed
  #     already ISSUED — this module does not manage or validate it).
  #   - Route53-managed path (a zone was supplied): aws_route53_record.cert_validation
  #     creates the DNS validation records automatically, and
  #     aws_acm_certificate_validation.app[0].certificate_arn only resolves
  #     once ACM confirms validation — referencing it here forces Terraform
  #     to wait for that before the listener can use it.
  #   - Manual/external-DNS path (domain supplied, no zone): there is no
  #     aws_acm_certificate_validation resource at all (see its count in
  #     acm-dns.tf), so there is nothing safe to attach yet. certificate_arn
  #     is "" and enable_https below is false — Terraform creates the
  #     PENDING_VALIDATION certificate and surfaces the validation records
  #     to create externally (outputs.tf's manual_acm_validation_records_required)
  #     but does NOT stand up an HTTPS listener from that alone. Once the
  #     certificate shows ISSUED in ACM, re-apply with var.alb_certificate_arn
  #     set to this same certificate's ARN (switching to the first branch
  #     above) to enable HTTPS — a deliberate two-stage process, not a bug.
  certificate_arn = local.has_existing_cert ? var.alb_certificate_arn : (
    local.create_managed_cert && local.has_zone ? aws_acm_certificate_validation.app[0].certificate_arn : ""
  )
  enable_https = local.has_domain && local.certificate_arn != ""

  create_ses = var.ses_domain != ""

  # Internal service-discovery DNS name the worker uses to reach the web
  # service's /api/internal/worker endpoint without going out through the
  # public ALB. See ecs.tf / service-discovery.tf.
  service_discovery_namespace = "${local.name_prefix}.local"
  web_internal_dns            = "web.${local.service_discovery_namespace}"
  worker_internal_url         = "http://${local.web_internal_dns}:${var.container_port}/api/internal/worker"

  # Staging can retain the cost-conscious public-subnet posture. Production
  # is guarded in ecs.tf and must select private subnets + NAT egress.
  ecs_task_subnet_ids  = var.ecs_use_private_subnets ? aws_subnet.private[*].id : aws_subnet.public[*].id
  ecs_assign_public_ip = !var.ecs_use_private_subnets

  # CloudWatch alarm notification destination — see cloudwatch.tf. An
  # existing topic ARN always wins; otherwise create one only if an email
  # was supplied; otherwise alarms exist with no alarm_actions.
  create_alarm_topic = var.alarm_sns_topic_arn == "" && var.alarm_notification_email != ""
  alarm_topic_arn    = var.alarm_sns_topic_arn != "" ? var.alarm_sns_topic_arn : (local.create_alarm_topic ? aws_sns_topic.alarms[0].arn : "")
  alarm_actions      = local.alarm_topic_arn != "" ? [local.alarm_topic_arn] : []

  # Production database safety floor — see rds.tf's lifecycle.precondition
  # block. Meaningfully longer than staging's 3-day default (variables.tf
  # db_backup_retention_days), not just "more than zero".
  production_min_backup_retention_days = 7

  # member_clusters is a set(string), so it has no index. Monitor the first
  # primary/member cluster with the existing alarms; production also has
  # replication-group failover protection through its second Multi-AZ node.
  redis_cache_cluster_id = tolist(aws_elasticache_replication_group.main.member_clusters)[0]
}
