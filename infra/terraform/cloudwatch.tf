resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name_prefix}/web"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${local.name_prefix}/worker"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${local.name_prefix}/migrate"
  retention_in_days = var.log_retention_days
}

# ── Alarm notification destination (optional) ───────────────────────────────
#
# Only created when alarm_notification_email is set and alarm_sns_topic_arn
# is not (see locals.tf create_alarm_topic). No email address is ever
# hard-coded here — it only ever comes from the variable, which itself has
# no default value.
resource "aws_sns_topic" "alarms" {
  count = local.create_alarm_topic ? 1 : 0
  name  = "${local.name_prefix}-alarms"
}

resource "aws_sns_topic_subscription" "alarms_email" {
  count     = local.create_alarm_topic ? 1 : 0
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_notification_email
}

# ── Alarms ────────────────────────────────────────────────────────────────
#
# Names are environment-scoped via local.name_prefix (e.g.
# "schoolsync-staging-alb-unhealthy-targets" vs
# "schoolsync-production-alb-unhealthy-targets"), so staging and a future
# production environment never collide in the CloudWatch console or in SNS
# message routing. alarm_actions is local.alarm_actions everywhere — an
# empty list (no destination configured) is a valid, inert state; it does
# not fail `terraform apply`.

resource "aws_cloudwatch_metric_alarm" "alb_unhealthy_targets" {
  alarm_name          = "${local.name_prefix}-alb-unhealthy-targets"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  period              = 60
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_description   = "One or more web targets have failed the ALB health check for 2+ consecutive minutes."
  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.web.arn_suffix
  }
  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.name_prefix}-alb-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 60
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_description   = "The web service returned more than 10 5xx responses/min for 3+ consecutive minutes."
  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.web.arn_suffix
  }
  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "ecs_web_cpu" {
  alarm_name          = "${local.name_prefix}-ecs-web-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 60
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  threshold           = var.alarm_web_cpu_threshold_percent
  treat_missing_data  = "notBreaching"
  alarm_description   = "Web service CPU above ${var.alarm_web_cpu_threshold_percent}% for 3+ consecutive minutes."
  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.web.name
  }
  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "ecs_web_memory" {
  alarm_name          = "${local.name_prefix}-ecs-web-memory"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 60
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  threshold           = var.alarm_web_memory_threshold_percent
  treat_missing_data  = "notBreaching"
  alarm_description   = "Web service memory above ${var.alarm_web_memory_threshold_percent}% for 3+ consecutive minutes."
  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.web.name
  }
  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "ecs_worker_cpu" {
  alarm_name          = "${local.name_prefix}-ecs-worker-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 60
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  threshold           = var.alarm_worker_cpu_threshold_percent
  treat_missing_data  = "notBreaching"
  alarm_description   = "Worker service CPU above ${var.alarm_worker_cpu_threshold_percent}% for 3+ consecutive minutes."
  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.worker.name
  }
  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

# "Repeated task failure" proxy: only available with Container Insights
# enabled (var.enable_container_insights, off by default for staging cost
# reasons — see variables.tf), which publishes RunningTaskCount under the
# ECS/ContainerInsights namespace. Without Container Insights there is no
# standard CloudWatch metric that directly represents "the worker keeps
# crash-looping" — the base AWS/ECS namespace only has CPU/Memory.
resource "aws_cloudwatch_metric_alarm" "ecs_worker_running_tasks" {
  count               = var.enable_container_insights ? 1 : 0
  alarm_name          = "${local.name_prefix}-ecs-worker-running-tasks-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  period              = 60
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  statistic           = "Average"
  threshold           = var.worker_desired_count
  treat_missing_data  = "breaching"
  alarm_description   = "Worker running task count below desired (${var.worker_desired_count}) for 3+ consecutive minutes - likely crash-looping."
  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.worker.name
  }
  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name_prefix}-rds-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 60
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  threshold           = var.alarm_rds_cpu_threshold_percent
  treat_missing_data  = "notBreaching"
  alarm_description   = "RDS CPU above ${var.alarm_rds_cpu_threshold_percent}% for 3+ consecutive minutes."
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "${local.name_prefix}-rds-low-storage"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  period              = 300
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  threshold           = var.alarm_rds_free_storage_threshold_bytes
  treat_missing_data  = "notBreaching"
  alarm_description   = "RDS free storage below ${var.alarm_rds_free_storage_threshold_bytes} bytes."
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${local.name_prefix}-rds-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 60
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Average"
  threshold           = var.alarm_rds_connections_threshold
  treat_missing_data  = "notBreaching"
  alarm_description   = "RDS connection count above ${var.alarm_rds_connections_threshold} for 3+ consecutive minutes."
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "${local.name_prefix}-redis-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 60
  namespace           = "AWS/ElastiCache"
  metric_name         = "EngineCPUUtilization"
  statistic           = "Average"
  threshold           = var.alarm_redis_cpu_threshold_percent
  treat_missing_data  = "notBreaching"
  alarm_description   = "ElastiCache Valkey engine CPU above ${var.alarm_redis_cpu_threshold_percent}% for 3+ consecutive minutes."
  dimensions = {
    CacheClusterId = local.redis_cache_cluster_id
  }
  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  alarm_name          = "${local.name_prefix}-redis-memory"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 60
  namespace           = "AWS/ElastiCache"
  metric_name         = "DatabaseMemoryUsagePercentage"
  statistic           = "Average"
  threshold           = var.alarm_redis_memory_threshold_percent
  treat_missing_data  = "notBreaching"
  alarm_description   = "ElastiCache Valkey memory usage above ${var.alarm_redis_memory_threshold_percent}% for 3+ consecutive minutes."
  dimensions = {
    CacheClusterId = local.redis_cache_cluster_id
  }
  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}
