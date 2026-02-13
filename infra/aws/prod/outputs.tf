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

output "resource_group_name" {
  value       = aws_resourcegroups_group.project.name
  description = "AWS Resource Group name for this environment."
}

output "ops_alert_topic_arn" {
  value       = try(aws_sns_topic.ops_alerts[0].arn, null)
  description = "SNS topic ARN used for operational alarms (null when observability is disabled)."
}

output "operations_dashboard_name" {
  value       = try(aws_cloudwatch_dashboard.operations[0].dashboard_name, null)
  description = "CloudWatch dashboard name for ECS operational metrics (null when observability is disabled)."
}

output "cost_controls_enabled" {
  value       = local.cost_controls_enabled
  description = "Whether cost-control resources are enabled in this stack."
}

output "monthly_budget_name" {
  value       = try(aws_budgets_budget.monthly_cost[0].name, null)
  description = "AWS Budget name for monthly cost alerts (null when cost notifications are not configured)."
}

output "cost_anomaly_monitor_arn" {
  value       = try(aws_ce_anomaly_monitor.service_costs[0].arn, null)
  description = "Cost Anomaly Detection monitor ARN (null when cost controls are disabled)."
}
