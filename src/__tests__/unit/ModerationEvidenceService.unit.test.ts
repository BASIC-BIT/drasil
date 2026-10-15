import { ModerationEvidenceService } from '../../services/ModerationEvidenceService';
import {
  InMemoryDetectionEventsRepository,
  InMemoryReportIntakeRepository,
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

import { ReportIntakeStatus } from '../../repositories/types';
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

it('reuses stored descriptions without requesting new analysis', async () => {
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
  expect(snapshot.profile_image_description).toEqual(description);
  expect(snapshot.unavailable_sources).not.toContain('profile_image_description');
  expect(descriptions.describeProfileImages).not.toHaveBeenCalled();
  expect(snapshot.detection_history[0].metadata).not.toHaveProperty('moderation_evidence');
});
