# AWS-native replacement for the Vercel Cron entries used by preview/test
# deployments. These schedules enqueue maintenance work through the same
# authenticated internal endpoints as the application; the standing ECS
# worker performs the actual durable jobs. Disabled during initial production
# build-out so no request can reach the still-live Vercel/Neon deployment
# before the reviewed DNS cutover.

locals {
  maintenance_base_url = trimsuffix(var.app_base_url, "/")
  maintenance_routes = {
    school_purge = {
      path     = "/api/internal/maintenance/school-purge"
      schedule = var.school_purge_schedule_expression
    }
    file_retention = {
      path     = "/api/internal/maintenance/file-retention"
      schedule = var.file_retention_schedule_expression
    }
  }
}

resource "aws_cloudwatch_event_connection" "maintenance" {
  count = var.enable_maintenance_schedules ? 1 : 0

  name               = "${local.name_prefix}-maintenance"
  description        = "Authenticates EventBridge maintenance calls to SchoolSync"
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "x-worker-secret"
      value = random_password.job_worker_secret.result
    }
  }

  lifecycle {
    precondition {
      condition     = startswith(var.app_base_url, "https://")
      error_message = "enable_maintenance_schedules=true requires an https:// app_base_url."
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "maintenance" {
  for_each = var.enable_maintenance_schedules ? local.maintenance_routes : {}

  name                             = "${local.name_prefix}-${replace(each.key, "_", "-")}"
  description                      = "Enqueue SchoolSync ${replace(each.key, "_", " ")} maintenance work"
  invocation_endpoint              = "${local.maintenance_base_url}${each.value.path}"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.maintenance[0].arn
}

resource "aws_cloudwatch_event_rule" "maintenance" {
  for_each = var.enable_maintenance_schedules ? local.maintenance_routes : {}

  name                = "${local.name_prefix}-${replace(each.key, "_", "-")}"
  description         = "SchoolSync ${replace(each.key, "_", " ")} schedule"
  schedule_expression = each.value.schedule
  state               = "ENABLED"

  tags = { Name = "${local.name_prefix}-${replace(each.key, "_", "-")}" }
}

data "aws_iam_policy_document" "eventbridge_api_destination_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eventbridge_api_destination" {
  count = var.enable_maintenance_schedules ? 1 : 0

  name               = "${local.name_prefix}-eventbridge-maintenance"
  assume_role_policy = data.aws_iam_policy_document.eventbridge_api_destination_assume.json
  tags               = { Name = "${local.name_prefix}-eventbridge-maintenance" }
}

data "aws_iam_policy_document" "eventbridge_api_destination" {
  count = var.enable_maintenance_schedules ? 1 : 0

  statement {
    sid       = "InvokeMaintenanceDestinations"
    effect    = "Allow"
    actions   = ["events:InvokeApiDestination"]
    resources = values(aws_cloudwatch_event_api_destination.maintenance)[*].arn
  }
}

resource "aws_iam_role_policy" "eventbridge_api_destination" {
  count = var.enable_maintenance_schedules ? 1 : 0

  name   = "${local.name_prefix}-invoke-maintenance"
  role   = aws_iam_role.eventbridge_api_destination[0].id
  policy = data.aws_iam_policy_document.eventbridge_api_destination[0].json
}

resource "aws_cloudwatch_event_target" "maintenance" {
  for_each = var.enable_maintenance_schedules ? local.maintenance_routes : {}

  rule     = aws_cloudwatch_event_rule.maintenance[each.key].name
  arn      = aws_cloudwatch_event_api_destination.maintenance[each.key].arn
  role_arn = aws_iam_role.eventbridge_api_destination[0].arn

  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 3
  }
}
