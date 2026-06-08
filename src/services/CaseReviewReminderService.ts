import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { inject, injectable } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { IServerRepository } from '../repositories/ServerRepository';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { Server, VerificationEvent } from '../repositories/types';
import { CASE_REVIEW_DIGEST_OPEN_CUSTOM_ID } from '../utils/caseReviewDigestCustomIds';
import {
  CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY,
  getCaseReviewReminderSettings,
} from '../utils/caseReviewReminderSettings';
import { buildAdminCaseQueueUrl } from '../utils/publicWebLinks';
import { NotificationPresentationBuilder } from './NotificationPresentationBuilder';

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
  private readonly presentationBuilder = new NotificationPresentationBuilder();

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
      this.shouldRemind(event, now, settings.staleHours)
    );
    if (staleCases.length === 0) {
      return;
    }
    if (!this.shouldSendDigest(server, now, settings.repeatHours)) {
      return;
    }

    const channel = await this.configService.getAdminChannel(server.guild_id);
    if (!channel) {
      return;
    }

    const sortedCases = this.sortPendingCasesForDigest(pendingCases, staleCases);

    const roleIds = this.presentationBuilder.getCaseNotificationRoleIds(server);
    await channel.send({
      content: this.buildReminderMessage(
        server.guild_id,
        channel.id,
        sortedCases,
        new Set(staleCases.map((event) => event.id)),
        now,
        this.presentationBuilder.formatRoleMentions(roleIds)
      ),
      allowedMentions: this.presentationBuilder.createAdminAllowedMentions(roleIds),
      components: [this.createDigestActionRow(server.guild_id)],
    });

    try {
      await this.configService.updateServerSettings(server.guild_id, {
        [CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY]: now.toISOString(),
      });
    } catch (error) {
      console.error(`Failed to stamp case review digest metadata for ${server.guild_id}:`, error);
    }
  }

  private shouldRemind(event: VerificationEvent, now: Date, staleHours: number): boolean {
    const lastMovementAt = event.updated_at;
    if (now.getTime() - lastMovementAt.getTime() < staleHours * 60 * 60 * 1000) {
      return false;
    }

    return true;
  }

  private shouldSendDigest(server: Server, now: Date, repeatHours: number): boolean {
    const lastSentAt = this.parseDate(server.settings[CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY]);
    if (!lastSentAt) {
      return true;
    }

    return now.getTime() - lastSentAt.getTime() >= repeatHours * 60 * 60 * 1000;
  }

  private sortPendingCasesForDigest(
    pendingCases: VerificationEvent[],
    staleCases: VerificationEvent[]
  ): VerificationEvent[] {
    const staleCaseIds = new Set(staleCases.map((event) => event.id));
    return [...pendingCases].sort((left, right) => {
      const leftIsStale = staleCaseIds.has(left.id);
      const rightIsStale = staleCaseIds.has(right.id);
      if (leftIsStale !== rightIsStale) {
        return leftIsStale ? -1 : 1;
      }

      return left.updated_at.getTime() - right.updated_at.getTime();
    });
  }

  private buildReminderMessage(
    guildId: string,
    adminChannelId: string,
    events: VerificationEvent[],
    staleCaseIds: Set<string>,
    now: Date,
    heading = 'Case review reminder'
  ): string {
    const visibleEvents = events.slice(0, CASE_REVIEW_REMINDER_MAX_CASES);
    const staleCount = events.filter((event) => staleCaseIds.has(event.id)).length;
    const lines = [
      heading,
      `There ${events.length === 1 ? 'is' : 'are'} ${events.length} pending case${events.length === 1 ? '' : 's'} needing review; ${staleCount} ${staleCount === 1 ? 'is' : 'are'} stale.`,
      '',
      ...visibleEvents.map((event) =>
        this.formatCaseLine(guildId, adminChannelId, event, now, staleCaseIds.has(event.id))
      ),
    ];

    if (events.length > visibleEvents.length) {
      lines.push(
        '',
        `Showing first ${visibleEvents.length}; ${events.length - visibleEvents.length} more pending case(s) are also stale.`
      );
    }

    return lines.join('\n');
  }

  private formatCaseLine(
    guildId: string,
    adminChannelId: string,
    event: VerificationEvent,
    now: Date,
    isStale: boolean
  ): string {
    const lastMovementAt = event.updated_at;
    const ageHours = Math.max(
      1,
      Math.floor((now.getTime() - lastMovementAt.getTime()) / (60 * 60 * 1000))
    );
    const links = [
      event.notification_message_id
        ? `admin: https://discord.com/channels/${guildId}/${adminChannelId}/${event.notification_message_id}`
        : null,
      event.private_evidence_thread_id
        ? `evidence: https://discord.com/channels/${guildId}/${event.private_evidence_thread_id}`
        : null,
      event.thread_id ? `case: https://discord.com/channels/${guildId}/${event.thread_id}` : null,
      this.formatSourceMessageLink(guildId, event),
    ].filter((value): value is string => Boolean(value));

    return `- ${isStale ? '[STALE]' : '[pending]'} <@${event.user_id}> (${event.user_id}) ${ageHours}h since update${links.length ? ` - ${links.join(' | ')}` : ''}`;
  }

  private formatSourceMessageLink(guildId: string, event: VerificationEvent): string | null {
    const metadata = this.metadataToRecord(event.metadata);
    const sourceChannelId = this.readString(metadata.source_channel_id);
    const sourceMessageId = this.readString(metadata.source_message_id);
    if (!sourceChannelId || !sourceMessageId) {
      return null;
    }

    return `source: https://discord.com/channels/${guildId}/${sourceChannelId}/${sourceMessageId}`;
  }

  private createDigestActionRow(guildId: string): ActionRowBuilder<ButtonBuilder> {
    const buttons = [
      new ButtonBuilder()
        .setCustomId(CASE_REVIEW_DIGEST_OPEN_CUSTOM_ID)
        .setLabel('Open Cases')
        .setStyle(ButtonStyle.Primary),
    ];

    const webQueueUrl = buildAdminCaseQueueUrl(guildId);
    if (webQueueUrl) {
      buttons.push(
        new ButtonBuilder().setLabel('Web Queue').setStyle(ButtonStyle.Link).setURL(webQueueUrl)
      );
    }

    return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
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
