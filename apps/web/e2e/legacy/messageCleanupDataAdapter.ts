// Explicit legacy test-build boundary. Never imported by the release build.
import {
  fixtureMessageCleanupCaseWorkspaces,
  fixtureMessageCleanupJobDetails,
} from '@/lib/messageCleanupFixtures';
import {
  MESSAGE_CLEANUP_LATEST_JOB_LIMIT,
  messageCleanupCaseWorkspaceSchema,
  messageCleanupJobDetailSchema,
  messageCleanupJobSummarySchema,
  type MessageCleanupCaseWorkspace,
  type MessageCleanupJobDetail,
  type MessageCleanupJobSummary,
} from '@drasil/contracts';
import { type MessageCleanupDataAdapter } from '../../lib/messageCleanupDataAdapter';
export * from '../../lib/messageCleanupDataAdapter';

export class FixtureMessageCleanupDataAdapter implements MessageCleanupDataAdapter {
  public async getCaseWorkspace(
    guildId: string,
    verificationEventId: string
  ): Promise<MessageCleanupCaseWorkspace | null> {
    const workspace = fixtureMessageCleanupCaseWorkspaces.find(
      (candidate) =>
        candidate.guildId === guildId && candidate.verificationEventId === verificationEventId
    );
    return workspace ? messageCleanupCaseWorkspaceSchema.parse(workspace) : null;
  }

  public async listCaseWorkspaces(
    guildId: string,
    verificationEventIds: readonly string[]
  ): Promise<MessageCleanupCaseWorkspace[]> {
    const caseIds = new Set(verificationEventIds);
    return fixtureMessageCleanupCaseWorkspaces
      .filter(
        (workspace) => workspace.guildId === guildId && caseIds.has(workspace.verificationEventId)
      )
      .map((workspace) => messageCleanupCaseWorkspaceSchema.parse(workspace));
  }

  public async listLatestJobs(
    guildId: string,
    verificationEventId: string,
    limit = MESSAGE_CLEANUP_LATEST_JOB_LIMIT
  ): Promise<MessageCleanupJobSummary[]> {
    return fixtureMessageCleanupJobDetails
      .filter((job) => job.guildId === guildId && job.verificationEventId === verificationEventId)
      .slice(0, toLatestJobLimit(limit))
      .map((job) => messageCleanupJobSummarySchema.parse(job));
  }

  public async getJobDetail(
    guildId: string,
    verificationEventId: string,
    jobId: string
  ): Promise<MessageCleanupJobDetail | null> {
    const detail = fixtureMessageCleanupJobDetails.find(
      (candidate) =>
        candidate.guildId === guildId &&
        candidate.verificationEventId === verificationEventId &&
        candidate.id === jobId
    );
    return detail ? messageCleanupJobDetailSchema.parse(detail) : null;
  }
}

export function createMessageCleanupDataAdapter(): MessageCleanupDataAdapter {
  return new FixtureMessageCleanupDataAdapter();
}

function toLatestJobLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return MESSAGE_CLEANUP_LATEST_JOB_LIMIT;
  }
  return Math.min(MESSAGE_CLEANUP_LATEST_JOB_LIMIT, Math.max(1, Math.trunc(value)));
}
