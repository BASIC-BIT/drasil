import { createCaseResolutionResources } from '@drasil/application/postgres';
import {
  selectedMessageFingerprint,
  type CaseResolutionDependencies,
  type DelegatedAccess,
  type DelegatedPrincipal,
  type WorkflowId,
} from '@drasil/application';
import type { Pool } from 'pg';
import { getPostgresPool } from '../../setupDataAdapter';
import { fetchBotMessage } from '../../discordApi';
import { createWorkflowContentAuthorizer } from './visibility';
import { createCaseIntentResolver } from '@drasil/application';
import { createWebDelegatedAccess } from '../access';

export function createWebCaseIntentResolver(
  options: { database?: Pick<Pool, 'query'>; access?: DelegatedAccess } = {}
) {
  const database = options.database ?? getPostgresPool();
  const access = options.access ?? createWebDelegatedAccess();
  const visible = createWorkflowContentAuthorizer(access);
  function resources(
    principal: DelegatedPrincipal,
    guildId: string,
    workflowId: WorkflowId
  ): CaseResolutionDependencies {
    return createCaseResolutionResources(database, guildId, async (command) => {
      if (!('selectedMessage' in command) || !command.selectedMessage) return null;
      const { channelId, messageId } = command.selectedMessage;
      if (
        !/^\d{17,20}$/.test(messageId) ||
        (await visible(principal, guildId, channelId, workflowId)).kind === 'denied'
      )
        return null;
      const message = await fetchBotMessage(channelId, messageId);
      const binding = {
        guildId,
        channelId: message.channel_id,
        messageId: message.id,
        userId: message.author.id,
      };
      return {
        ...binding,
        fingerprint: selectedMessageFingerprint({
          ...binding,
          content: message.content,
          attachments: (message.attachments ?? []).map((a) => ({
            id: a.id,
            name: a.filename ?? null,
            url: a.url ?? null,
            size: a.size ?? null,
          })),
        }),
      };
    });
  }
  return createCaseIntentResolver({ access, resources });
}
