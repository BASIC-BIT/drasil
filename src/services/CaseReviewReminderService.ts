import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, ThreadChannel } from 'discord.js';
import { inject, injectable } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { IServerRepository } from '../repositories/ServerRepository';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { Server, VerificationEvent, VerificationStatus } from '../repositories/types';
import { CASE_REVIEW_DIGEST_OPEN_CUSTOM_ID } from '../utils/caseReviewDigestCustomIds';
import {
  CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY,
  getCaseReviewReminderSettings,
} from '../utils/caseReviewReminderSettings';
import {
  buildCaseReminderPlan,
  CaseFreshness,
  CaseReminderPlan,
  renderSupportThreadReminder,
} from '../utils/caseReviewReminderSchedule';
import { markSupportThreadReminderSent } from '../utils/supportThreadReminderState';
import { buildAdminCaseQueueUrl } from '../utils/publicWebLinks';
import { NotificationPresentationBuilder } from './NotificationPresentationBuilder';
import { REPORT_REVIEW_THREAD_TYPE, VERIFICATION_THREAD_TYPE_METADATA_KEY } from './ThreadManager';

const CASE_REVIEW_REMINDER_INTERVAL_MS = 15 * 60 * 1000;
const CASE_REVIEW_REMINDER_MAX_VISIBLE_CASES = 10;

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
    @inject(TYPES.ConfigService) private readonly configService: IConfigService,
    @inject(TYPES.DiscordClient) private readonly client: Client
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
    const lastAdminDigestAt = this.parseDate(
      server.settings[CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY]
    );
    let adminDigestSentAt: Date | null = null;

    const initialPlans = new Map(
      pendingCases.map((event) => [
        event.id,
        buildCaseReminderPlan(event, settings, now, {
          lastAdminDigestAt,
          supportsUserReminder: this.isUserFacingSupportCase(event),
        }),
      ])
    );
    const staleCases = pendingCases.filter(
      (event) => initialPlans.get(event.id)?.freshness !== 'fresh'
    );
    if (
      staleCases.length > 0 &&
      this.shouldSendDigest(lastAdminDigestAt, now, settings.repeatHours)
    ) {
      const channel = await this.configService.getAdminChannel(server.guild_id);
      if (channel) {
        const digestPlans = new Map(
          pendingCases.map((event) => [
            event.id,
            buildCaseReminderPlan(event, settings, now, {
              lastAdminDigestAt: now,
              supportsUserReminder: this.isUserFacingSupportCase(event),
            }),
          ])
        );
        const roleIds = this.presentationBuilder.getCaseNotificationRoleIds(server);
        await channel.send({
          content: this.buildReminderMessage(
            server.guild_id,
            channel.id,
            this.sortPendingCasesForDigest(pendingCases, digestPlans),
            digestPlans,
            now,
            this.presentationBuilder.formatRoleMentions(roleIds)
          ),
          allowedMentions: this.presentationBuilder.createAdminAllowedMentions(roleIds),
          components: [this.createDigestActionRow(server.guild_id)],
        });

        adminDigestSentAt = now;
        try {
          await this.configService.updateServerSettings(server.guild_id, {
            [CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY]: now.toISOString(),
          });
        } catch (error) {
          console.error(
            `Failed to stamp case review digest metadata for ${server.guild_id}:`,
            error
          );
        }
      }
    }

    await this.processUserThreadReminders(
      pendingCases,
      settings,
      now,
      adminDigestSentAt ?? lastAdminDigestAt
    );
  }

  private shouldSendDigest(lastSentAt: Date | null, now: Date, repeatHours: number): boolean {
    if (!lastSentAt) {
      return true;
    }

    return now.getTime() - lastSentAt.getTime() >= repeatHours * 60 * 60 * 1000;
  }

  private sortPendingCasesForDigest(
    pendingCases: VerificationEvent[],
    plans: Map<string, CaseReminderPlan>
  ): VerificationEvent[] {
    const freshnessRank: Record<CaseFreshness, number> = {
      very_stale: 0,
      stale: 1,
      fresh: 2,
    };
    return [...pendingCases].sort((left, right) => {
      const leftRank = freshnessRank[plans.get(left.id)?.freshness ?? 'fresh'];
      const rightRank = freshnessRank[plans.get(right.id)?.freshness ?? 'fresh'];
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.updated_at.getTime() - right.updated_at.getTime();
    });
  }

  private buildReminderMessage(
    guildId: string,
    adminChannelId: string,
    events: VerificationEvent[],
    plans: Map<string, CaseReminderPlan>,
    now: Date,
    heading = 'Case review reminder'
  ): string {
    const groupedEvents = this.groupEventsByFreshness(events, plans);
    const staleCount = groupedEvents.stale.length;
    const veryStaleCount = groupedEvents.very_stale.length;
    const lines = [
      heading,
      `There ${events.length === 1 ? 'is' : 'are'} ${events.length} pending case${events.length === 1 ? '' : 's'} needing review: ${groupedEvents.fresh.length} fresh, ${staleCount} stale, ${veryStaleCount} very stale.`,
    ];

    let remainingVisibleCases = CASE_REVIEW_REMINDER_MAX_VISIBLE_CASES;

    remainingVisibleCases = this.appendCaseGroup(
      lines,
      'Very stale - final manual check recommended',
      groupedEvents.very_stale,
      plans,
      guildId,
      adminChannelId,
      now,
      remainingVisibleCases
    );
    remainingVisibleCases = this.appendCaseGroup(
      lines,
      'Stale - waiting on review or user response',
      groupedEvents.stale,
      plans,
      guildId,
      adminChannelId,
      now,
      remainingVisibleCases
    );
    this.appendCaseGroup(
      lines,
      'Fresh - pending but not stale yet',
      groupedEvents.fresh,
      plans,
      guildId,
      adminChannelId,
      now,
      remainingVisibleCases
    );

    if (events.length > CASE_REVIEW_REMINDER_MAX_VISIBLE_CASES) {
      lines.push('', 'Open the case selector to review additional pending cases.');
    }

    lines.push(
      '',
      'User-facing support reminders are sent every 24h until the very-stale threshold, then moderators should make a final manual call.'
    );

    return lines.join('\n');
  }

  private groupEventsByFreshness(
    events: VerificationEvent[],
    plans: Map<string, CaseReminderPlan>
  ): Record<CaseFreshness, VerificationEvent[]> {
    return events.reduce<Record<CaseFreshness, VerificationEvent[]>>(
      (groups, event) => {
        groups[plans.get(event.id)?.freshness ?? 'fresh'].push(event);
        return groups;
      },
      { fresh: [], stale: [], very_stale: [] }
    );
  }

  private appendCaseGroup(
    lines: string[],
    heading: string,
    events: VerificationEvent[],
    plans: Map<string, CaseReminderPlan>,
    guildId: string,
    adminChannelId: string,
    now: Date,
    maxVisibleEvents: number
  ): number {
    if (events.length === 0) {
      return maxVisibleEvents;
    }

    const visibleEvents = events.slice(0, Math.max(0, maxVisibleEvents));
    lines.push('', `${heading} (${events.length})`);
    if (visibleEvents.length > 0) {
      lines.push(
        ...visibleEvents.map((event) =>
          this.formatCaseLine(guildId, adminChannelId, event, now, plans.get(event.id))
        )
      );
    }
    if (events.length > visibleEvents.length) {
      lines.push(`... ${events.length - visibleEvents.length} more in this group.`);
    }

    return maxVisibleEvents - visibleEvents.length;
  }

  private formatCaseLine(
    guildId: string,
    adminChannelId: string,
    event: VerificationEvent,
    now: Date,
    plan: CaseReminderPlan | undefined
  ): string {
    const ageHours = plan?.ageHours ?? 1;
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
    const reminderStatus = this.formatUserReminderStatus(plan);

    return `- <@${event.user_id}> (${event.user_id}) ${ageHours}h since update${reminderStatus ? ` - ${reminderStatus}` : ''}${links.length ? ` - ${links.join(' | ')}` : ''}`;
  }

  private formatUserReminderStatus(plan: CaseReminderPlan | undefined): string | null {
    if (!plan) {
      return null;
    }
    if (plan.userResponded) {
      return 'user responded; awaiting staff review';
    }
    if (plan.userRemindersComplete) {
      if (plan.userReminderLimit === 0) {
        return 'user reminder window closed; final manual check recommended';
      }

      return `user reminders sent ${plan.userReminderCount}/${plan.userReminderLimit}; final manual check recommended`;
    }
    if (plan.nextUserReminderAt) {
      return `next user reminder ${this.formatTimestamp(plan.nextUserReminderAt)} (${plan.userReminderCount}/${plan.userReminderLimit} sent)`;
    }

    return null;
  }

  private async processUserThreadReminders(
    pendingCases: VerificationEvent[],
    settings: ReturnType<typeof getCaseReviewReminderSettings>,
    now: Date,
    lastAdminDigestAt: Date | null
  ): Promise<void> {
    for (const verificationEvent of pendingCases) {
      await this.processUserThreadReminder(
        verificationEvent,
        settings,
        now,
        lastAdminDigestAt
      ).catch((error) => {
        console.warn(
          `Failed to process support-thread reminder for case ${verificationEvent.id}:`,
          error
        );
      });
    }
  }

  private async processUserThreadReminder(
    verificationEvent: VerificationEvent,
    settings: ReturnType<typeof getCaseReviewReminderSettings>,
    now: Date,
    lastAdminDigestAt: Date | null
  ): Promise<void> {
    if (!this.isUserFacingSupportCase(verificationEvent)) {
      return;
    }

    const plan = buildCaseReminderPlan(verificationEvent, settings, now, {
      lastAdminDigestAt,
      supportsUserReminder: true,
    });
    if (!plan.nextUserReminderAt || plan.nextUserReminderAt.getTime() > now.getTime()) {
      return;
    }

    const thread = await this.fetchSupportThread(verificationEvent);
    if (!thread) {
      return;
    }

    await thread.send({
      content: renderSupportThreadReminder(verificationEvent, now),
      allowedMentions: {
        parse: [],
        users: [verificationEvent.user_id],
        roles: [],
        repliedUser: false,
      },
    });

    await this.verificationEventRepository.update(
      verificationEvent.id,
      {
        metadata: markSupportThreadReminderSent(
          verificationEvent.metadata,
          now
        ) as VerificationEvent['metadata'],
      },
      { touchUpdatedAt: false }
    );
  }

  private isUserFacingSupportCase(verificationEvent: VerificationEvent): boolean {
    if (verificationEvent.status !== VerificationStatus.PENDING || !verificationEvent.thread_id) {
      return false;
    }

    const metadata = this.metadataToRecord(verificationEvent.metadata);
    return metadata[VERIFICATION_THREAD_TYPE_METADATA_KEY] !== REPORT_REVIEW_THREAD_TYPE;
  }

  private async fetchSupportThread(
    verificationEvent: VerificationEvent
  ): Promise<ThreadChannel | null> {
    if (!verificationEvent.thread_id) {
      return null;
    }

    const channel = await this.client.channels.fetch(verificationEvent.thread_id).catch(() => null);
    return channel?.isThread() ? channel : null;
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

  private formatTimestamp(value: Date): string {
    const timestamp = Math.floor(value.getTime() / 1000);
    return `<t:${timestamp}:F>`;
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
