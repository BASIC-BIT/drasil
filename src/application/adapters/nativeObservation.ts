import type { Client } from 'discord.js';
import type { PublicActionResult } from '@drasil/application';

/** Current state is an observation only: it cannot establish this execution's causality. */
export async function observeNativeEnforcement(
  client: Client,
  receipt: PublicActionResult
): Promise<PublicActionResult> {
  if (
    !receipt.guildId ||
    !receipt.targetUserId ||
    (receipt.operation !== 'ban_user' && receipt.operation !== 'kick_user')
  )
    return receipt;
  let observation: boolean | null = null;
  try {
    const guild = await client.guilds.fetch(receipt.guildId);
    if (receipt.operation === 'ban_user') {
      await guild.bans.fetch({ user: receipt.targetUserId, force: true });
      observation = true;
    } else {
      await guild.members.fetch({ user: receipt.targetUserId, force: true });
      observation = true;
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (
      (receipt.operation === 'ban_user' && code === 10026) ||
      (receipt.operation === 'kick_user' && code === 10007)
    )
      observation = false;
  }
  return {
    ...receipt,
    outcome: {
      ...receipt.outcome,
      details: {
        ...receipt.outcome?.details,
        [receipt.operation === 'ban_user' ? 'currentBanPresent' : 'currentMemberPresent']:
          observation,
      },
    },
  };
}
