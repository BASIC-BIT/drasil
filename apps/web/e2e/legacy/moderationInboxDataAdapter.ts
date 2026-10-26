// Explicit legacy test-build boundary. Never imported by the release build.
import { fixtureModerationInboxItems } from '@/lib/inboxFixtures';
import { readFixtureReportBan } from '@/lib/reportBanFixtures';
import { type ModerationInboxItem } from '@drasil/contracts';
import { type ModerationInboxDataAdapter } from '../../lib/moderationInboxDataAdapter';
export * from '../../lib/moderationInboxDataAdapter';

export class FixtureModerationInboxDataAdapter implements ModerationInboxDataAdapter {
  public async listInboxItems(guildId: string): Promise<ModerationInboxItem[]> {
    const request = await readFixtureReportBan();
    return fixtureModerationInboxItems(guildId).filter(
      (item) =>
        request?.observedBanResult?.status !== 'banned' ||
        item.kind !== 'submitted_report' ||
        item.sourceId !== request.reportIntakeId
    );
  }
}

export function createModerationInboxDataAdapter(): ModerationInboxDataAdapter {
  return new FixtureModerationInboxDataAdapter();
}
