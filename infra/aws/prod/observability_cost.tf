resource "aws_resourcegroups_group" "project" {
  name = "${local.name_prefix}-resources"

  resource_query {
    query = jsonencode({
      ResourceTypeFilters = ["AWS::AllSupported"]
      TagFilters = [
        {
          Key    = "Project"
          Values = [var.project_name]
        },
        {
          Key    = "Environment"
          Values = [var.environment]
        }
      ]
    })
  }
}

resource "aws_sns_topic" "ops_alerts" {
  count             = local.observability_enabled ? 1 : 0
  name              = "${local.name_prefix}-ops-alerts"
  kms_master_key_id = aws_kms_key.prod.arn
}

data "aws_iam_policy_document" "ops_alerts_topic" {
  count = local.observability_enabled ? 1 : 0

  statement {
    sid    = "AllowCloudWatchAlarmsPublish"
    effect = "Allow"

    actions = ["sns:Publish"]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }

    resources = [aws_sns_topic.ops_alerts[0].arn]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "ops_alerts" {
  count  = local.observability_enabled ? 1 : 0
  arn    = aws_sns_topic.ops_alerts[0].arn
  policy = data.aws_iam_policy_document.ops_alerts_topic[0].json
}

resource "aws_sns_topic_subscription" "ops_email" {
  for_each = local.observability_enabled ? toset(var.alert_email_addresses) : toset([])

  topic_arn = aws_sns_topic.ops_alerts[0].arn
  protocol  = "email"
  endpoint  = each.value
}

resource "aws_cloudwatch_log_metric_filter" "application_errors" {
  count = local.observability_enabled ? 1 : 0

  name           = "${local.name_prefix}-application-errors"
  log_group_name = aws_cloudwatch_log_group.ecs.name
  pattern        = "?ERROR ?Error ?Exception ?FATAL"

  metric_transformation {
    name          = "ApplicationErrorCount"
    namespace     = "${local.name_prefix}/Application"
    value         = "1"
    default_value = 0
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_cpu_high" {
  count = local.observability_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-ecs-cpu-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = var.cpu_alarm_threshold_percent
  treat_missing_data  = "notBreaching"
  alarm_description   = "ECS service CPU utilization is above threshold."

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.bot.name
  }

  alarm_actions = [aws_sns_topic.ops_alerts[0].arn]
  ok_actions    = [aws_sns_topic.ops_alerts[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory_high" {
  count = local.observability_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-ecs-memory-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 3
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = var.memory_alarm_threshold_percent
  treat_missing_data  = "notBreaching"
  alarm_description   = "ECS service memory utilization is above threshold."

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.bot.name
  }

  alarm_actions = [aws_sns_topic.ops_alerts[0].arn]
  ok_actions    = [aws_sns_topic.ops_alerts[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "ecs_running_tasks_low" {
  count = local.observability_enabled && var.desired_count > 0 ? 1 : 0

  alarm_name          = "${local.name_prefix}-ecs-running-tasks-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "RunningTaskCount"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = var.desired_count
  treat_missing_data  = "notBreaching"
  alarm_description   = "ECS running task count dropped below the expected baseline."

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.bot.name
  }

  alarm_actions = [aws_sns_topic.ops_alerts[0].arn]
  ok_actions    = [aws_sns_topic.ops_alerts[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "application_errors" {
  count = local.observability_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-application-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = aws_cloudwatch_log_metric_filter.application_errors[0].metric_transformation[0].name
  namespace           = aws_cloudwatch_log_metric_filter.application_errors[0].metric_transformation[0].namespace
  period              = 300
  statistic           = "Sum"
  threshold           = var.error_alarm_threshold_count
  treat_missing_data  = "notBreaching"
  alarm_description   = "Application error log count exceeded threshold."

  alarm_actions = [aws_sns_topic.ops_alerts[0].arn]
  ok_actions    = [aws_sns_topic.ops_alerts[0].arn]
}

resource "aws_cloudwatch_dashboard" "operations" {
  count = local.observability_enabled ? 1 : 0

  dashboard_name = "${local.name_prefix}-operations"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "ECS CPU Utilization"
          region = var.aws_region
          view   = "timeSeries"
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.bot.name]
          ]
          stat   = "Average"
          period = 300
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "ECS Memory Utilization"
          region = var.aws_region
          view   = "timeSeries"
          metrics = [
            ["AWS/ECS", "MemoryUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.bot.name]
          ]
          stat   = "Average"
          period = 300
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "ECS Running Tasks"
          region = var.aws_region
          view   = "timeSeries"
          metrics = [
            ["AWS/ECS", "RunningTaskCount", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.bot.name]
          ]
          stat   = "Average"
          period = 300
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Application Error Count"
          region = var.aws_region
          view   = "timeSeries"
          metrics = [
            ["${local.name_prefix}/Application", "ApplicationErrorCount"]
          ]
          stat   = "Sum"
          period = 300
        }
      }
    ]
  })
}

resource "aws_budgets_budget" "monthly_cost" {
  count = local.cost_controls_enabled && local.notifications_enabled ? 1 : 0

  name              = "${local.name_prefix}-monthly-cost"
  budget_type       = "COST"
  limit_amount      = tostring(var.monthly_cost_budget_usd)
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = var.monthly_cost_budget_start

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.alert_email_addresses
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.alert_email_addresses
  }
}

resource "aws_ce_anomaly_monitor" "service_costs" {
  count = local.cost_controls_enabled && local.notifications_enabled ? 1 : 0

  name              = "${local.name_prefix}-service-costs"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

resource "aws_ce_anomaly_subscription" "service_costs" {
  count = local.cost_controls_enabled && local.notifications_enabled ? 1 : 0

  name             = "${local.name_prefix}-daily-cost-anomalies"
  frequency        = "DAILY"
  monitor_arn_list = [aws_ce_anomaly_monitor.service_costs[0].arn]

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.cost_anomaly_threshold_usd)]
    }
  }

  dynamic "subscriber" {
    for_each = toset(var.alert_email_addresses)
    content {
      type    = "EMAIL"
      address = subscriber.value
    }
  }
}
