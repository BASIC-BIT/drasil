import { Collection, type Message } from 'discord.js';
import { activeReportEvidence, buildReportEvidenceBatch } from '../../utils/reportIntakeEvidence';
import { InMemoryReportIntakeRepository } from '../fakes/inMemoryRepositories';
import { ReportIntakeEvidenceKind } from '../../repositories/types';

describe('report evidence revisions', () => {
  it('preserves the known author when deletion raced the first evidence commit', async () => {
    const repository = new InMemoryReportIntakeRepository();
    const intake = await repository.create({ serverId: 'guild', reporterId: 'reporter' });
    const batch = {
      intakeId: intake.id,
      sourceMessageId: 'source',
      sourceChannelId: 'thread',
      sourceAuthorId: 'reporter',
      sourceVersion: 5,
      sourceFingerprint: 'original',
      observedAt: new Date(),
      editedAt: null,
      operation: 'upsert' as const,
      evidence: [{ kind: ReportIntakeEvidenceKind.REPORTER_TEXT, content: 'original' }],
    };
    await repository.recordEvidenceBatch(batch);
    await repository.recordEvidenceBatch({
      ...batch,
      operation: 'delete',
      sourceAuthorId: null,
      sourceVersion: 0,
      evidence: [],
    });
    expect(await repository.findById(intake.id)).toMatchObject({
      metadata: {
        analysis: {
          sources: {
            source: { sourceAuthorId: 'reporter', sourceVersion: 5, operation: 'delete' },
          },
        },
      },
    });
  });

  it('does not resurrect deleted evidence from a stale create', async () => {
    const repository = new InMemoryReportIntakeRepository();
    const intake = await repository.create({ serverId: 'guild', reporterId: 'reporter' });
    const batch = {
      intakeId: intake.id,
      sourceMessageId: 'source',
      sourceChannelId: 'thread',
      sourceAuthorId: 'reporter',
      sourceVersion: 1,
      sourceFingerprint: 'original',
      observedAt: new Date(),
      editedAt: null,
      operation: 'upsert' as const,
      evidence: [{ kind: ReportIntakeEvidenceKind.REPORTER_TEXT, content: 'original' }],
    };
    await repository.recordEvidenceBatch(batch);
    await repository.recordEvidenceBatch({ ...batch, operation: 'delete', evidence: [] });
    const beforeDuplicate = (await repository.findById(intake.id))!;
    await repository.recordEvidenceBatch(batch);
    const afterDuplicate = (await repository.findById(intake.id))!;
    const rows = await repository.listEvidence(intake.id);
    const activeEvidence = activeReportEvidence(afterDuplicate, rows);
    expect(activeEvidence).toHaveLength(0);
    expect(afterDuplicate.evidence_revision).toBe(beforeDuplicate.evidence_revision);
  });
});

describe('buildReportEvidenceBatch', () => {
  it('fingerprints canonical attachment order while retaining original text and descriptors', async () => {
    const repository = new InMemoryReportIntakeRepository();
    const intake = await repository.create({ serverId: 'guild', reporterId: 'reporter' });
    const attachments = [
      {
        id: 'b',
        name: 'second.png',
        url: 'https://cdn.discordapp.com/b.png?ex=1',
        contentType: 'image/png',
        size: 20,
      },
      {
        id: 'a',
        name: 'first.png',
        url: 'https://cdn.discordapp.com/a.png?ex=1',
        contentType: 'image/png',
        size: 10,
      },
    ];
    const message = {
      id: 'message',
      channelId: 'thread',
      author: { id: 'reporter' },
      content: '  Original evidence  ',
      createdTimestamp: 100,
      editedTimestamp: null,
      attachments: new Collection(attachments.map((item) => [item.id, item])),
    } as unknown as Message;
    const batch = buildReportEvidenceBatch(message, intake, 'upsert');
    const reversed = buildReportEvidenceBatch(
      {
        ...message,
        attachments: new Collection(
          attachments
            .reverse()
            .map((item) => [item.id, { ...item, url: item.url.replace('ex=1', 'ex=2') }])
        ),
      } as unknown as Message,
      intake,
      'upsert'
    );
    expect(batch.sourceFingerprint).toBe(reversed.sourceFingerprint);
    expect(batch.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(batch.evidence).toHaveLength(3);
    expect(batch.evidence[0]).toMatchObject({ content: '  Original evidence  ' });
    await repository.recordEvidenceBatch(batch);
    const edited = buildReportEvidenceBatch(
      {
        ...message,
        content: 'corrected',
        editedTimestamp: 200,
        attachments: new Collection(),
      } as Message,
      intake,
      'upsert'
    );
    await repository.recordEvidenceBatch(edited);
    const current = (await repository.findById(intake.id))!;
    const history = await repository.listEvidence(intake.id);
    expect(history).toHaveLength(4);
    expect(activeReportEvidence(current, history)).toEqual([
      expect.objectContaining({ content: 'corrected' }),
    ]);
  });
});
