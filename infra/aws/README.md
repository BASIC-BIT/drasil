# AWS Deployment (Terraform)

This directory contains Terraform for deploying Drasil to AWS.

Layout:

- `infra/aws/bootstrap`: one-time setup for Terraform remote state (S3 + DynamoDB lock table)
- `infra/aws/prod`: production infrastructure (ECR + ECS Fargate + networking + IAM)

## Quick start

1. Bootstrap remote state (one-time per AWS account):

```bash
cd infra/aws/bootstrap
terraform init
terraform apply
```

2. Configure the `prod` backend:

```bash
cd infra/aws/prod
cp backend.hcl.example backend.hcl
# Edit backend.hcl and replace REPLACE_ME with the state bucket name from step 1
terraform init -backend-config=backend.hcl
```

3. Apply prod infrastructure:

```bash
terraform apply
```

4. Set secret values in AWS Secrets Manager (created by Terraform) and then deploy the container image.

Docs: `docs/deploy/aws.md`

## IaC policy posture (Checkov)

- Checkov runs in enforced mode in CI (`soft_fail: false`).
- The Terraform in `infra/aws` now satisfies baseline hardening checks including:
  - customer-managed KMS keys for state/data-plane resources,
  - VPC Flow Logs,
  - default security group lockdown,
  - DynamoDB point-in-time recovery,
  - 365-day CloudWatch retention.
- A small set of checks is intentionally skipped inline with `checkov:skip=...` comments and rationale, including:
  - public-subnet/public-IP networking for the current cost-optimized topology,
  - deferred Secrets Manager automatic rotation (requires Lambda + operational runbook),
  - Terraform backend bucket controls that are not currently required (replication/events/access logs),
  - unavoidable wildcard scope in KMS key policy semantics.
