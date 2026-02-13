data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  secrets_prefix = "${var.project_name}/${var.environment}"

  github_oidc_provider_arn = var.github_oidc_provider_arn != null ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn

  common_tags = merge(
    var.tags,
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "basic-bit/drasil"
      Service     = "discord-bot"
      Component   = "infrastructure"
    }
  )

  notifications_enabled = length(var.alert_email_addresses) > 0
  observability_enabled = var.enable_observability
  cost_controls_enabled = var.enable_cost_controls
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  #checkov:skip=CKV_AWS_130:Public subnets are intentional for this initial ECS topology.
  count = 2

  vpc_id                  = aws_vpc.main.id
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.name_prefix}-public-${count.index + 1}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${local.name_prefix}-public"
  }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "ecs_task" {
  #checkov:skip=CKV_AWS_382:Tasks require outbound internet access to Discord/OpenAI APIs in this phase.
  name        = "${local.name_prefix}-ecs-task"
  description = "ECS task security group (no inbound; outbound-only)."
  vpc_id      = aws_vpc.main.id

  egress {
    description = "Allow all outbound internet traffic for bot API dependencies."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-ecs-task"
  }
}

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.prod.arn
}

resource "aws_cloudwatch_log_group" "vpc_flow" {
  name              = "/vpc-flow/${local.name_prefix}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.prod.arn
}

resource "aws_ecr_repository" "app" {
  name                 = local.name_prefix
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.prod.arn
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire old images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 50
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_secretsmanager_secret" "discord_token" {
  name = "${local.secrets_prefix}/DISCORD_TOKEN"
  #checkov:skip=CKV2_AWS_57:Automatic rotation requires dedicated rotation Lambda + runbook and is deferred intentionally.
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.prod.arn
}

resource "aws_secretsmanager_secret" "openai_api_key" {
  name = "${local.secrets_prefix}/OPENAI_API_KEY"
  #checkov:skip=CKV2_AWS_57:Automatic rotation requires dedicated rotation Lambda + runbook and is deferred intentionally.
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.prod.arn
}

resource "aws_secretsmanager_secret" "database_url" {
  name = "${local.secrets_prefix}/DATABASE_URL"
  #checkov:skip=CKV2_AWS_57:Automatic rotation requires dedicated rotation Lambda + runbook and is deferred intentionally.
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.prod.arn
}

resource "aws_default_security_group" "main" {
  vpc_id = aws_vpc.main.id

  ingress = []
  egress  = []

  tags = {
    Name = "${local.name_prefix}-default-sg"
  }
}

data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_task_execution_secrets" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [
      aws_secretsmanager_secret.discord_token.arn,
      aws_secretsmanager_secret.openai_api_key.arn,
      aws_secretsmanager_secret.database_url.arn
    ]
  }

  statement {
    actions = [
      "kms:Decrypt"
    ]
    resources = [aws_kms_key.prod.arn]
  }
}

resource "aws_iam_policy" "ecs_task_execution_secrets" {
  name   = "${local.name_prefix}-ecs-execution-secrets"
  policy = data.aws_iam_policy_document.ecs_task_execution_secrets.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_secrets" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = aws_iam_policy.ecs_task_execution_secrets.arn
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = var.container_insights ? "enabled" : "disabled"
  }
}

resource "aws_flow_log" "main" {
  log_destination      = aws_cloudwatch_log_group.vpc_flow.arn
  log_destination_type = "cloud-watch-logs"
  iam_role_arn         = aws_iam_role.vpc_flow_logs.arn
  traffic_type         = "ALL"
  vpc_id               = aws_vpc.main.id
}

resource "aws_ecs_task_definition" "bot" {
  #checkov:skip=CKV_AWS_336:Read-only root filesystem needs runtime validation for dependencies writing temp files.
  family                   = local.name_prefix
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "drasil"
      image     = "${aws_ecr_repository.app.repository_url}:bootstrap"
      essential = true
      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        }
      ]
      secrets = [
        {
          name      = "DISCORD_TOKEN"
          valueFrom = aws_secretsmanager_secret.discord_token.arn
        },
        {
          name      = "OPENAI_API_KEY"
          valueFrom = aws_secretsmanager_secret.openai_api_key.arn
        },
        {
          name      = "DATABASE_URL"
          valueFrom = aws_secretsmanager_secret.database_url.arn
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.ecs.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "bot" {
  #checkov:skip=CKV_AWS_333:Public IP assignment is intentional while using public subnets in the initial deployment.
  name            = "${local.name_prefix}-bot"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.bot.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # Discord bots should generally run a single active instance unless sharding/leader election is implemented.
  # These settings avoid overlapping tasks during deployments.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_task.id]
    assign_public_ip = true
  }

  # Task definition revisions are managed by CI/CD (deploy workflow), not Terraform.
  # Ignoring drift here avoids `terraform apply` fighting deployments.
  lifecycle {
    ignore_changes = [task_definition]
  }
}

# GitHub Actions OIDC deploy role (optional but recommended for CI/CD)
# Note: OIDC providers are account-wide. If the provider already exists, pass
# `var.github_oidc_provider_arn` to reuse it.
resource "aws_iam_openid_connect_provider" "github" {
  count = var.github_oidc_provider_arn == null ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = var.github_oidc_thumbprints
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${lower(var.github_repo)}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${local.name_prefix}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

data "aws_iam_policy_document" "github_deploy" {
  #checkov:skip=CKV_AWS_356:Some ECS/ECR actions (for deployment APIs) require wildcard resources.
  statement {
    actions = [
      "ecr:GetAuthorizationToken"
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:DescribeImages"
    ]
    resources = [aws_ecr_repository.app.arn]
  }

  statement {
    actions = [
      "ecs:DescribeServices"
    ]
    resources = [aws_ecs_service.bot.id]
  }

  statement {
    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition"
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "ecs:UpdateService"
    ]
    # aws_ecs_service does not export a dedicated `arn` attribute; `id` is the service ARN.
    resources = [aws_ecs_service.bot.id]
  }

  statement {
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.ecs_task_execution.arn,
      aws_iam_role.ecs_task.arn
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_policy" "github_deploy" {
  name   = "${local.name_prefix}-github-deploy"
  policy = data.aws_iam_policy_document.github_deploy.json
}

resource "aws_iam_role_policy_attachment" "github_deploy" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = aws_iam_policy.github_deploy.arn
}

data "aws_iam_policy_document" "kms" {
  #checkov:skip=CKV_AWS_109:KMS key policies require wildcard resources; access is constrained by principals and service usage.
  #checkov:skip=CKV_AWS_111:KMS key policies require wildcard resources; access is constrained by principals and service usage.
  #checkov:skip=CKV_AWS_356:KMS key policies require wildcard resources by design.
  statement {
    sid = "EnableRootPermissions"

    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid = "AllowServiceUse"

    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
      "kms:CreateGrant"
    ]
    resources = ["*"]

    principals {
      type = "Service"
      identifiers = [
        "logs.${var.aws_region}.amazonaws.com",
        "secretsmanager.amazonaws.com",
        "ecr.amazonaws.com",
        "sns.amazonaws.com"
      ]
    }
  }
}

resource "aws_kms_key" "prod" {
  description         = "CMK for ${local.name_prefix} production resources"
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.kms.json
}

resource "aws_kms_alias" "prod" {
  name          = "alias/${local.name_prefix}-prod"
  target_key_id = aws_kms_key.prod.key_id
}

data "aws_iam_policy_document" "vpc_flow_logs_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "vpc_flow_logs" {
  name               = "${local.name_prefix}-vpc-flow-logs"
  assume_role_policy = data.aws_iam_policy_document.vpc_flow_logs_assume.json
}

data "aws_iam_policy_document" "vpc_flow_logs" {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams"
    ]
    resources = ["${aws_cloudwatch_log_group.vpc_flow.arn}:*"]
  }
}

resource "aws_iam_role_policy" "vpc_flow_logs" {
  name   = "${local.name_prefix}-vpc-flow-logs"
  role   = aws_iam_role.vpc_flow_logs.id
  policy = data.aws_iam_policy_document.vpc_flow_logs.json
}
