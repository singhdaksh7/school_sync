# AWS RDS certificate bundle

`aws-rds-global-bundle.pem` is the official AWS RDS/Aurora global root CA
bundle, vendored so Node (`NODE_EXTRA_CA_CERTS`) can verify the TLS
certificate chain presented by our RDS instance without relaxing
certificate or hostname verification anywhere.

## Source

- URL: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
- Retrieved: 2026-07-13
- SHA-256: `e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3`
- Size: 165408 bytes, 108 certificates (root CAs only — one per AWS region
  plus a few beta/preview regions; RDS presents the matching
  region-specific intermediate/subordinate certificate during the TLS
  handshake itself, so trusting only the roots is sufficient and is exactly
  what AWS's own documentation recommends this bundle for).
- Confirmed to contain `Amazon RDS ap-south-1 Root CA RSA2048 G1`, the root
  for this deployment's `CACertificateIdentifier` (`rds-ca-rsa2048-g1`).
- Contains certificates only — no private keys, no credentials.

## Update procedure

AWS rotates/adds RDS CAs infrequently (the last major rotation was the
2024 RSA2048/ECC384 G1 rollout). To refresh this file:

```sh
curl -sS -o certs/aws-rds-global-bundle.pem \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
sha256sum certs/aws-rds-global-bundle.pem
```

Then update the SHA-256, size, and "Retrieved" date above to match, and
re-run `tests/rds-ca-bundle.test.ts` (which validates the file structurally
and checks OpenSSL can parse every certificate).

Only ever download from the `truststore.pki.rds.amazonaws.com` HTTPS
endpoint — never accept this file from any other source.
