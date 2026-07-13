# Provisions the AWS side of SES domain verification, and grants the web ECS
# task role permission to send from it. src/lib/email.ts's SesEmailProvider
# uses the AWS SDK default credential provider chain (no static key, no SES
# API-key env var) — on ECS that resolves to aws_iam_role.ecs_task_web via
# the container credential provider, same pattern as S3 (see s3.tf).
resource "aws_ses_domain_identity" "app" {
  count  = local.create_ses ? 1 : 0
  domain = var.ses_domain
}

resource "aws_ses_domain_dkim" "app" {
  count  = local.create_ses ? 1 : 0
  domain = aws_ses_domain_identity.app[0].domain
}

resource "aws_route53_record" "ses_verification" {
  count = local.create_ses && local.has_zone ? 1 : 0

  zone_id = var.route53_zone_id
  name    = "_amazonses.${var.ses_domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.app[0].verification_token]
}

resource "aws_route53_record" "ses_dkim" {
  count = local.create_ses && local.has_zone ? 3 : 0

  zone_id = var.route53_zone_id
  name    = "${aws_ses_domain_dkim.app[0].dkim_tokens[count.index]}._domainkey.${var.ses_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.app[0].dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# ── SES send permission on the web ECS task role only ──────────────────────
#
# Scoped to exactly ses:SendEmail/ses:SendRawEmail on this one verified
# identity — no wildcard resource, no access to any other domain/identity in
# the account. Worker and migrate tasks never send email (see iam.tf), so
# they get no SES policy at all, matching the existing S3 least-privilege
# split.
data "aws_iam_policy_document" "ses_send" {
  count = local.create_ses ? 1 : 0

  statement {
    sid       = "SendFromVerifiedDomain"
    effect    = "Allow"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = [aws_ses_domain_identity.app[0].arn]
  }
}

resource "aws_iam_role_policy" "web_ses" {
  count  = local.create_ses ? 1 : 0
  name   = "${local.name_prefix}-web-ses-send"
  role   = aws_iam_role.ecs_task_web.id
  policy = data.aws_iam_policy_document.ses_send[0].json
}
