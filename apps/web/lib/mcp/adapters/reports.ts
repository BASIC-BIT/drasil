import {
  createReportIntentResolver,
  createIntakeChoiceReferences,
  prepareSubmittedReportCaseOpen,
  selectedMessageFingerprint,
  ActionDeniedError,
  type DelegatedAccess,
} from '@drasil/application';
import {
  createReportResources,
  createReportReviewReferenceStore,
} from '@drasil/application/postgres';
import { createWebDelegationDatabase } from './database';
import { createWebDelegatedAccess } from '../access';
import { createWebAuthority } from '../../application/adapters/authority';
import { createWebStaffRoles } from '../../application/adapters/staffRoles';
import { fetchBotMessage } from '../../discordApi';
import { createWorkflowContentAuthorizer } from './visibility';
export function createWebReportResolution(
  secret: string,
  access: DelegatedAccess = createWebDelegatedAccess()
) {
  const database = createWebDelegationDatabase();
  const resources = createReportResources(database);
  const authority = createWebAuthority(),
    staffRoles = createWebStaffRoles();
  const choices = createIntakeChoiceReferences({ ...resources, authority, staffRoles, secret });
  const reviewReferences = createReportReviewReferenceStore(database);

  const visible = createWorkflowContentAuthorizer(access);
  return {
    choices,
    resolver: createReportIntentResolver({
      access,
      resources: (principal, guildId) => ({
        prepareSubmittedReportCaseOpen: (reportId) =>
          prepareSubmittedReportCaseOpen(
            {
              guildId,
              requestId: 'preparation',
              source: 'mcp',
              actor: { kind: 'user', userId: principal.userId },
            },
            { reportId },
            { authority, openCaseRepository: resources.openCaseRepository }
          ),
        resolveIntakeChoice: (reference) => choices.resolveIntakeChoice(principal, reference),
        loadReview: (reference) => reviewReferences.load(principal, guildId, reference),
        async message(command) {
          const allowed = await visible(
            principal,
            guildId,
            command.channelId,
            'submit_message_report'
          );
          if (allowed.kind === 'denied') throw new ActionDeniedError(allowed.reason);
          const message = await fetchBotMessage(command.channelId, command.messageId);
          if (
            message.channel_id !== command.channelId ||
            message.id !== command.messageId ||
            message.author.id !== command.targetUserId
          )
            return null;
          const binding = {
            guildId,
            channelId: message.channel_id,
            messageId: message.id,
            userId: message.author.id,
          };
          return {
            kind: 'report_message',
            guildId,
            channelId: message.channel_id,
            messageId: message.id,
            targetUserId: message.author.id,
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
        async detection(id) {
          return (
            (
              await database.query<{
                guildId: string;
                targetUserId: string;
                reportId: string | null;
              }>(
                `select server_id as "guildId",user_id as "targetUserId",metadata->>'reportIntakeId' as "reportId" from detection_events where id=$1::uuid and server_id=$2`,
                [id, guildId]
              )
            ).rows[0] ?? null
          );
        },
      }),
    }),
  };
}
