import { inject, injectable } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { IServerRepository } from '../repositories/ServerRepository';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { Server, VerificationEvent } from '../repositories/types';
import { getCaseResponderSettings } from '../utils/caseResponderSettings';
import { getCaseReviewReminderSettings } from '../utils/caseReviewReminderSettings';

const CASE_REVIEW_LAST_REMINDED_AT_METADATA_KEY = 'case_review_last_reminded_at';
const CASE_REVIEW_REMINDER_INTERVAL_MS = 15 * 60 * 1000;
const CASE_REVIEW_REMINDER_MAX_CASES = 10;

export interface ICaseReviewReminderService {
  start(): void;
  stop(): void;
  runOnce(now?: Date): Promise<void>;
}

@injectable()
export class CaseReviewReminderService implements ICaseReviewReminderService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @inject(TYPES.ServerRepository) private readonly serverRepository: IServerRepository,
    @inject(TYPES.VerificationEventRepository)
    private readonly verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.ConfigService) private readonly configService: IConfigService
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }

    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, CASE_REVIEW_REMINDER_INTERVAL_MS);
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  public async runOnce(now = new Date()): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const servers = await this.serverRepository.findAllActive();
      for (const server of servers) {
        await this.processServer(server, now).catch((error) => {
          console.error(
            `Failed to process case review reminders for guild ${server.guild_id}:`,
            error
          );
        });
      }
    } finally {
      this.running = false;
    }
  }

  private async processServer(server: Server, now: Date): Promise<void> {
    const settings = getCaseReviewReminderSettings(server.settings);
    if (!settings.enabled) {
      return;
    }

    const pendingCases = await this.verificationEventRepository.findPendingByServer(
      server.guild_id
    );
    const staleCases = pendingCases.filter((event) =>
      this.shouldRemind(event, now, settings.staleHours, settings.repeatHours)
    );
    if (staleCases.length === 0) {
      return;
    }

    const channel = await this.configService.getAdminChannel(server.guild_id);
    if (!channel) {
      return;
    }

    const roleIds = getCaseResponderSettings(server.settings).roleIds;
    await channel.send({
      content: this.buildReminderMessage(server.guild_id, staleCases, roleIds, now),
      allowedMentions: {
        parse: [],
        users: [],
        roles: roleIds,
        repliedUser: false,
      },
    });

    for (const event of staleCases) {
      await this.stampReminder(event, now).catch((error) => {
        console.error(`Failed to stamp case reminder metadata for ${event.id}:`, error);
      });
    }
  }

  private shouldRemind(
    event: VerificationEvent,
    now: Date,
    staleHours: number,
    repeatHours: number
  ): boolean {
    const lastMovementAt = event.updated_at;
    if (now.getTime() - lastMovementAt.getTime() < staleHours * 60 * 60 * 1000) {
      return false;
    }

    const metadata = this.metadataToRecord(event.metadata);
    const remindedAt = this.parseDate(metadata[CASE_REVIEW_LAST_REMINDED_AT_METADATA_KEY]);
    if (!remindedAt) {
      return true;
    }

    return now.getTime() - remindedAt.getTime() >= repeatHours * 60 * 60 * 1000;
  }

  private buildReminderMessage(
    guildId: string,
    events: VerificationEvent[],
    roleIds: string[],
    now: Date
  ): string {
    const roleMentions = roleIds.map((roleId) => `<@&${roleId}>`).join(' ');
    const visibleEvents = events.slice(0, CASE_REVIEW_REMINDER_MAX_CASES);
    const lines = [
      roleMentions || 'Case review reminder',
      `There ${events.length === 1 ? 'is' : 'are'} ${events.length} stale pending case${events.length === 1 ? '' : 's'} needing review.`,
      '',
      ...visibleEvents.map((event) => this.formatCaseLine(guildId, event, now)),
    ];

    if (events.length > visibleEvents.length) {
      lines.push(
        '',
        `Showing first ${visibleEvents.length}; ${events.length - visibleEvents.length} more pending case(s) are also stale.`
      );
    }

    return lines.join('\n');
  }

  private formatCaseLine(guildId: string, event: VerificationEvent, now: Date): string {
    const lastMovementAt = event.updated_at;
    const ageHours = Math.max(
      1,
      Math.floor((now.getTime() - lastMovementAt.getTime()) / (60 * 60 * 1000))
    );
    const links = [
      event.private_evidence_thread_id
        ? `evidence: https://discord.com/channels/${guildId}/${event.private_evidence_thread_id}`
        : null,
      event.thread_id ? `case: https://discord.com/channels/${guildId}/${event.thread_id}` : null,
    ].filter((value): value is string => Boolean(value));

    return `- <@${event.user_id}> (${event.user_id}) stale for ${ageHours}h${links.length ? ` - ${links.join(' | ')}` : ''}`;
  }

  private async stampReminder(event: VerificationEvent, now: Date): Promise<void> {
    await this.verificationEventRepository.update(event.id, {
      metadata: {
        ...this.metadataToRecord(event.metadata),
        [CASE_REVIEW_LAST_REMINDED_AT_METADATA_KEY]: now.toISOString(),
      } as VerificationEvent['metadata'],
    });
  }

  private metadataToRecord(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return { ...(metadata as Record<string, unknown>) };
  }

  private parseDate(value: unknown): Date | null {
    if (typeof value !== 'string') {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
