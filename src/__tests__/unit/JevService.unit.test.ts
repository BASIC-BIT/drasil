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
