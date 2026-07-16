import { notFound, redirect } from 'next/navigation';
import {
  messageCleanupJobDetailSchema,
  messageCleanupJobSummarySchema,
  type MessageCleanupCaseWorkspace,
  type MessageCleanupJobDetail,
} from '@drasil/contracts';
import { CaseDetailView } from '@/components/cases/CaseDetailView';
import { createActiveCaseDataAdapter } from '@/lib/activeCaseDataAdapter';
import { fetchCaseDiscordSnapshot } from '@/lib/caseDiscordContent';
import { DISCORD_PERMISSIONS, hasPermission, parsePermissions } from '@/lib/discordPermissions';
import { createMessageCleanupDataAdapter } from '@/lib/messageCleanupDataAdapter';
import { isWebE2eFixtureMode } from '@/lib/e2eFixtures';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import { queueCaseAction } from '../actions';
import {
  banCaseUserWithMessageCleanup,
  executeCaseMessageCleanup,
  previewCaseMessageCleanup,
} from '../messageCleanupActions';

type PageProps = {
  readonly params: Promise<{ readonly guildId: string; readonly caseId: string }>;
  readonly searchParams: Promise<{ readonly cleanupScenario?: string }>;
};

function withScenarioJobs(
  workspace: MessageCleanupCaseWorkspace,
  deleteOnlyJob: MessageCleanupJobDetail | null,
  combinedJob: MessageCleanupJobDetail | null,
  scenario: string | undefined
): {
  workspace: MessageCleanupCaseWorkspace;
  deleteOnlyJob: MessageCleanupJobDetail | null;
  combinedJob: MessageCleanupJobDetail | null;
} {
  if (!scenario || !deleteOnlyJob || !combinedJob) {
    return { workspace, deleteOnlyJob, combinedJob };
  }

  const sourceItem = deleteOnlyJob.items[0];
  if (!sourceItem) {
    return { workspace, deleteOnlyJob, combinedJob };
  }
  const secondItem = {
    ...sourceItem,
    id: 'cleanup-item-scenario-2',
    messageId: 'message-scenario-2',
    channelId: 'channel-scenario-2',
    contentPreview: 'A second de-linked message included in this review.',
    sourceMessageUrl: 'https://discord.com/channels/guild-1/channel-scenario-2/message-scenario-2',
  };
  let nextDeleteOnlyJob = deleteOnlyJob;
  let nextCombinedJob = combinedJob;

  if (scenario === 'new-preview') {
    return {
      workspace: {
        ...workspace,
        latestJobs: workspace.latestJobs.filter((job) => job.mode !== 'delete_only'),
      },
      deleteOnlyJob: null,
      combinedJob,
    };
  } else if (scenario === 'last-day-success') {
    nextDeleteOnlyJob = messageCleanupJobDetailSchema.parse({
      ...deleteOnlyJob,
      id: 'cleanup-job-last-day-success',
      scope: 'last_day',
      status: 'completed',
      coverage: 'ready',
      reason: 'Remove reviewed messages from the last 24 hours.',
      completedAt: '2026-07-15T15:04:00.000Z',
      outcomes: {
        ...deleteOnlyJob.outcomes,
        candidateCount: 2,
        preservedCount: 2,
        deletedCount: 2,
      },
      execution: { ...deleteOnlyJob.execution, canExecute: false, blockedReason: 'job_not_ready' },
      items: [sourceItem, secondItem].map((item, index) => ({
        ...item,
        evidenceStatus: 'preserved',
        status: 'deleted',
        evidenceMessageUrl: `https://discord.com/channels/guild-1/evidence-thread-1/evidence-scenario-${index + 1}`,
        attemptedAt: '2026-07-15T15:03:00.000Z',
        evidencePreservedAt: '2026-07-15T15:03:01.000Z',
        deletedAt: '2026-07-15T15:03:02.000Z',
        completedAt: '2026-07-15T15:03:02.000Z',
      })),
    });
  } else if (scenario === 'blocked-indexing') {
    nextDeleteOnlyJob = messageCleanupJobDetailSchema.parse({
      ...deleteOnlyJob,
      id: 'cleanup-job-indexing',
      scope: 'last_day',
      coverage: 'indexing',
      outcomes: { ...deleteOnlyJob.outcomes, candidateCount: 24 },
      execution: {
        ...deleteOnlyJob.execution,
        canExecute: false,
        blockedReason: 'coverage_blocked',
      },
      items: [sourceItem, secondItem],
    });
  } else if (scenario === 'too-many') {
    nextDeleteOnlyJob = messageCleanupJobDetailSchema.parse({
      ...deleteOnlyJob,
      id: 'cleanup-job-too-many',
      scope: 'last_7_days',
      coverage: 'too_many',
      outcomes: { ...deleteOnlyJob.outcomes, candidateCount: 101 },
      execution: {
        ...deleteOnlyJob.execution,
        canExecute: false,
        blockedReason: 'execution_limit_exceeded',
      },
      items: [sourceItem, secondItem],
    });
  } else if (scenario === 'changed-result') {
    nextDeleteOnlyJob = messageCleanupJobDetailSchema.parse({
      ...deleteOnlyJob,
      id: 'cleanup-job-changed',
      scope: 'last_day',
      status: 'completed',
      coverage: 'ready',
      completedAt: '2026-07-15T15:04:00.000Z',
      outcomes: {
        ...deleteOnlyJob.outcomes,
        candidateCount: 2,
        preservedCount: 2,
        deletedCount: 1,
        changedSincePreviewCount: 1,
      },
      execution: { ...deleteOnlyJob.execution, canExecute: false, blockedReason: 'job_not_ready' },
      items: [
        {
          ...sourceItem,
          evidenceStatus: 'preserved',
          status: 'deleted',
          evidenceMessageUrl:
            'https://discord.com/channels/guild-1/evidence-thread-1/evidence-changed-1',
        },
        {
          ...secondItem,
          evidenceStatus: 'preserved',
          status: 'changed_since_preview',
          failureReason: 'Message changed after the frozen preview and was not deleted.',
          evidenceMessageUrl:
            'https://discord.com/channels/guild-1/evidence-thread-1/evidence-changed-2',
        },
      ],
    });
  } else if (scenario === 'combined-success') {
    nextCombinedJob = messageCleanupJobDetailSchema.parse({
      ...combinedJob,
      id: 'cleanup-job-combined-success',
      caseFinalizationStatus: 'succeeded',
      lastError: null,
      outcomes: {
        ...combinedJob.outcomes,
        candidateCount: 2,
        preservedCount: 2,
        deletedCount: 2,
        permissionDeniedCount: 0,
      },
      items: combinedJob.items.map((item) => ({
        ...item,
        evidenceStatus: 'preserved',
        status: 'deleted',
        failureReason: null,
      })),
    });
  } else if (scenario === 'combined-ready') {
    nextCombinedJob = messageCleanupJobDetailSchema.parse({
      ...deleteOnlyJob,
      id: 'cleanup-job-combined-ready',
      mode: 'ban_with_cleanup',
      banStatus: 'not_requested',
      caseFinalizationStatus: 'not_applicable',
      reason: 'Ban the case user and remove the frozen source message.',
    });
  }

  return {
    workspace: {
      ...workspace,
      latestJobs: [
        messageCleanupJobSummarySchema.parse(nextDeleteOnlyJob),
        messageCleanupJobSummarySchema.parse(nextCombinedJob),
      ],
    },
    deleteOnlyJob: nextDeleteOnlyJob,
    combinedJob: nextCombinedJob,
  };
}

export default async function CaseDetailPage({ params, searchParams }: PageProps) {
  const { guildId, caseId } = await params;
  const { cleanupScenario } = await searchParams;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/cases/${caseId}`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  const activeCaseDataAdapter = createActiveCaseDataAdapter();
  const detail = await activeCaseDataAdapter.getCaseDetail(guildId, caseId);
  if (!detail) {
    notFound();
  }
  const discordSnapshot = await fetchCaseDiscordSnapshot(guildId, detail);
  const isAdministrator =
    guild.owner ||
    hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.Administrator);
  const canManageCleanup =
    isAdministrator && !(isWebE2eFixtureMode() && cleanupScenario === 'non-administrator');
  const cleanupAdapter = createMessageCleanupDataAdapter();
  const cleanupWorkspace = canManageCleanup
    ? await cleanupAdapter.getCaseWorkspace(guildId, caseId)
    : null;
  const deleteOnlyJobSummary = cleanupWorkspace?.latestJobs.find(
    (job) => job.mode === 'delete_only'
  );
  const combinedJobSummary = cleanupWorkspace?.latestJobs.find(
    (job) => job.mode === 'ban_with_cleanup'
  );
  const [loadedDeleteOnlyJob, loadedCombinedJob] = cleanupWorkspace
    ? await Promise.all([
        deleteOnlyJobSummary
          ? cleanupAdapter.getJobDetail(guildId, caseId, deleteOnlyJobSummary.id)
          : null,
        combinedJobSummary
          ? cleanupAdapter.getJobDetail(guildId, caseId, combinedJobSummary.id)
          : null,
      ])
    : [null, null];
  const cleanupData = cleanupWorkspace
    ? withScenarioJobs(
        cleanupWorkspace,
        loadedDeleteOnlyJob,
        loadedCombinedJob,
        isWebE2eFixtureMode() ? cleanupScenario : undefined
      )
    : null;

  return (
    <CaseDetailView
      canQueueCaseActions={activeCaseDataAdapter.canQueueCaseActions()}
      detail={detail}
      discordSnapshot={discordSnapshot}
      guildId={guildId}
      guildName={guild.name}
      messageCleanup={
        cleanupData
          ? {
              combinedBanAction: banCaseUserWithMessageCleanup.bind(null, guildId, caseId),
              combinedJob: cleanupData.combinedJob,
              deleteOnlyJob: cleanupData.deleteOnlyJob,
              executeAction: executeCaseMessageCleanup.bind(null, guildId, caseId),
              previewAction: previewCaseMessageCleanup.bind(null, guildId, caseId),
              workspace: cleanupData.workspace,
            }
          : undefined
      }
      queueCaseAction={queueCaseAction}
      sessionUsername={session.username}
    />
  );
}
