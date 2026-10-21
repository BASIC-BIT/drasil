import { observeNativeEnforcement } from '../../application/adapters/nativeObservation';
import type { PublicActionResult } from '@drasil/application';
it.each(['ban_user', 'kick_user'] as const)(
  'does not infer %s historical causality from current state',
  async (operation) => {
    const receipt: PublicActionResult = {
      state: 'uncertain',
      executionId: 'execution',
      operation,
      guildId: 'guild',
      targetUserId: 'target',
    };
    const fetch = jest.fn(async () => ({}));
    const client = { guilds: { fetch: async () => ({ bans: { fetch }, members: { fetch } }) } };
    expect(await observeNativeEnforcement(client as never, receipt)).toMatchObject({
      state: 'uncertain',
      outcome: {
        details: {
          [operation === 'ban_user' ? 'currentBanPresent' : 'currentMemberPresent']: true,
        },
      },
    });
    fetch.mockRejectedValueOnce({ code: operation === 'ban_user' ? 10026 : 10007 } as never);
    expect(await observeNativeEnforcement(client as never, receipt)).toMatchObject({
      state: 'uncertain',
      outcome: {
        details: {
          [operation === 'ban_user' ? 'currentBanPresent' : 'currentMemberPresent']: false,
        },
      },
    });
    fetch.mockRejectedValueOnce(new Error('timeout') as never);
    expect(await observeNativeEnforcement(client as never, receipt)).toMatchObject({
      state: 'uncertain',
      outcome: {
        details: {
          [operation === 'ban_user' ? 'currentBanPresent' : 'currentMemberPresent']: null,
        },
      },
    });
  }
);
