import { createTracingRecorder } from '../fakes/recordingTracing';
import { JevService } from '../../services/JevService';
import type { UserProfileData } from '../../services/GPTService';

describe('JevService', () => {
  const profile: UserProfileData = {
    username: 'member',
    accountCreatedAt: new Date('2026-09-01T00:00:00Z'),
    joinedServerAt: new Date('2026-09-20T00:00:00Z'),
    recentMessages: ['hello', 'claim your prize at example.test'],
  };
  const originalKey = process.env.TYPESAFE_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
    jest.restoreAllMocks();
  });

  it('returns a typed classification and selected reason from TypeSafe', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          classification: {
            type: 'choice',
            choice: 'SUSPICIOUS',
            probabilities: { OK: 0.08, SUSPICIOUS: 0.92 },
          },
          primary_reason: { type: 'choice', choice: 'fraudulent_offer' },
        },
      }),
    } as Response);

    const result = await new JevService().analyzeProfile(profile);

    expect(result).toMatchObject({
      result: 'SUSPICIOUS',
      suspiciousProbability: 0.92,
      reasonCodes: ['fraudulent_offer'],
    });
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body)).state.recent_messages).toEqual(profile.recentMessages);
  });

  it('reports unavailable without a configured key', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const fetchMock = jest.spyOn(global, 'fetch');

    const result = await new JevService().analyzeProfile(profile);

    expect(result.result).toBe('UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unavailable when TypeSafe fails', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network unavailable'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await new JevService().analyzeProfile(profile);

    expect(result.result).toBe('UNAVAILABLE');
  });

  it('limits report and reply text before sending it to TypeSafe', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          classification: {
            type: 'choice',
            choice: 'OK',
            probabilities: { OK: 0.9, SUSPICIOUS: 0.1 },
          },
          primary_reason: { type: 'choice', choice: 'none' },
        },
      }),
    } as Response);

    await new JevService().analyzeReportText('r'.repeat(1200), 'm'.repeat(2200));
    await new JevService().analyzeVerificationReplies({
      serverId: 'server',
      userId: 'user',
      username: 'user',
      messages: ['a'.repeat(1200)],
      detectionReasons: ['reason'],
      detectionType: 'suspicious_content',
      flaggedMessage: '[member] Claim a prize',
      staffNotes: ['[moderator] Prior reply dodged the question'],
      profileImageDescription: 'avatar_description: A cartoon avatar.',
    });

    const reportRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const reportState = reportRequest.state;
    const replyRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    const replyState = replyRequest.state;
    expect(reportState.report_reason).toHaveLength(1000);
    expect(reportState.reported_message).toHaveLength(2000);
    expect(Object.keys(reportRequest.questions.primary_reason.criteria)).toEqual([
      'phishing_or_credential_request',
      'fraudulent_offer',
      'impersonation',
      'unsolicited_promotion',
      'none',
    ]);
    expect(replyState.verification_conversation[0]).toHaveLength(1200);
    expect(replyState.detection_reasons).toEqual(['reason']);
    expect(replyState.originally_flagged_message).toContain('Claim a prize');
    expect(replyState.moderator_notes).toEqual(['[moderator] Prior reply dodged the question']);
    expect(replyState.profile_image_description).toContain('A cartoon avatar.');
    expect(replyRequest.questions.classification.instructions).toContain(
      'not independent grounds to flag these replies'
    );
    expect(replyRequest.questions.primary_reason.instructions).toContain(
      'Do not choose a reason shown only by the original flag or staff notes.'
    );
    expect(Object.keys(replyRequest.questions.primary_reason.criteria)).toEqual([
      'scripted_replies',
      'evades_questions',
      'tries_to_bypass_verification',
      'phishing_or_credential_request',
      'fraudulent_offer',
      'impersonation',
      'unsolicited_promotion',
      'none',
    ]);
  });
});

describe('Jev generation observations', () => {
  let recorder: ReturnType<typeof createTracingRecorder>;
  const savedKey = process.env.TYPESAFE_API_KEY;
  const profile: UserProfileData = {
    username: 'synthetic',
    accountCreatedAt: new Date('2020-01-01'),
    joinedServerAt: new Date('2020-01-01'),
    recentMessages: ['hello'],
  };
  const providerResult = {
    model: 'jev-1.13.0',
    answers: {
      classification: { type: 'choice', choice: 'OK', probabilities: { OK: 0.9, SUSPICIOUS: 0.1 } },
      primary_reason: { type: 'choice', choice: 'none' },
    },
    usage: { input_tokens: 296, output_tokens: 20 },
  };
  beforeAll(() => {
    recorder = createTracingRecorder();
  });
  afterAll(async () => {
    await recorder.shutdown();
    if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = savedKey;
  });
  beforeEach(() => {
    recorder.spans.length = 0;
    process.env.TYPESAFE_API_KEY = 'synthetic-runtime-secret';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  it.each(['profile', 'report-text', 'verification'])(
    'captures actual request and usage for %s',
    async (kind) => {
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: true, status: 200, json: async () => providerResult } as Response);
      const service = new JevService();
      if (kind === 'profile') await service.analyzeProfile(profile);
      if (kind === 'report-text') await service.analyzeReportText('r'.repeat(1200), 'hello');
      if (kind === 'verification')
        await service.analyzeVerificationReplies({
          serverId: 'server',
          userId: 'member',
          username: 'synthetic',
          messages: ['prompt', 'reply'],
          flaggedMessage: 'earlier message',
        });
      expect(recorder.spans).toHaveLength(1);
      const span = recorder.spans[0];
      expect(span.name).toBe(`jev.${kind}`);
      expect(JSON.parse(String(span.attributes['langfuse.observation.input']))).toEqual(
        JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
      );
      expect(JSON.parse(String(span.attributes['langfuse.observation.output']))).toEqual(
        providerResult
      );
      expect(JSON.parse(String(span.attributes['langfuse.observation.usage_details']))).toEqual({
        input: 296,
        output: 20,
        total: 316,
      });
      expect(JSON.stringify(span.attributes)).not.toContain('synthetic-runtime-secret');
    }
  );
  it('records missing key as no request with zero incurred cost', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const fetchMock = jest.spyOn(global, 'fetch');
    expect((await new JevService().analyzeProfile(profile)).result).toBe('UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recorder.spans).toHaveLength(1);
    expect(recorder.spans[0].attributes['langfuse.observation.metadata.error_category']).toBe(
      'missing_key'
    );
    expect(recorder.spans[0].attributes['langfuse.observation.metadata.request_sent']).toBe(
      'false'
    );
    expect(
      JSON.parse(String(recorder.spans[0].attributes['langfuse.observation.cost_details']))
    ).toEqual({ total: 0 });
  });
  it.each(['timeout', 'http_error', 'invalid_response', 'network_error'])(
    'distinguishes %s without unsafe error content',
    async (kind) => {
      const fetchMock = jest.spyOn(global, 'fetch');
      if (kind === 'timeout')
        fetchMock.mockRejectedValue(new DOMException('synthetic-runtime-secret', 'TimeoutError'));
      if (kind === 'http_error')
        fetchMock.mockResolvedValue({ ok: false, status: 429 } as Response);
      if (kind === 'invalid_response')
        fetchMock.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ ...providerResult, answers: {} }),
        } as Response);
      if (kind === 'network_error')
        fetchMock.mockRejectedValue(new Error('synthetic-runtime-secret'));
      expect((await new JevService().analyzeProfile(profile)).result).toBe('UNAVAILABLE');
      expect(recorder.spans).toHaveLength(1);
      expect(recorder.spans[0].attributes['langfuse.observation.metadata.error_category']).toBe(
        kind
      );
      expect(JSON.stringify(recorder.spans[0].attributes)).not.toContain(
        'synthetic-runtime-secret'
      );
      if (kind === 'invalid_response')
        expect(
          JSON.parse(String(recorder.spans[0].attributes['langfuse.observation.usage_details']))
        ).toEqual({ input: 296, output: 20, total: 316 });
      else
        expect(recorder.spans[0].attributes['langfuse.observation.cost_details']).toBeUndefined();
    }
  );
  it.each([
    undefined,
    { input_tokens: -1, output_tokens: 20 },
    { input_tokens: 'bad', output_tokens: 20 },
  ])('preserves valid verdicts with invalid optional usage %j', async (usage) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...providerResult, usage }),
    } as Response);
    expect((await new JevService().analyzeProfile(profile)).result).toBe('OK');
    expect(recorder.spans[0].attributes['langfuse.observation.usage_details']).toBeUndefined();
  });
});
