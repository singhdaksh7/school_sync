resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = var.enable_container_insights ? "enabled" : "disabled"
  }
}

locals {
  ecr_image = "${data.aws_ecr_repository.app.repository_url}:${var.image_tag}"

  # Every JSON key in the shared app secret becomes a `secrets` entry for the
  # web container (it's the only one that needs the full set: DB, storage,
  # rate-limit, email, AI). Worker/migrate pull only the specific keys they
  # actually use (JOB_WORKER_SECRET; DATABASE_URL/DIRECT_URL) — see below.
  web_secrets = [
    for key in keys(local.app_secret_map) : {
      name      = key
      valueFrom = "${aws_secretsmanager_secret.app.arn}:${key}::"
    }
  ]

  web_environment = concat(
    [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = tostring(var.container_port) },
      { name = "HOSTNAME", value = "0.0.0.0" },
      # Explicit, no-fallback email provider selection (src/lib/email.ts
      # getEmailProviderKind()) — never rely on RESEND_API_KEY's mere
      # presence to pick a provider. Only the web task gets this: worker and
      # migrate never send email (see iam.tf / ses.tf).
      { name = "EMAIL_PROVIDER", value = lower(var.email_provider) },
    ],
    var.app_base_url != "" ? [
      { name = "NEXTAUTH_URL", value = var.app_base_url },
      { name = "AUTH_URL", value = var.app_base_url },
    ] : []
  )
}

# ── Web / API service ───────────────────────────────────────────────────

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.web_cpu)
  memory                   = tostring(var.web_memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  # S3 permissions (GetObject/PutObject/DeleteObject on this bucket only —
  # see s3.tf) live on this role; the AWS SDK's default credential provider
  # chain in src/lib/storage-s3.ts resolves to it automatically since no
  # STORAGE_ACCESS_KEY_ID/SECRET_ACCESS_KEY is ever set on this container.
  task_role_arn = aws_iam_role.ecs_task_web.arn

  container_definitions = jsonencode([
    {
      name         = "web"
      image        = local.ecr_image
      essential    = true
      portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]
      environment  = local.web_environment
      secrets      = local.web_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.web.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "web"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${var.container_port}${var.health_check_path}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }
    }
  ])

  # Day-to-day image rollouts go through infra/scripts/update-web-service.ps1
  # (register a new task-def revision via AWS CLI + force-new-deployment),
  # not `terraform apply` — this keeps Terraform from reverting an
  # AWS-CLI-driven rollout back to var.image_tag on the next plan.
  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_service" "web" {
  name            = "${local.name_prefix}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = var.container_port
  }

  service_registries {
    registry_arn = aws_service_discovery_service.web.arn
  }

  health_check_grace_period_seconds = 60

  # Rolling deployment: allow a full second task to start (200%) before the
  # old one is stopped, never drop below 100% capacity during a rollout.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # If the new task definition revision fails ALB health checks (or the
  # container never reaches RUNNING), ECS automatically stops the rollout
  # and reverts the service back to the previous, last-known-good task
  # definition — no manual intervention needed for the common "bad image /
  # broken container" failure mode. This does NOT replace the readiness gate
  # in deploy-staging.ps1 (Test-AppReadiness): the circuit breaker only sees
  # ALB/container health (liveness), not application-level readiness
  # (missing S3/Redis/email config) — a task can be liveness-healthy and
  # still readiness-degraded, which is exactly why that separate gate exists.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.http]
}

# ── Worker service (long-running poller, npm run worker) ─────────────────

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name_prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.worker_cpu)
  memory                   = tostring(var.worker_memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  # No S3 access — the worker only calls the web service's internal HTTP
  # endpoint (scripts/worker.ts), never the AWS SDK. See iam.tf.
  task_role_arn = aws_iam_role.ecs_task_minimal.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = local.ecr_image
      essential = true
      command   = ["npm", "run", "worker"]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "WORKER_INTERNAL_URL", value = local.worker_internal_url },
      ]
      secrets = [
        { name = "JOB_WORKER_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:JOB_WORKER_SECRET::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])

  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_service" "worker" {
  name            = "${local.name_prefix}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  # Same rolling-deployment + auto-rollback posture as the web service (see
  # aws_ecs_service.web for the full rationale). The worker has no ALB, so
  # "failed health checks" here means the container never reaches RUNNING /
  # exits immediately — the circuit breaker still catches that and rolls
  # back automatically.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_ecs_service.web]
}

# ── Migration task definition (run on-demand via `aws ecs run-task`, not a
#    standing service — see infra/scripts/run-migrations.ps1) ──────────────

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name_prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.migration_cpu)
  memory                   = tostring(var.migration_memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  # No S3 access — `prisma migrate deploy` only talks to RDS via
  # DATABASE_URL/DIRECT_URL, never the AWS SDK. See iam.tf.
  task_role_arn = aws_iam_role.ecs_task_minimal.arn

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = local.ecr_image
      essential = true
      command   = ["npx", "prisma", "migrate", "deploy"]
      environment = [
        { name = "NODE_ENV", value = "production" },
      ]
      secrets = [
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" },
        { name = "DIRECT_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:DIRECT_URL::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.migrate.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "migrate"
        }
      }
    }
  ])

  lifecycle {
    ignore_changes = [container_definitions]
  }
}
