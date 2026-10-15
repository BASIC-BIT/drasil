import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { VerificationStatus } from '../../repositories/types';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('verification metadata patches (integration)', () => {
  it('preserves independent concurrent patches and current case state', async () => {
    const prisma = getPrismaClient();
    await new ServerRepository(prisma).getOrCreateServer('guild-metadata');
    await new UserRepository(prisma).getOrCreateUser('user-metadata', 'target');
    const repository = new VerificationEventRepository(prisma);
    const event = await repository.createFromDetection(
      null,
      'guild-metadata',
      'user-metadata',
      VerificationStatus.PENDING
    );
    const oldTime = new Date('2026-01-01T00:00:00Z');
    await repository.update(
      event.id,
      { metadata: { existing: true }, updated_at: oldTime },
      { touchUpdatedAt: false }
    );
    await Promise.all([
      repository.patchMetadata(
        event.id,
        { initial_verification_prompt_message_id: 'prompt-1' },
        { touchUpdatedAt: false }
      ),
      repository.patchMetadata(
        event.id,
        { member_left: { at: '2026-10-15' } },
        { touchUpdatedAt: false }
      ),
    ]);
    expect(await repository.findById(event.id)).toMatchObject({
      status: VerificationStatus.PENDING,
      updated_at: oldTime,
      metadata: {
        existing: true,
        initial_verification_prompt_message_id: 'prompt-1',
        member_left: { at: '2026-10-15' },
      },
    });
    expect(
      (await repository.patchMetadata(event.id, { existing: false }))?.updated_at.getTime()
    ).toBeGreaterThan(oldTime.getTime());
    expect(
      await repository.patchMetadata('00000000-0000-0000-0000-000000000000', { missing: true })
    ).toBeNull();
  });

  it.each([null, [], 'old-value'])('initializes non-object metadata (%j)', async (metadata) => {
    const prisma = getPrismaClient();
    await new ServerRepository(prisma).getOrCreateServer('guild-metadata');
    await new UserRepository(prisma).getOrCreateUser('user-metadata', 'target');
    const repository = new VerificationEventRepository(prisma);
    const event = await repository.createFromDetection(
      null,
      'guild-metadata',
      'user-metadata',
      VerificationStatus.PENDING
    );
    if (metadata !== null) await repository.update(event.id, { metadata });
    expect((await repository.patchMetadata(event.id, { prompt: 'message-1' }))?.metadata).toEqual({
      prompt: 'message-1',
    });
  });
});
