import { createReportReviewActions, type ReportReviewRecord } from '@drasil/application';
import { createDiscordActionContext } from '../../application/context';

it('uses the compiled shared report review with authenticated Discord context', async () => {
  const context = createDiscordActionContext({
    guildId: 'guild-1',
    userId: 'moderator-1',
    requestId: 'interaction-1',
  });
  let savedMetadata: Record<string, unknown> | null = null;
  const actions = createReportReviewActions({
    authority: {
      loadFresh: async () => ({
        guildId: 'guild-1',
        userId: 'moderator-1',
        present: true,
        owner: false,
        permissions: String(1n << 40n),
        roleIds: [],
      }),
    },
    staffRoles: { loadRoleIds: async () => [] },
    repository: {
      closeSubmittedReport: async (input): Promise<ReportReviewRecord> => {
        savedMetadata = input.metadata;
        return {
          id: input.reportId,
          server_id: input.serverId,
          thread_id: null,
          status: input.status,
        };
      },
    },
    queueRepository: null,
    queueMessageDeleter: null,
    openCaseRepository: null,
    reportCaseOpener: null,
  });
  await expect(
    actions.close(context, { reportId: 'report-1', action: 'mark_actioned' })
  ).resolves.toMatchObject({
    kind: 'outcome',
    outcome: { actor: { id: 'moderator-1', surface: 'discord_interaction' }, status: 'closed' },
  });
  expect(savedMetadata).toMatchObject({
    closed_by: 'moderator-1',
    closed_surface: 'discord_interaction',
  });
});
