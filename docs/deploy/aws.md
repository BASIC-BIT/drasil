# AWS Production Deployment (ECS Fargate)

This repo can be deployed as a long-running Discord bot on AWS ECS Fargate.

The defaults are intentionally simple:

- ECS Fargate service with `desired_count = 1` (Discord bot should not run multiple instances yet)
- Public subnets + public IP (outbound-only) to avoid NAT Gateway cost
- Secrets stored in AWS Secrets Manager

## Prerequisites

- Terraform >= 1.6
- AWS account + credentials with permissions to create the resources in `infra/aws`
- Docker (for building/pushing the image)

## 1) Provision Terraform remote state (one-time)

```bash
cd infra/aws/bootstrap
terraform init
terraform apply
```

You will be prompted for a globally unique `state_bucket_name`.

## 2) Provision production infrastructure

```bash
cd infra/aws/prod
cp backend.hcl.example backend.hcl
terraform init -backend-config=backend.hcl
terraform apply
```

Terraform creates:

- VPC + 2 public subnets
- ECR repository
- ECS cluster + Fargate service
- CloudWatch log group
- Secrets Manager secrets (metadata only; you set the values)
- GitHub Actions OIDC role for deploys

## 3) Set production secrets

Terraform creates three Secrets Manager secrets:

- `drasil/prod/DISCORD_TOKEN`
- `drasil/prod/OPENAI_API_KEY`
- `drasil/prod/DATABASE_URL`

Set their values (console or CLI). Example:

```bash
aws secretsmanager put-secret-value \
  --secret-id "drasil/prod/DISCORD_TOKEN" \
  --secret-string "<discord-token>"
```

Repeat for the other secrets.

## 4) Configure GitHub Actions deploy variables

The deploy workflow is `workflow_dispatch` (manual) and expects repository variables:

- `AWS_REGION` (e.g. `us-east-1`)
- `AWS_ROLE_TO_ASSUME` (Terraform output: `github_deploy_role_arn`)
- `ECR_REPOSITORY` (Terraform output: `ecr_repository_name`)
- `ECS_CLUSTER` (Terraform output: `ecs_cluster_name`)
- `ECS_SERVICE` (Terraform output: `ecs_service_name`)

## 5) Deploy

Run the workflow:

- GitHub -> Actions -> "Deploy (prod)" -> Run workflow

It will:

- build and push the container image to ECR
- tag it as both the commit SHA and `latest`
- force a new ECS deployment (service will pull `latest`)

## Rollback

Re-run the deploy workflow and set the `ref` input to an older commit SHA. That rebuilds that version and publishes it as `latest`, then forces a redeploy.

## Notes

- If/when we add sharding, we can increase `desired_count` and/or move to a more controlled rollout.
- If you prefer private subnets, add a NAT Gateway and set `assign_public_ip = false` in `infra/aws/prod/main.tf`.
