# Domain/TLS is entirely optional input (var.domain_name / var.route53_zone_id
# / var.alb_certificate_arn — see variables.tf). Without a domain, the ALB
# serves HTTP only on its default *.elb.amazonaws.com DNS name, which is NOT
# sufficient for the Android app (architecture requires HTTPS). Three modes:
#
#   1. var.alb_certificate_arn set            -> use that cert as-is (assumed
#                                                 already ISSUED; this module
#                                                 never validates it).
#   2. var.domain_name + var.route53_zone_id  -> Terraform creates + fully
#                                                 DNS-validates a cert via
#                                                 aws_acm_certificate_validation,
#                                                 and creates the ALB alias
#                                                 record. The HTTPS listener
#                                                 (see locals.tf certificate_arn)
#                                                 only attaches the cert once
#                                                 that validation resource
#                                                 resolves — never the raw,
#                                                 possibly-still-
#                                                 PENDING_VALIDATION
#                                                 aws_acm_certificate ARN.
#   3. var.domain_name only (no zone)          -> Terraform creates the cert
#                                                 (PENDING_VALIDATION) and
#                                                 stops there — no
#                                                 aws_acm_certificate_validation
#                                                 resource exists for this
#                                                 path (nothing here can
#                                                 create the validation DNS
#                                                 records without a zone), so
#                                                 there is nothing safe to
#                                                 attach to a listener yet.
#                                                 local.enable_https is false
#                                                 and NO HTTPS listener is
#                                                 created in this mode. The
#                                                 validation CNAME + the ALB
#                                                 alias target are surfaced in
#                                                 outputs.tf for manual
#                                                 creation in whatever system
#                                                 hosts DNS for that domain.
#                                                 This is deliberately
#                                                 two-stage: once the
#                                                 certificate shows ISSUED in
#                                                 ACM (after that manual DNS
#                                                 record propagates and AWS
#                                                 validates it), re-apply with
#                                                 var.alb_certificate_arn set
#                                                 to this same certificate's
#                                                 ARN to enable HTTPS —
#                                                 switching to mode 1 above. A
#                                                 bare re-apply without that
#                                                 variable set will NOT enable
#                                                 HTTPS on its own.

resource "aws_acm_certificate" "app" {
  count = local.create_managed_cert ? 1 : 0

  domain_name = var.domain_name
  subject_alternative_names = compact([
    var.redirect_domain_name,
    var.verification_domain_name,
  ])
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.create_managed_cert && local.has_zone ? {
    for dvo in aws_acm_certificate.app[0].domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  } : {}

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.value]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "app" {
  count = local.create_managed_cert && local.has_zone ? 1 : 0

  certificate_arn         = aws_acm_certificate.app[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "app_alias" {
  count = local.has_domain && local.has_zone && var.manage_domain_dns_record ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "verification_alias" {
  count = local.has_verification_domain && local.has_zone ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.verification_domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "redirect_alias" {
  count = local.has_redirect_domain && local.has_zone && var.manage_domain_dns_record ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.redirect_domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
