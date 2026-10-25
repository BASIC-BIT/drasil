import {
  resolveCasePreconditions,
  selectedMessageFingerprint,
  type CaseResolutionDependencies,
} from './delegation';
import { readCasePolicy } from './policy';
import type { CaseCommand } from './commands';

const command: CaseCommand = {
  kind: 'ban_user',
  targetUserId: 'target',
  reason: null,
  intent: 'native_action',
  selectedMessage: { channelId: 'channel', messageId: 'message' },
};
function fixture(): {
  message: {
    guildId: string;
    channelId: string;
    messageId: string;
    userId: string;
    fingerprint: string;
  };
  deps: CaseResolutionDependencies;
} {
  const message = {
    guildId: 'guild',
    channelId: 'channel',
    messageId: 'message',
    userId: 'target',
    fingerprint: 'first',
  };
  const deps: CaseResolutionDependencies = {
    repository: {
      findById: async () => null,
      findActive: async () => null,
      findDetection: async () => null,
    },
    settings: { loadFresh: async () => readCasePolicy({}) },
    selectedMessage: async () => message,
  };
  return { message, deps };
}
it('binds exact selected-message state and detects a later edit', async () => {
  const f = fixture();
  const before = await resolveCasePreconditions('guild', command, f.deps);
  f.message.fingerprint = 'edited';
  expect(await resolveCasePreconditions('guild', command, f.deps)).not.toEqual(before);
});
it.each(['guildId', 'userId', 'channelId', 'messageId'] as const)(
  'rejects selected-message %s mismatch',
  async (key) => {
    const f = fixture();
    f.message[key] = 'other';
    await expect(resolveCasePreconditions('guild', command, f.deps)).rejects.toThrow();
  }
);
it('rejects missing or invisible selected messages', async () => {
  const f = fixture();
  await expect(
    resolveCasePreconditions('guild', command, { ...f.deps, selectedMessage: async () => null })
  ).rejects.toThrow();
});
it('fingerprints content and attachments without losing snowflake precision', () => {
  const msg = {
    guildId: 'guild',
    channelId: '123456789012345678',
    messageId: '234567890123456789',
    userId: '345678901234567890',
    content: 'text',
    attachments: [],
  };
  expect(selectedMessageFingerprint(msg)).not.toBe(
    selectedMessageFingerprint({ ...msg, content: 'edited' })
  );
  expect(selectedMessageFingerprint(msg)).not.toBe(
    selectedMessageFingerprint({
      ...msg,
      attachments: [{ id: '456789012345678901', name: 'file', url: 'url', size: 2 }],
    })
  );
});
