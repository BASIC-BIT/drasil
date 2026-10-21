import {
  createMcpAudit,
  isMcpEnabled,
  createAlternativeApprovals,
  createDelegatedActionService,
  createHumanIntentResolver,
  createCaseIntentResolver,
  createReportIntentResolver,
  createSetupIntentResolver,
  createContainmentIntentResolver,
  prepareSubmittedReportCaseOpen,
  revalidateSavedIntakeChoice,
  ActionDeniedError,
  parseSetupStoredRecord,
  shippedResetChanges,
  setupCaptchaProviderIssues,
  memberContextFor,
  workflowDefinitions,
  type AttentionActions,
  type AlternativeApprovals,
  type ReportResolutionResources,
  type SetupResolutionResources,
  type DelegatedPrincipal,
  type WorkflowId,
  type SetupSelectionResources,
} from '@drasil/application';
import {
  createMcpOperationalStore,
  createDelegationStore,
  createActorApprovalStore,
  createCaseResolutionResources,
  createReportResources,
  createReportReviewReferenceStore,
  createContainmentResources,
} from '@drasil/application/postgres';
import type { PrismaClient } from '../../db/prisma';
import type { IModerationQueueService } from '../../services/ModerationQueueService';
import { getCaseResponderSettings } from '../../utils/caseResponderSettings';
import { createBotDelegationDatabase, createBotDelegatedAccess } from './delegation';
import { createBotAuthority } from './authority';
import { readDelegatedMessage } from './delegatedCases';
import { createBotDirectActionExecutor } from './directActions';
import { createBotReportReviewActions } from './reportReview';
import type { BotSetupDependencies } from './setup';

export function createBotMcpApprovals(
  deps: BotSetupDependencies & {
    prisma: PrismaClient;
    attention: AttentionActions;
    queueService: IModerationQueueService;
  }
): AlternativeApprovals {
  const database = createBotDelegationDatabase(deps.prisma);
  const store = createDelegationStore(database, {
    enabled: isMcpEnabled,
    audit: createMcpAudit((line) => console.info(line)),
  });
  const access = createBotDelegatedAccess(deps, store);
  const authority = createBotAuthority(deps.client);
  const staffRoles = {
    loadRoleIds: async (guildId: string): Promise<readonly string[]> =>
      getCaseResponderSettings(
        (
          await deps.configService.getServerConfig(guildId, {
            forceRefresh: true,
            failOnReadError: true,
          })
        ).settings
      ).roleIds,
  };
  const reports = createReportResources(database);
  const reviews = createReportReviewReferenceStore(database);
  const reportReview = createBotReportReviewActions({
    database,
    authority,
    staffRoles,
    queueService: deps.queueService,
  });
  async function message(
    principal: DelegatedPrincipal,
    guildId: string,
    workflowId: WorkflowId,
    selected: { channelId: string; messageId: string }
  ): ReturnType<typeof readDelegatedMessage> {
    const workflow = workflowDefinitions.find((entry) => entry.id === workflowId);
    const context = workflow && memberContextFor(workflow);
    if (!context) throw new ActionDeniedError('permission_denied');
    const allowed = await access.authorizeRead(principal, {
      kind: 'member_context',
      guildId,
      ...context,
    });
    if (allowed.kind === 'denied') throw new ActionDeniedError(allowed.reason);
    return readDelegatedMessage(deps.client, { guildId, userId: principal.userId }, selected);
  }
  async function loadGuildResources(guildId: string): Promise<SetupSelectionResources> {
    const guild = await deps.client.guilds.fetch({ guild: guildId, force: true });
    const roles = await guild.roles.fetch();
    const channels = await guild.channels.fetch();
    return {
      roles: [...roles.values()].map(({ id, name }) => ({ id, name })),
      channels: [...channels.values()]
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .map(({ id, name, type }) => ({ id, name, type })),
    };
  }
  const resolver = createHumanIntentResolver({
    cases: createCaseIntentResolver({
      access,
      resources: (principal, guildId, workflowId) =>
        createCaseResolutionResources(database, guildId, (command) =>
          'selectedMessage' in command && command.selectedMessage
            ? message(principal, guildId, workflowId, command.selectedMessage)
            : Promise.resolve(null)
        ),
    }),
    reports: createReportIntentResolver({
      access,
      resources: (principal, guildId, previous) => ({
        prepareSubmittedReportCaseOpen: (
          reportId
        ): ReturnType<ReportResolutionResources['prepareSubmittedReportCaseOpen']> =>
          prepareSubmittedReportCaseOpen(
            {
              guildId,
              requestId: 'preparation',
              source: 'mcp',
              actor: { kind: 'user', userId: principal.userId },
            },
            { reportId },
            { authority, openCaseRepository: reports.openCaseRepository }
          ),
        async resolveIntakeChoice(): ReturnType<ReportResolutionResources['resolveIntakeChoice']> {
          // The bot has no public initial-reference path; only trusted saved intents reach this resolver.
          if (!previous || previous.guildId !== guildId)
            throw new ActionDeniedError('confirmation_required');
          return revalidateSavedIntakeChoice(principal, previous, {
            ...reports,
            authority,
            staffRoles,
          });
        },
        loadReview: (reference): ReturnType<ReportResolutionResources['loadReview']> =>
          reviews.load(principal, guildId, reference),
        async message(command): ReturnType<ReportResolutionResources['message']> {
          const current = await message(principal, guildId, 'submit_message_report', command);
          return current
            ? {
                kind: 'report_message',
                guildId: current.guildId,
                channelId: current.channelId,
                messageId: current.messageId,
                targetUserId: current.userId,
                fingerprint: current.fingerprint,
              }
            : null;
        },
        async detection(id): ReturnType<ReportResolutionResources['detection']> {
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
    setup: createSetupIntentResolver({
      authority,
      loadGuildResources,
      provider: {
        isConfigured: () =>
          setupCaptchaProviderIssues({
            siteKeyConfigured: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
            secretKeyConfigured: Boolean(process.env.TURNSTILE_SECRET_KEY?.trim()),
            bindingSecretConfigured: Boolean(process.env.DRASIL_CAPTCHA_BINDING_SECRET?.trim()),
            expectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim(),
            publicUrl:
              process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.DRASIL_WEB_PUBLIC_URL?.trim(),
          }).length === 0,
      },
      loadHeuristicDefaults: async (scope) => shippedResetChanges(scope),
      async loadServer(guildId): ReturnType<SetupResolutionResources['loadServer']> {
        const { rows } = await database.query('select * from servers where guild_id=$1', [guildId]);
        return rows.length ? parseSetupStoredRecord(rows[0]) : null;
      },
    }),
    containment: createContainmentIntentResolver(createContainmentResources(database)),
  });
  const service = createDelegatedActionService({
    operations: {
      ...createMcpOperationalStore(database),
      recordMcpAudit: createMcpAudit((line) => console.info(line)),
      enabled: isMcpEnabled,
    },
    store,
    access,
    resolver,
    direct: createBotDirectActionExecutor({ ...deps, reportReview }),
  });
  return createAlternativeApprovals({
    store: createActorApprovalStore(database),
    access,
    service,
    checkRead: async (principal, guildId) => {
      const decision = await createMcpOperationalStore(database).checkMcpLimit(
        { ...principal, guildId },
        'read'
      );
      return decision.kind === 'allowed';
    },
  });
}
