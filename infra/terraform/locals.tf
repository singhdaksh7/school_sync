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
  certificate_arn         = local.has_existing_cert ? var.alb_certificate_arn : (local.create_managed_cert ? aws_acm_certificate.app[0].arn : "")
  enable_https            = local.has_domain && local.certificate_arn != ""

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
