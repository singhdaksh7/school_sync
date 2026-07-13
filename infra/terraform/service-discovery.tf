# Lets the worker task reach the web task's /api/internal/worker endpoint over
# a private VPC DNS name (http://web.<namespace>/...) instead of round-
# tripping through the public-facing ALB. Cloud Map private DNS namespaces
# work for any resource in the VPC regardless of public/private subnet
# placement — this is independent of the NAT Gateway decision in vpc.tf.
resource "aws_service_discovery_private_dns_namespace" "main" {
  name = local.service_discovery_namespace
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "web" {
  name = "web"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}
