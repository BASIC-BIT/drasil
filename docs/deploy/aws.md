# AWS Production Deployment (ECS Fargate)

This repo can be deployed as a long-running Discord bot on AWS ECS Fargate.

The defaults are intentionally simple:

- ECS Fargate service with `desired_count = 0` initially (set to 1 after first successful deploy)
- Public subnets + public IP (outbound-only) to avoid NAT Gateway cost
- Secrets stored in AWS Secrets Manager
- Customer-managed KMS keys for encryption at rest (state + runtime resources)
- VPC Flow Logs enabled to CloudWatch Logs

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
 # Edit backend.hcl and replace REPLACE_ME values (e.g. the state bucket name)
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

If your AWS account already has the standard GitHub Actions OIDC provider
(`token.actions.githubusercontent.com`), set `github_oidc_provider_arn` when
applying `infra/aws/prod` so this stack reuses it.

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
- tag it with the commit SHA
- register a new ECS task definition revision pinned to that image
- update the ECS service to the new task definition and wait for it to stabilize

## Rollback

Re-run the deploy workflow and set the `ref` input to an older commit SHA. The workflow resolves that commit SHA and reuses the existing immutable ECR tag if it already exists (or builds/pushes it if missing), then updates ECS to a new task definition revision referencing that image.

## Notes

- The Terraform-managed task definition uses a placeholder image tag (`:bootstrap`). The deploy workflow registers task definitions using immutable commit SHA tags.
- `desired_count` defaults to `0` so the initial `terraform apply` does not churn on the placeholder image tag. After the first deploy succeeds, set `desired_count=1` for normal bot operation.
- The ECS service task definition is updated by the deploy workflow; Terraform intentionally ignores `task_definition` drift to avoid fighting deploys.
- If/when we add sharding, we can increase `desired_count` and/or move to a more controlled rollout.
- If you prefer private subnets, add a NAT Gateway and set `assign_public_ip = false` in `infra/aws/prod/main.tf`.
- Secrets Manager automatic rotation is intentionally not configured yet; it requires a rotation Lambda and an ops runbook.
