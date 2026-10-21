import {
  ActionDeniedError,
  caseCommandSchema,
  canonicalDigest,
  resolveCasePreconditions,
  selectedMessageFingerprint,
  type CaseActions,
  type ExecutionRecord,
  type CaseResolutionDependencies,
} from '@drasil/application';
import { PermissionFlagsBits as P } from 'discord.js';
import { createBotCaseActions, createBotCaseDependencies, type BotCaseDependencies } from './cases';
import type { NativeEnforcementStore } from '@drasil/application/postgres';

export function createDelegatedCaseActions(
  deps: BotCaseDependencies,
  execution: ExecutionRecord,
  native: NativeEnforcementStore | undefined
): CaseActions {
  const isNative = execution.command.kind === 'ban_user' || execution.command.kind === 'kick_user';
  let token: string | null = null;
  const actions = createBotCaseActions({
    ...deps,
    nativeLifecycle: isNative
      ? {
          beforeSend: async (): Promise<void> => {
            if (!native) throw new Error('Native enforcement persistence unavailable.');
            token = await native.start(execution);
          },
          acknowledged: async (): Promise<void> => {
            if (!native || !token) throw new Error('Missing native fence.');
            await native.acknowledge(execution.executionId, token);
          },
        }
      : undefined,
  });
  const resources = createBotCaseDependencies(deps);
  const selectedMessage: CaseResolutionDependencies['selectedMessage'] = async (command) => {
    if (!('selectedMessage' in command) || !command.selectedMessage) return null;
    try {
      const { channelId, messageId } = command.selectedMessage;
      if (
        ![execution.guildId, execution.userId, channelId, messageId].every((id) =>
          /^\d{17,20}$/.test(id)
        )
      )
        return null;
      const guild = await deps.client.guilds.fetch({ guild: execution.guildId, force: true });
      await guild.roles.fetch();
      const channel = await guild.channels.fetch(channelId, { force: true });
      if (
        !channel ||
        channel.guildId !== execution.guildId ||
        !channel.isTextBased() ||
        !('messages' in channel)
      )
        return null;
      if (channel.isThread()) {
        if (!channel.parentId) return null;
        // Thread permissions use their parent; refresh it instead of trusting the cache.
        const parent = await guild.channels.fetch(channel.parentId, { force: true });
        if (
          !parent ||
          parent.id !== channel.parentId ||
          parent.guildId !== execution.guildId ||
          parent.isThread()
        )
          return null;
      }
      const actor = await guild.members.fetch({ user: execution.userId, force: true });
      const bot = await guild.members.fetchMe({ force: true });
      for (const member of [actor, bot]) {
        const permissions = channel.permissionsFor(member);
        if (!permissions.has(P.ViewChannel | P.ReadMessageHistory)) return null;
        if (
          channel.isThread() &&
          channel.type === 12 &&
          guild.ownerId !== member.id &&
          !permissions.has(P.ManageThreads)
        ) {
          const membership = await channel.members.fetch({ member: member.id, force: true });
          if (membership.id !== member.id) return null;
        }
      }
      const message = await channel.messages.fetch({ message: messageId, force: true });
      if (!message.guildId) return null;
      const binding = {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        userId: message.author.id,
      };
      return {
        ...binding,
        fingerprint: selectedMessageFingerprint({
          ...binding,
          content: message.content,
          attachments: [...message.attachments.values()].map((a) => ({
            id: a.id,
            name: a.name,
            url: a.url,
            size: a.size,
          })),
        }),
      };
    } catch {
      return null;
    }
  };
  return {
    async execute(context, command): ReturnType<CaseActions['execute']> {
      if (
        execution.preconditions.kind !== 'case_workflow' ||
        canonicalDigest(command) !== execution.commandDigest
      )
        throw new ActionDeniedError('case_preconditions_required');
      const current = await resolveCasePreconditions(
        execution.guildId,
        caseCommandSchema.parse(command),
        { ...resources, selectedMessage }
      );
      if (canonicalDigest(current) !== canonicalDigest(execution.preconditions))
        throw new ActionDeniedError('stale_state');
      return actions.execute(context, command);
    },
  };
}
