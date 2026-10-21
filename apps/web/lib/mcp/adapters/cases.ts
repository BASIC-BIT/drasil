import {
  readCasePolicy,
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
import { createCaseIntentResolver } from '../tools/cases';
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
    return {
      settings: {
        loadFresh: async () => {
          const result = await database.query('select settings from servers where guild_id=$1', [
            guildId,
          ]);
          if (!result.rows[0]) throw new Error('Guild unavailable.');
          return readCasePolicy(result.rows[0].settings);
        },
      },
      repository: {
        findById: async (id) =>
          (
            await database.query(
              'select id,server_id,user_id,status,case_kind,attention_state,case_revision from verification_events where id=$1::uuid and server_id=$2',
              [id, guildId]
            )
          ).rows[0] ?? null,
        findActive: async (_guild, user) =>
          (
            await database.query(
              "select id,server_id,user_id,status from verification_events where server_id=$1 and user_id=$2 and status='pending' order by created_at desc limit 1",
              [guildId, user]
            )
          ).rows[0] ?? null,
        findDetection: async (id) =>
          (
            await database.query(
              `select server_id,user_id,metadata->>'reportIntakeId' as "reportId" from detection_events where id=$1::uuid and server_id=$2`,
              [id, guildId]
            )
          ).rows[0] ?? null,
      },
      selectedMessage: async (command) => {
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
      },
    };
  }
  return createCaseIntentResolver({ access, resources });
}
