import { inject, injectable } from 'inversify';
import { Client, EmbedBuilder } from 'discord.js';
import { TYPES } from '../di/symbols';
import { IReportIntakeRepository } from '../repositories/ReportIntakeRepository';
import { ownsPresentation, presentationMetadata } from '../repositories/reportIntakeProcessing';
import type { ReportPresentationClaim } from '../repositories/types';
import { IModerationQueueService } from './ModerationQueueService';
import { IReportIntakeService, getReportConfirmationMessageIds } from './ReportIntakeService';
import { IThreadManager } from './ThreadManager';
import { findAuthoredReportMessage } from '../utils/reportPresentationDiscord';

export const REPORT_HANDOFF_RECEIPT =
  "Your evidence is saved for moderator review. You don't need to do anything else.";
export interface IReportIntakeHandoffService {
  deliverPending(limit?: number): Promise<number>;
  publishOutcome(intakeId: string): Promise<void>;
}
@injectable()
export class ReportIntakeHandoffService implements IReportIntakeHandoffService {
  constructor(
    @inject(TYPES.ReportIntakeRepository) private repository: IReportIntakeRepository,
    @inject(TYPES.ModerationQueueService) private queue: IModerationQueueService,
    @inject(TYPES.DiscordClient) private client: Client,
    @inject(TYPES.ReportIntakeService) private intakeService: IReportIntakeService,
    @inject(TYPES.ThreadManager) private threads: IThreadManager
  ) {}
  async deliverPending(limit = 5): Promise<number> {
    let delivered = 0;
    for (let index = 0; index < Math.min(5, Math.max(0, Math.floor(limit))); index++) {
      const claim = await this.repository.claimPendingPresentation(new Date());
      if (!claim) break;
      await this.presentClaim(claim);
      delivered++;
    }
    return delivered;
  }
  async publishOutcome(intakeId: string): Promise<void> {
    const claim = await this.repository.claimPendingPresentation(new Date(), intakeId);
    if (!claim) return;
    await this.presentClaim(claim);
  }
  private async presentClaim(claim: ReportPresentationClaim): Promise<void> {
    try {
      await this.deliver(claim);
    } catch {
      await this.repository.completePresentation(claim, { kind: 'failed' });
    }
  }
  private async publishConfirmation(claim: ReportPresentationClaim): Promise<void> {
    const intake = await this.repository.findById(claim.intake.id);
    if (!intake?.thread_id) throw new Error('Report thread is unavailable');
    const { analysis } = presentationMetadata(intake);
    if (analysis.outcome?.kind !== 'confirm') return;
    const channel = await this.client.channels.fetch(intake.thread_id);
    if (!channel || !('messages' in channel)) throw new Error('Report thread is unavailable');
    const sourceId = analysis.outcome.candidate.sourceRefs[0]?.messageId;
    if (!sourceId) throw new Error('Report source is unavailable');
    const message = await channel.messages.fetch(sourceId);
    if (!(await this.intakeService.publishSavedConfirmation(intake.id, message, claim)))
      throw new Error('Report confirmation is not published');
  }
  private async deliver(claim: ReportPresentationClaim): Promise<void> {
    const current = await this.repository.findById(claim.intake.id);
    if (!current || !ownsPresentation(current, claim, new Date())) return;
    const { analysis } = presentationMetadata(current);
    if (!analysis.outcome) return;
    if (analysis.outcome.kind === 'confirm') {
      await this.publishConfirmation(claim);
      await this.repository.completePresentation(claim, { kind: 'published' });
      return;
    }
    let receipt: 'pending' | 'sent' =
      analysis.handoff.state !== 'none' ? analysis.handoff.receipt : 'pending';
    if (receipt !== 'sent') {
      try {
        if (await this.sendReceipt(claim)) receipt = 'sent';
      } catch {
        /* Receipt delivery and moderator notification recover independently. */
      }
    }
    await this.threads.retireReportConfirmationPrompts(
      current,
      getReportConfirmationMessageIds(current)
    );
    const result = await this.queue.upsertReportIdentityReview({
      intake: current,
      outcome: analysis.outcome,
      revision: claim.revision,
    });
    if (!result.delivered || !result.channelId || !result.messageId) {
      await this.repository.completePresentation(claim, { kind: 'failed' });
      return;
    }
    await this.repository.completePresentation(claim, {
      kind: 'delivered',
      channelId: result.channelId,
      messageId: result.messageId,
      receipt,
    });
  }
  private async sendReceipt(claim: ReportPresentationClaim): Promise<boolean> {
    const current = await this.repository.findById(claim.intake.id);
    if (!current?.thread_id || !ownsPresentation(current, claim, new Date()) || !this.client.user)
      return false;
    const { metadata, analysis } = presentationMetadata(current);
    if (analysis.handoff.state === 'none') return false;
    if (analysis.handoff.receipt === 'sent') return true;
    const channel = await this.client.channels.fetch(current.thread_id);
    if (
      !channel ||
      !('send' in channel) ||
      !('messages' in channel) ||
      !('guildId' in channel) ||
      channel.guildId !== current.server_id ||
      channel.id !== current.thread_id
    )
      return false;
    const marker = `Report receipt ${current.id}`;
    const recovered =
      analysis.handoff.receipt_reserved === true &&
      (await findAuthoredReportMessage(
        channel,
        this.client.user.id,
        marker,
        current.created_at ?? new Date(0)
      ));
    if (!recovered) {
      analysis.handoff.receipt_reserved = true;
      const reserved = await this.repository.updateIfCurrent(current, {
        metadata: { ...metadata, analysis },
      });
      if (!reserved) return false;
      const fresh = await this.repository.findById(current.id);
      if (!fresh || !ownsPresentation(fresh, claim, new Date())) return false;
      await channel.send({
        content: REPORT_HANDOFF_RECEIPT,
        embeds: [new EmbedBuilder().setFooter({ text: marker })],
        allowedMentions: { parse: [] },
      });
    }
    const latest = await this.repository.findById(current.id);
    if (!latest || !ownsPresentation(latest, claim, new Date())) return false;
    const saved = presentationMetadata(latest);
    if (saved.analysis.handoff.state === 'none') return false;
    saved.analysis.handoff.receipt = 'sent';
    return Boolean(
      await this.repository.updateIfCurrent(latest, {
        metadata: { ...saved.metadata, analysis: saved.analysis },
      })
    );
  }
}
