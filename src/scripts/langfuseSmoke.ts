import 'reflect-metadata';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';

config();

async function main(): Promise<void> {
  const presence = {
    tracing_enabled: process.env.LANGFUSE_TRACING_ENABLED === 'true',
    langfuse_public_key: Boolean(process.env.LANGFUSE_PUBLIC_KEY),
    langfuse_secret_key: Boolean(process.env.LANGFUSE_SECRET_KEY),
    langfuse_region: Boolean(process.env.LANGFUSE_BASE_URL),
    langfuse_environment: Boolean(process.env.LANGFUSE_TRACING_ENVIRONMENT),
    openai_key: Boolean(process.env.OPENAI_API_KEY),
    typesafe_key: Boolean(process.env.TYPESAFE_API_KEY),
  };
  process.stdout.write(JSON.stringify({ configuration: presence }) + '\n');
  if (Object.values(presence).some((value) => !value)) throw new Error('configuration');

  const { initLangfuseTracing, shutdownLangfuseTracing, withObservation, recordObservation } =
    await import('../observability/langfuse');
  if (!initLangfuseTracing()) throw new Error('configuration');

  // Provider fallback logging can include raw errors. This standalone command prints IDs only.
  const originalConsole = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (): void => undefined;
  try {
    const [{ GPTService }, { JevService }, { trace }] = await Promise.all([
      import('../services/GPTService'),
      import('../services/JevService'),
      import('@opentelemetry/api'),
    ]);
    const gpt = new GPTService();
    const jev = new JevService();
    const sessionId = `${process.env.LANGFUSE_TRACING_ENVIRONMENT}:smoke:${randomUUID()}`;
    const profile = {
      username: 'synthetic-example-user',
      accountCreatedAt: new Date('2020-01-01T00:00:00Z'),
      joinedServerAt: new Date('2020-01-02T00:00:00Z'),
      recentMessages: ['Synthetic example: I joined to talk about weekly community activities.'],
    };
    const reportText =
      'Synthetic example: Claim a prize at https://example.invalid and enter your password.';
    const verification = {
      serverId: 'synthetic-server',
      userId: 'synthetic-user',
      username: profile.username,
      messages: [
        JSON.stringify({
          role: 'bot',
          content: 'Why did you join this community?',
          attachments: [],
        }),
        JSON.stringify({
          role: 'member',
          content: 'Synthetic example: I joined for the weekly community activities.',
          attachments: [],
        }),
        JSON.stringify({
          role: 'moderator',
          content: 'Which activity interests you?',
          attachments: [],
        }),
        JSON.stringify({
          role: 'member',
          content: 'The Friday game night. A friend invited me.',
          attachments: [],
        }),
      ],
      detectionReasons: ['Synthetic initial profile flag for verification.'],
      flaggedMessage: 'Synthetic example evidence only.',
      staffNotes: ['Synthetic moderator note: ask about community activities.'],
      profileImageDescription: 'Synthetic image description: a cartoon animal avatar.',
    };
    const run = async (name: string, operation: () => Promise<boolean>): Promise<void> => {
      await withObservation(
        `smoke.${name}`,
        'chain',
        async (): Promise<void> => {
          const traceId = trace.getActiveSpan()?.spanContext().traceId;
          if (!(await operation())) throw new Error('provider_verification');
          await withObservation('synthetic-no-op', 'tool', async (): Promise<void> => {
            recordObservation('tool', {
              output: { actual_outcome: 'synthetic_no_action' },
              metadata: { synthetic: true },
            });
          });
          recordObservation('chain', { output: { actual_outcome: 'synthetic_no_action' } });
          process.stdout.write(JSON.stringify({ workflow: name, trace_id: traceId }) + '\n');
        },
        { metadata: { synthetic: true } },
        { sessionId }
      );
    };
    await run('profile', async (): Promise<boolean> => {
      const [first, second] = await Promise.all([
        gpt.analyzeProfile(profile),
        jev.analyzeProfile(profile),
      ]);
      return !first.isFallback && second.result !== 'UNAVAILABLE';
    });
    await run('report', async (): Promise<boolean> => {
      const [first, second] = await Promise.all([
        gpt.analyzeReportEvidence({
          serverId: 'synthetic-server',
          targetUserId: 'synthetic-user',
          reporterId: 'synthetic-reporter',
          reportReason: 'Synthetic report for tracing verification.',
          reportedMessageContent: reportText,
          attachments: [],
        }),
        jev.analyzeReportText('Synthetic report for tracing verification.', reportText),
      ]);
      return !first.isFallback && second.result !== 'UNAVAILABLE';
    });
    await run('verification', async (): Promise<boolean> => {
      const [first, second] = await Promise.all([
        gpt.analyzeVerificationThreadResponses(verification),
        jev.analyzeVerificationReplies(verification),
      ]);
      return !first.isFallback && second.result !== 'UNAVAILABLE';
    });
    const key = process.env.TYPESAFE_API_KEY;
    try {
      delete process.env.TYPESAFE_API_KEY;
      await run(
        'missing-jev-key',
        async (): Promise<boolean> => (await jev.analyzeProfile(profile)).result === 'UNAVAILABLE'
      );
    } finally {
      process.env.TYPESAFE_API_KEY = key;
    }
  } finally {
    await shutdownLangfuseTracing();
    Object.assign(console, originalConsole);
  }
}

void main().catch(() => {
  process.stderr.write(
    '[smoke] configuration or provider verification failed; inspect sanitized traces.\n'
  );
  process.exitCode = 1;
});
