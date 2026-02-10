# Phoenix (LLM Observability)

Drasil can export OpenAI/GPT traces to Arize Phoenix using OpenTelemetry + OpenInference instrumentation.

This is safe-by-default: prompt/response content is redacted unless you explicitly opt in.

## Local setup (Docker)

1. Start Phoenix:

```bash
docker compose -f docker-compose.phoenix.yml up
```

Note: `docker-compose.phoenix.yml` pins the Phoenix image tag. Bump it intentionally when upgrading Phoenix.

2. Open the Phoenix UI:

- http://localhost:6006

## Enable tracing in Drasil

Add the following to your local `.env`:

```bash
PHOENIX_TRACING_ENABLED=true
PHOENIX_COLLECTOR_ENDPOINT=http://localhost:6006
PHOENIX_PROJECT_NAME=drasil-local

# Optional (recommended default): keep content redacted
PHOENIX_HIDE_CONTENT=true

# Optional: stable pseudonymous hashing across restarts
# OBSERVABILITY_HASH_KEY=replace-with-a-random-secret
```

Start the bot normally:

```bash
npm run dev
```

Then, trigger any flow that uses GPT (e.g. join checks / message checks). Traces will appear under the configured project in Phoenix.

## (Optional) Show prompt/response content (local debugging only)

Phoenix/OpenInference can capture prompt/response content, but we keep it redacted by default.

To temporarily enable content in traces locally:

```bash
PHOENIX_HIDE_CONTENT=false
```

Do not enable this in production.

## Phoenix Cloud vs self-hosted

The code supports both by changing environment variables:

- **Phoenix Cloud**: set `PHOENIX_COLLECTOR_ENDPOINT` to your Space collector endpoint and set `PHOENIX_API_KEY`.
- **Self-hosted**: set `PHOENIX_COLLECTOR_ENDPOINT` to your Phoenix server URL and set `PHOENIX_API_KEY` if auth is enabled.
