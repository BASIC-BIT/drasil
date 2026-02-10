output "aws_region" {
  value       = var.aws_region
  description = "AWS region used for this environment."
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.app.repository_url
  description = "ECR repository URL for the Drasil image."
}

output "ecr_repository_name" {
  value       = aws_ecr_repository.app.name
  description = "ECR repository name (set GitHub variable ECR_REPOSITORY to this)."
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.main.name
  description = "ECS cluster name."
}

output "ecs_service_name" {
  value       = aws_ecs_service.bot.name
  description = "ECS service name."
}

output "github_deploy_role_arn" {
  value       = aws_iam_role.github_deploy.arn
  description = "IAM role ARN for GitHub Actions (OIDC) deployments."
}

output "github_oidc_provider_arn" {
  value       = local.github_oidc_provider_arn
  description = "GitHub Actions OIDC provider ARN used by this environment."
}

output "secrets" {
  value = {
    DISCORD_TOKEN  = aws_secretsmanager_secret.discord_token.arn
    OPENAI_API_KEY = aws_secretsmanager_secret.openai_api_key.arn
    DATABASE_URL   = aws_secretsmanager_secret.database_url.arn
  }
  description = "Secrets Manager secret ARNs created for this environment."
}
