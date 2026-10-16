import { ModerationEvidenceService } from '../../services/ModerationEvidenceService';
import {
  InMemoryDetectionEventsRepository,
  InMemoryReportIntakeRepository,
  InMemoryVerificationEventRepository,
} from '../fakes/inMemoryRepositories';

describe('ModerationEvidenceService', () => {
  it('records missing optional sources without starting model analysis', async () => {
    const descriptions = { describeProfileImages: jest.fn() };
    const service = new ModerationEvidenceService(
      new InMemoryDetectionEventsRepository(),
      undefined,
      descriptions as never
    );
    const snapshot = await service.capture({ guildId: 'guild', userId: 'departed', member: null });
    expect(snapshot.unavailable_sources).toEqual(
      expect.arrayContaining(['profile_assets', 'profile_image_description', 'recent_messages'])
    );
    expect(snapshot.detection_history).toEqual([]);
    expect(descriptions.describeProfileImages).not.toHaveBeenCalled();
  });
});

import { ReportIntakeStatus, VerificationStatus } from '../../repositories/types';
it('claims a submitted report once and rejects close and target changes until release', async () => {
  const reports = new InMemoryReportIntakeRepository();
  const report = await reports.create({
    serverId: 'guild',
    reporterId: 'reporter',
    confirmedTargetUserId: 'target',
    status: ReportIntakeStatus.SUBMITTED,
    metadata: { detection_event_id: 'detection' },
  });
  const input = {
    reportId: report.id,
    serverId: 'guild',
    targetUserId: 'target',
    detectionEventId: 'detection',
    operationId: 'operation',
  };
  expect(await reports.claimBan(input)).not.toBeNull();
  expect(await reports.claimBan({ ...input, operationId: 'competing' })).toBeNull();
  const current = (await reports.findById(report.id))!;
  expect(
    await reports.updateIfCurrent(current, { status: ReportIntakeStatus.DISMISSED })
  ).toBeNull();
  expect(await reports.update(report.id, { confirmedTargetUserId: 'other' })).toBeNull();
});

it('does not attach an unbound historical description to an unavailable current profile', async () => {
  const detections = new InMemoryDetectionEventsRepository();
  const description = {
    summary: 'Stored profile description',
    analyzedImageCount: 1,
    model: 'stored',
    promptVersion: 'v1',
    isFallback: false,
  };
  await detections.create({
    server_id: 'guild',
    user_id: 'target',
    detection_type: 'user_report' as never,
    confidence: 1,
    metadata: { moderation_evidence: { profile_image_description: description } },
  });
  const descriptions = { describeProfileImages: jest.fn() };
  const snapshot = await new ModerationEvidenceService(
    detections,
    undefined,
    descriptions as never
  ).capture({ guildId: 'guild', userId: 'target', member: null });
  expect(snapshot.profile_image_description).toBeNull();
  expect(snapshot.unavailable_sources).toContain('profile_image_description');
  expect(descriptions.describeProfileImages).not.toHaveBeenCalled();
  expect(snapshot.detection_history[0].metadata).not.toHaveProperty('moderation_evidence');
});

it.each([
  ['detection', true, false],
  ['detection', false, false],
  ['case', true, false],
  ['case', false, false],
  ['detection', true, true],
  ['detection', false, true],
  ['case', true, true],
  ['case', false, true],
] as const)(
  'matches %s assets before description reuse, describeImages=%s, matching=%s',
  async (source, describeImages, matching) => {
    const detections = new InMemoryDetectionEventsRepository();
    const cases = new InMemoryVerificationEventRepository();
    const description = {
      summary: 'Stored avatar',
      analyzedImageCount: 1,
      model: 'stored',
      promptVersion: 'v1',
      isFallback: false,
    };
    const assets = { avatar_url: `https://example.test/${matching ? 'new' : 'old'}.png` };
    const event = await detections.create({
      server_id: 'guild',
      user_id: 'target',
      detection_type: 'user_report' as never,
      confidence: 1,
      metadata:
        source === 'detection'
          ? {
              moderation_evidence: {
                profile_assets: assets,
                profile_image_description: description,
              },
            }
          : {},
    });
    if (source === 'case') {
      const reportCase = await cases.createFromDetection(
        event.id,
        'guild',
        'target',
        VerificationStatus.PENDING
      );
      await cases.patchMetadata(reportCase.id, {
        profile_assets: assets,
        profile_image_description: {
          summary: description.summary,
          analyzed_image_count: 1,
          model: 'stored',
          prompt_version: 'v1',
          is_fallback: false,
        },
      });
    }
    const fresh = { ...description, summary: 'Current avatar' };
    const descriptions = { describeProfileImages: jest.fn().mockResolvedValue(fresh) };
    const user = { username: 'target', displayAvatarURL: () => 'https://example.test/new.png' };
    const member = {
      id: 'target',
      user,
      client: { users: { fetch: jest.fn().mockResolvedValue(user) } },
    };
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
    try {
      const snapshot = await new ModerationEvidenceService(
        detections,
        undefined,
        descriptions as never,
        cases
      ).capture({ guildId: 'guild', userId: 'target', member: member as never, describeImages });
      expect(snapshot.profile_image_description).toEqual(
        matching ? description : describeImages ? fresh : null
      );
      expect(descriptions.describeProfileImages).toHaveBeenCalledTimes(
        !matching && describeImages ? 1 : 0
      );
      if (!matching && !describeImages)
        expect(snapshot.unavailable_sources).toContain('profile_image_description');
    } finally {
      fetchMock.mockRestore();
    }
  }
);
