# Langfuse observability

## Project and access

Use Langfuse Cloud. Check the existing organization for a dedicated Drasil project before creating one. Keep project access private to operators. Use native `development` and `production` environments in that project, with separate keys for each environment. A project key can ingest into either environment; the environment label is not an access boundary. Restrict access to the project accordingly.

Choose the project's regional URL: `https://cloud.langfuse.com` (EU), `https://us.cloud.langfuse.com` (US), or `https://jp.cloud.langfuse.com` (Japan). Use the matching region for keys and API requests.

## Content contract

Full model requests and responses are approved for these traces, including report text, verification conversations, moderator notes, and image descriptions. Generations contain the actual outgoing payload after existing transformations. Workflow roots contain IDs, counts, verdicts, recommendations and completed outcomes, without duplicating full evidence.

Runtime keys, authentication headers, environment/client objects, connection strings and raw provider error messages/stacks are excluded. Provider failures record safe categories and numeric HTTP status. Human-entered evidence remains untrusted input. Case and intake sessions group later runs; they do not keep a span open while waiting for a person.

## Local setup

Set `LANGFUSE_TRACING_ENABLED=true`, `LANGFUSE_BASE_URL`, `LANGFUSE_TRACING_ENVIRONMENT=development`, `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` in the gitignored environment. Optionally set `LANGFUSE_RELEASE` to the checked-out SHA. Missing configuration disables export with a sanitized warning. Normal moderation continues.

`npm run dev:env` preserves existing optional TypeSafe/Langfuse configuration and accepts process overrides. To retrieve keys from AWS, explicitly set `DRASIL_LANGFUSE_PUBLIC_KEY_SECRET` and `DRASIL_LANGFUSE_SECRET_KEY_SECRET` to the development secret IDs. Unconfigured optional secrets are never fetched. The script does not print key values.

## Production setup

Terraform creates metadata-only secrets under the existing environment prefix: `/LANGFUSE_PUBLIC_KEY` and `/LANGFUSE_SECRET_KEY`. Values belong in AWS Secrets Manager, outside Terraform and git. Populate both versions before setting `langfuse_tracing_enabled=true` and the regional `langfuse_base_url`. While disabled, ECS does not reference either secret, so an unpopulated tracing secret cannot prevent startup.

The ECS execution role reads these secrets with the existing KMS policy. Production uses `LANGFUSE_TRACING_ENVIRONMENT=production`. Deployment replaces any previous `LANGFUSE_RELEASE` with the exact resolved image SHA, including rollback/reused images. Do not enable production until synthetic Cloud delivery and model pricing have been inspected.

## Graph and outcomes

A workflow is a native `chain`, provider calls are `generation` siblings, evidence/candidate reads are `retriever` observations, Discord actions are `tool` observations, and combination/persistence uses `span`. Drasil's report intake is a fixed workflow, not an autonomous tool-calling agent. No new agent framework is required to view its execution graph.

Message/join/report/verification traces end after the existing awaited work. Recommendations and actual outcomes are distinct. Report fan-out has separate destination chains, including failed deliveries. A completed fan-out does not imply every destination succeeded. Case outputs list incomplete actions. Intake debounce delay is metadata, not model execution time; no span stays open during the timer.

Telemetry failures do not replay operations or change moderation results. Shutdown flushing is bounded at three seconds, including failed bot/analytics cleanup. A slow collector may lose final telemetry after that bound.

## Usage and cost

Raw returned usage is authoritative. OpenAI input and output totals include cached input and reasoning output; trace buckets subtract those subtotals before adding distinct `input_cached_tokens` and `output_reasoning_tokens` buckets. Do not price the inclusive totals a second time. Returned model names determine model matching.

Inspect Langfuse model definitions for every exact returned model and usage bucket. Rates must match the current account, including service tier. Jev `jev-1.13.0` published pricing at planning time was USD 0.000000042 per input token and zero per output token. Verify current pricing before configuring it. Langfuse rate-derived costs are estimates, not invoice amounts.

A Jev missing-key skip incurs no request and explicitly records zero cost. A dispatched failed request with absent usage/pricing has unknown cost, never zero. Client generations conservatively label `cost_source=unknown` until matching pricing is verified, and workflow cost coverage is partial. Server-derived costs must be inspected alongside this label; a sum of known costs is not complete spend when any generation is unknown. See [Langfuse usage/cost documentation](https://langfuse.com/docs/observability/features/token-and-cost-tracking) and [TypeSafe models](https://docs.typesafe.ai/models).

## Verification and rollback

Run the synthetic smoke command described here when it is available. Inspect delivered traces for environment/release/session labels, sibling overlap and parent links, content, usage buckets, failure categories, and model pricing. Save synthetic IDs and sanitized results only. A successful API call alone does not prove Cloud ingestion or correct costs.

To disable tracing, set `langfuse_tracing_enabled=false` and deploy the updated task configuration. Local execution uses `LANGFUSE_TRACING_ENABLED=false`. Model classification continues through the existing moderation pipeline.
