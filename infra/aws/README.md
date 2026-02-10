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
terraform init -backend-config=backend.hcl
```

3. Apply prod infrastructure:

```bash
terraform apply
```

4. Set secret values in AWS Secrets Manager (created by Terraform) and then deploy the container image.

Docs: `docs/deploy/aws.md`
