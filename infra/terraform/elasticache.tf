# Valkey replication group. Staging defaults to one cost-conscious node;
# production guardrails require two nodes with automatic failover and Multi-AZ.
# Both shapes support transit encryption + an AUTH token, which rate-limit
# compatibility relies on (see
# src/lib/rate-limit.ts RedisProtocolRateLimiter, wired via RATE_LIMIT_REDIS_URL
# using the rediss:// scheme + RATE_LIMIT_REDIS_TOKEN as the AUTH password).

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name_prefix}-redis"
  subnet_ids = aws_subnet.private[*].id
}

resource "random_password" "redis_auth" {
  length  = 32
  special = false # ElastiCache AUTH tokens reject several special characters; keep it simple/safe.
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${local.name_prefix}-valkey"
  description          = "SchoolSync ${var.environment} rate-limit / cache store"

  engine         = "valkey"
  engine_version = var.redis_engine_version
  node_type      = var.redis_node_type

  num_cache_clusters         = var.redis_multi_az ? 2 : 1
  automatic_failover_enabled = var.redis_multi_az
  multi_az_enabled           = var.redis_multi_az

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  apply_immediately = true

  tags = { Name = "${local.name_prefix}-valkey" }

  lifecycle {
    precondition {
      condition     = var.environment != "production" || var.redis_multi_az
      error_message = "environment=production requires redis_multi_az=true."
    }
  }
}
