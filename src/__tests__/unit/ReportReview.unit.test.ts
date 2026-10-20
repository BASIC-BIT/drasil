import {
  createReportReviewActions,
  type ReportReviewRecord,
  type AuthorityFacts,
} from '@drasil/application';
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

it('rejects case opening through compiled exports after permissions are revoked with the responder role retained', async () => {
  const context = createDiscordActionContext({
    guildId: 'guild-1',
    userId: 'moderator-1',
    requestId: 'interaction-1',
  });
  let facts: AuthorityFacts = {
    guildId: 'guild-1',
    userId: 'moderator-1',
    present: true,
    owner: false,
    permissions: String(1n << 40n),
    roleIds: ['responder-1'],
  };
  const findCandidate = jest.fn(async () => ({
    id: 'report-1',
    server_id: 'guild-1',
    status: 'submitted',
    confirmed_target_user_id: 'target-1',
    latest_detection_id: 'detection-1',
    latest_case_id: null,
  }));
  const openCase = jest.fn(async () => ({ status: 'queued' as const, requestId: 'request-1' }));
  const actions = createReportReviewActions({
    authority: { loadFresh: async () => facts },
    staffRoles: { loadRoleIds: async () => ['responder-1'] },
    repository: { closeSubmittedReport: async (): Promise<ReportReviewRecord | null> => null },
    queueRepository: null,
    queueMessageDeleter: null,
    openCaseRepository: { findSubmittedReportCaseCandidate: findCandidate },
    reportCaseOpener: { openObservedDetectionCase: openCase },
  });
  await expect(actions.openCase(context, { reportId: 'report-1' })).resolves.toMatchObject({
    kind: 'outcome',
    outcome: { status: 'queued' },
  });
  facts = { ...facts, permissions: '0' };
  findCandidate.mockClear();
  openCase.mockClear();
  await expect(actions.openCase(context, { reportId: 'report-1' })).resolves.toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  expect(findCandidate).not.toHaveBeenCalled();
  expect(openCase).not.toHaveBeenCalled();
});
