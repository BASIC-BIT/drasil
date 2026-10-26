import type { ActionContext } from '@drasil/application';
// Explicit legacy test-build boundary. Never imported by the release build.
import { discordMessageUrl } from '@/lib/discordUrls';
import { fixtureGuildId, fixtureTimestampIso } from '@/lib/e2eFixtures';
import {
  type ReporterOpenReportIntake,
  type ReportIntakePortalDataAdapter,
} from '../../lib/reportIntakePortalDataAdapter';
export * from '../../lib/reportIntakePortalDataAdapter';

export class FixtureReportIntakePortalDataAdapter implements ReportIntakePortalDataAdapter {
  public async getOpenIntakeForReporter(input: {
    readonly guildId: string;
    readonly reporterId: string;
  }): Promise<ReporterOpenReportIntake | null> {
    if (input.guildId !== fixtureGuildId || input.reporterId !== 'fixture-admin') {
      return null;
    }

    return {
      createdAt: fixtureTimestampIso,
      guildId: fixtureGuildId,
      id: '00000000-0000-4000-8000-000000000001',
      status: 'collecting_evidence',
      threadId: 'report-thread-1',
      threadUrl: discordMessageUrl(fixtureGuildId, 'report-thread-1'),
      updatedAt: fixtureTimestampIso,
    };
  }
}

export function createReportIntakePortalDataAdapter(): ReportIntakePortalDataAdapter {
  return new FixtureReportIntakePortalDataAdapter();
}

export async function loadReporterOpenIntake(
  context: ActionContext
): Promise<ReporterOpenReportIntake | null> {
  if (context.actor.kind !== 'user') return null;
  return createReportIntakePortalDataAdapter().getOpenIntakeForReporter({
    guildId: context.guildId,
    reporterId: context.actor.userId,
  });
}
