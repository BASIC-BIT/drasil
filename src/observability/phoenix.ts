import OpenAI from 'openai';
import { register, registerInstrumentations } from '@arizeai/phoenix-otel';
import { OpenAIInstrumentation } from '@arizeai/openinference-instrumentation-openai';

type InitResult =
  | { enabled: true; projectName: string; url: string; hideContent: boolean }
  | { enabled: false; reason: string };

let initialized = false;

function isTracingEnabled(): boolean {
  if (process.env.PHOENIX_TRACING_ENABLED === 'true') {
    return true;
  }

  // Back-compat / convenience: enable if an endpoint is explicitly provided.
  return Boolean(
    process.env.PHOENIX_COLLECTOR_ENDPOINT ||
    process.env.PHOENIX_COLLECTOR_URL ||
    process.env.PHOENIX_ENDPOINT
  );
}

function resolveCollectorUrl(): string {
  return (
    process.env.PHOENIX_COLLECTOR_ENDPOINT ||
    process.env.PHOENIX_COLLECTOR_URL ||
    process.env.PHOENIX_ENDPOINT ||
    'http://localhost:6006'
  );
}

export function initPhoenixTracing(): InitResult {
  if (initialized) {
    return { enabled: false, reason: 'already-initialized' };
  }

  if (!isTracingEnabled()) {
    return { enabled: false, reason: 'PHOENIX_TRACING_ENABLED not set' };
  }

  const projectName = process.env.PHOENIX_PROJECT_NAME || 'drasil';
  const url = resolveCollectorUrl();
  const apiKey = process.env.PHOENIX_API_KEY;

  const hideContent = process.env.PHOENIX_HIDE_CONTENT !== 'false';
  const traceConfig = hideContent
    ? {
        hideInputs: true,
        hideOutputs: true,
        hideInputMessages: true,
        hideOutputMessages: true,
      }
    : undefined;

  try {
    register({
      projectName,
      url,
      apiKey,
      batch: true,
    });

    const openAiInstrumentation = new OpenAIInstrumentation({ traceConfig });

    // Defensive: works in both ESM + CJS setups.
    openAiInstrumentation.manuallyInstrument(OpenAI);

    registerInstrumentations({
      instrumentations: [openAiInstrumentation],
    });

    initialized = true;

    console.log(
      `[phoenix] tracing enabled (project=${projectName}, url=${url}, hideContent=${hideContent})`
    );

    return { enabled: true, projectName, url, hideContent };
  } catch (error) {
    console.warn('[phoenix] tracing init failed; continuing without tracing', error);
    return { enabled: false, reason: 'init-failed' };
  }
}
