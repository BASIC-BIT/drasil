import { processingMetadata } from '../repositories/reportIntakeProcessing';
import { activeReportEvidence, buildReportEvidenceBatch } from '../utils/reportIntakeEvidence';
import {
  prepareReportEvidenceSource,
  messageAttachmentsToReportMetadata,
} from '../utils/reportAttachments';
import { awaitReportLookup } from './ReportMemberDirectory';
import {
  projectReportIntakeState,
  type ReportAnalysisOutcome,
  type ReportEvidenceSource,
  type ReportEvidenceRef,
  type ReportSubjectClues,
  type ReportHandoffReason,
  type ReportIdentityExtraction,
} from '@drasil/application';
import type { ReportAnalysisClaim } from '../repositories/types';
import { withObservation, recordObservation } from '../observability/langfuse';
import { hashIdentifier } from '../observability/hash';
import { Client, Guild, Message } from 'discord.js';
import { injectable, inject, optional } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { IReportIntakeRepository } from '../repositories/ReportIntakeRepository';
import {
  ReportIntake,
  ReportIntakeEvidence,
  ReportIntakeEvidenceKind,
  ReportIntakeStatus,
} from '../repositories/types';
import {
  getReportAiSettings,
  ReportAttachmentMetadata,
  selectEligibleReportImageAttachments,
} from '../utils/reportAiSettings';
import { getReportIntakeSettings } from '../utils/reportIntakeSettings';
import {
  REPORT_IDENTITY_MAX_SOURCES,
  REPORT_IDENTITY_TEXT_MAX_LENGTH,
  type IGPTService,
  type ReportIntakeEvidenceExtraction,
} from './GPTService';
import { IReportCandidateService, ReportCandidate } from './ReportCandidateService';
import { IReportIntakeService } from './ReportIntakeService';

const REPORT_INTAKE_AGENT_TEXT_MAX_LENGTH = 2000;
const REPORT_INTAKE_AGENT_NAME_SEARCH_LIMIT = 5;

export interface AnalyzeReportIntakeInput {
  claim: ReportAnalysisClaim;
  signal: AbortSignal;
  reserveModelAttempt(): Promise<boolean>;
}

export interface IReportIntakeAgentService {
  analyze(input: AnalyzeReportIntakeInput): Promise<ReportAnalysisOutcome>;
  scheduleAnalysisForThreadMessage(message: Message): void;
  runAnalysisForThreadMessage(message: Message): Promise<boolean>;
}

@injectable()
export class ReportIntakeAgentService implements IReportIntakeAgentService {
  private scheduledRuns = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @inject(TYPES.ReportIntakeRepository)
    private reportIntakeRepository: IReportIntakeRepository,
    @inject(TYPES.ConfigService) private configService: IConfigService,
    @inject(TYPES.ReportCandidateService) private candidateService: IReportCandidateService,
    @inject(TYPES.ReportIntakeService) private reportIntakeService: IReportIntakeService,
    @inject(TYPES.GPTService) @optional() private gptService?: IGPTService,
    @inject(TYPES.DiscordClient) @optional() private client?: Client
  ) {}

  public async analyze({
    claim,
    signal,
    reserveModelAttempt,
  }: AnalyzeReportIntakeInput): Promise<ReportAnalysisOutcome> {
    signal.throwIfAborted();
    const { intake } = claim;
    const { analysis } = processingMetadata(intake);
    const evidence = await this.reportIntakeRepository.listEvidence(intake.id);
    signal.throwIfAborted();
    const config = await this.configService.getServerConfig(intake.server_id, {
      forceRefresh: true,
      failOnReadError: true,
    });
    if (!getReportIntakeSettings(config.settings).stagedEnabled)
      throw new Error('Staged analysis disabled');
    const settings = getReportAiSettings(config.settings);
    const budgetExcluded = new Set<string>();
    const sources: ReportEvidenceSource[] = [];
    const handoff = (reason: ReportHandoffReason): ReportAnalysisOutcome => ({
      kind: 'admin_review',
      reason,
      candidates: [],
      coverage: { kind: 'unavailable', reason: 'transport' },
      includedEvidenceIds: [],
      excludedEvidenceIds: sources.length
        ? sources.map((source) => source.ref.evidenceId)
        : activeReportEvidence(intake, evidence).map((row) => row.id),
    });
    if (!this.client) return handoff('lookup_failure');
    signal.throwIfAborted();
    let guild: Guild;
    try {
      guild = await awaitReportLookup(this.client.guilds.fetch(intake.server_id), signal);
    } catch {
      signal.throwIfAborted();
      return handoff('lookup_failure');
    }
    signal.throwIfAborted();
    if (guild.id !== intake.server_id) return handoff('lookup_failure');
    let imagesLeft = settings.maxImages;
    let unavailableSource = false;
    for (const [messageId, source] of Object.entries(analysis.sources)) {
      if (source.operation === 'delete') continue;
      const rows = evidence.filter(
        (row) =>
          row.source_message_id === messageId &&
          toRecord(row.metadata).sourceVersion === source.sourceVersion &&
          toRecord(row.metadata).sourceFingerprint === source.sourceFingerprint
      );
      let message: Message | null = null;
      if (source.availability === 'available' && source.sourceChannelId === intake.thread_id) {
        try {
          signal.throwIfAborted();
          const channel = await awaitReportLookup(
            guild.channels.fetch(source.sourceChannelId),
            signal
          );
          signal.throwIfAborted();
          if (
            channel?.isThread() &&
            channel.id === intake.thread_id &&
            channel.guildId === intake.server_id
          ) {
            const current = await awaitReportLookup(
              channel.messages.fetch({ message: messageId, force: true, cache: false }),
              signal
            );
            signal.throwIfAborted();
            if (
              current.id === messageId &&
              current.guildId === intake.server_id &&
              current.channelId === source.sourceChannelId &&
              current.author.id === source.sourceAuthorId
            ) {
              const batch = buildReportEvidenceBatch(current, intake, 'upsert');
              if (
                batch.sourceVersion === source.sourceVersion &&
                batch.sourceFingerprint === source.sourceFingerprint
              )
                message = current;
            }
          }
        } catch {
          signal.throwIfAborted();
        }
      }
      const selectedImages = new Set(
        message
          ? selectEligibleReportImageAttachments(messageAttachmentsToReportMetadata(message), {
              ...settings,
              maxImages: imagesLeft,
            }).map((attachment) => attachment.id)
          : []
      );
      imagesLeft -= selectedImages.size;
      for (const row of rows) {
        const ref: ReportEvidenceRef = {
          evidenceId: row.id,
          messageId,
          sourceVersion: source.sourceVersion,
          role: source.sourceAuthorId === intake.reporter_id ? 'reporter' : 'staff',
          kind: row.kind === ReportIntakeEvidenceKind.SCREENSHOT ? 'image' : 'text',
        };
        if (!message) {
          sources.push({ ref, content: { kind: 'unavailable', reason: 'evidence_unavailable' } });
          continue;
        }
        const prepared = prepareReportEvidenceSource({
          message,
          ref,
          settings,
          attachmentId: row.attachment_id ?? undefined,
        });
        if (
          prepared.content.kind === 'image' &&
          !selectedImages.has(row.attachment_id ?? undefined)
        )
          prepared.content = { kind: 'unavailable', reason: 'excluded' };
        if (
          prepared.content.kind === 'unavailable' &&
          prepared.content.reason === 'excluded' &&
          settings.enabled &&
          settings.analyzeImages &&
          ref.kind === 'image'
        )
          budgetExcluded.add(ref.evidenceId);
        if (prepared.content.kind === 'text') {
          const text = prepared.content.text.trim();
          const clues = this.candidateService.extractCandidateSignals(text);
          const ids = [...new Set([...clues.mentions, ...clues.explicitUserIds])].filter(
            (id) => id !== intake.reporter_id
          );
          const soleAnchor =
            /^(?:<@!?\d{17,20}>|\d{17,20})$/u.test(text) ||
            clues.messageLinks.some(
              (link) => link.guildId === intake.server_id && link.url === text
            );
          if (soleAnchor && (ids.length || clues.messageLinks.length))
            prepared.anchors = [
              {
                subjectId: `anchor:${row.id}`,
                role: 'target',
                readability: 'clear',
                sourceRefs: [ref],
                userIds: ids,
                messageLinks: clues.messageLinks.map((link) => link.url),
                usernames: [],
                displayNames: [],
                uncertainty: [],
              },
            ];
        }
        sources.push(prepared);
      }
      if (!rows.length) unavailableSource = true;
    }
    // Unversioned evidence cannot borrow authorization from a different saved source.
    for (const row of evidence.filter(
      (row) =>
        !row.source_message_id ||
        !Object.prototype.hasOwnProperty.call(analysis.sources, row.source_message_id)
    ))
      sources.push({
        ref: {
          evidenceId: row.id,
          messageId: row.source_message_id ?? row.id,
          sourceVersion: 0,
          role: 'reporter',
          kind: row.kind === ReportIntakeEvidenceKind.SCREENSHOT ? 'image' : 'text',
        },
        content: { kind: 'unavailable', reason: 'evidence_unavailable' },
      });
    signal.throwIfAborted();
    if (
      !sources.length ||
      unavailableSource ||
      sources.some(
        (source) =>
          source.content.kind === 'unavailable' && source.content.reason === 'evidence_unavailable'
      )
    )
      return handoff('evidence_unavailable');
    let includedCount = 0;
    for (const source of sources) {
      if (source.content.kind === 'unavailable') continue;
      if (
        (source.content.kind === 'text' &&
          source.content.text.length > REPORT_IDENTITY_TEXT_MAX_LENGTH) ||
        includedCount >= REPORT_IDENTITY_MAX_SOURCES
      ) {
        budgetExcluded.add(source.ref.evidenceId);
        source.content = { kind: 'unavailable', reason: 'excluded' };
      } else includedCount++;
    }
    const eligible = sources.filter((source) => source.content.kind !== 'unavailable');
    if (!eligible.length)
      return handoff(budgetExcluded.size ? 'evidence_over_budget' : 'incomplete_coverage');
    const anchors = eligible.flatMap((source) => source.anchors ?? []);
    const needsExtraction = eligible.some((source) => !source.anchors?.length);
    let extraction: ReportIdentityExtraction = {
      kind: 'extracted',
      subjects: anchors,
      contextLabels: [],
      includedEvidenceIds: eligible.map((source) => source.ref.evidenceId),
      excludedEvidenceIds: sources
        .filter((source) => source.content.kind === 'unavailable')
        .map((source) => source.ref.evidenceId),
    };
    const extract = async (
      selected: ReportEvidenceSource[]
    ): Promise<ReportIdentityExtraction | null> => {
      signal.throwIfAborted();
      if (
        !this.gptService ||
        Date.now() >= claim.deadline.getTime() ||
        !(await reserveModelAttempt())
      )
        return null;
      signal.throwIfAborted();
      if (Date.now() >= claim.deadline.getTime()) return null;
      return this.gptService.extractReportIdentity({ sources: selected, signal });
    };
    if (needsExtraction) {
      const first = await extract(sources);
      if (!first) return handoff('provider_failure');
      extraction = first;
      if (extraction.kind === 'failed' && extraction.retryable)
        extraction = (await extract(sources)) ?? extraction;
      signal.throwIfAborted();
      if (extraction.kind === 'failed')
        return {
          ...handoff(
            extraction.reason === 'evidence_unavailable'
              ? 'evidence_unavailable'
              : 'provider_failure'
          ),
          includedEvidenceIds: extraction.includedEvidenceIds,
          excludedEvidenceIds: extraction.excludedEvidenceIds,
        };
    }
    const resolve = async (subjects: ReportSubjectClues[]): Promise<ReportAnalysisOutcome> => {
      signal.throwIfAborted();
      return this.candidateService.resolveIdentity({
        guild,
        reporterId: intake.reporter_id,
        subjects,
        signal,
      });
    };
    let outcome = await resolve(extraction.subjects);
    if (outcome.kind === 'admin_review' && outcome.reason === 'uncertain_text') {
      const uncertain = extraction.subjects.filter(
        (subject) => subject.readability !== 'clear' || subject.uncertainty.length
      );
      const refs = new Set(
        uncertain.flatMap((subject) => subject.sourceRefs.map((ref) => ref.evidenceId))
      );
      const targeted = sources.filter((source) => refs.has(source.ref.evidenceId));
      if (targeted.length) {
        const reread = await extract(targeted);
        signal.throwIfAborted();
        if (reread?.kind === 'extracted') {
          const retained = extraction.subjects.filter((subject) => !uncertain.includes(subject));
          // Keep clear clues even when a reread also describes their source.
          outcome = await resolve([
            ...retained,
            ...reread.subjects.map((subject) => ({
              ...subject,
              subjectId: `reread:${subject.subjectId}`,
            })),
          ]);
          extraction.excludedEvidenceIds = [
            ...new Set([...extraction.excludedEvidenceIds, ...reread.excludedEvidenceIds]),
          ];
        }
      }
    }
    signal.throwIfAborted();
    const excluded = new Set([
      ...extraction.excludedEvidenceIds,
      ...sources
        .filter(
          (source) =>
            source.content.kind === 'unavailable' ||
            !extraction.includedEvidenceIds.includes(source.ref.evidenceId)
        )
        .map((source) => source.ref.evidenceId),
    ]);
    outcome = {
      ...outcome,
      includedEvidenceIds: extraction.includedEvidenceIds.filter((id) => !excluded.has(id)),
      excludedEvidenceIds: [...excluded],
    };
    if (excluded.size)
      outcome = {
        kind: 'admin_review',
        reason:
          budgetExcluded.size ||
          extraction.excludedEvidenceIds.some((id) =>
            eligible.some((source) => source.ref.evidenceId === id)
          )
            ? 'evidence_over_budget'
            : 'incomplete_coverage',
        candidates: outcome.kind === 'confirm' ? [outcome.candidate] : outcome.candidates,
        coverage: outcome.coverage,
        includedEvidenceIds: outcome.includedEvidenceIds,
        excludedEvidenceIds: outcome.excludedEvidenceIds,
      };
    if (
      outcome.kind === 'confirm' &&
      (analysis.handoff.state !== 'none' ||
        intake.status === ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION)
    )
      outcome = {
        kind: 'admin_review',
        reason: analysis.handoff.state === 'none' ? 'ambiguous' : analysis.handoff.reason,
        candidates: [outcome.candidate],
        coverage: outcome.coverage,
        includedEvidenceIds: outcome.includedEvidenceIds,
        excludedEvidenceIds: outcome.excludedEvidenceIds,
      };
    return outcome;
  }

  public scheduleAnalysisForThreadMessage(message: Message): void {
    void this.scheduleAnalysis(message).catch((error) => {
      console.warn('Failed to schedule report intake analysis:', error);
    });
  }

  public async runAnalysisForThreadMessage(message: Message): Promise<boolean> {
    return this.executeAnalysis(message);
  }
  private async executeAnalysis(message: Message, scheduledAt?: number): Promise<boolean> {
    if (!message.guild || !message.channel.isThread()) {
      return false;
    }

    const intake = await this.reportIntakeRepository.findOpenByThreadId(message.channel.id);
    if (!this.canAnalyzeIntake(intake)) {
      return false;
    }

    const guild = message.guild;
    const startedAt = Date.now();
    return withObservation(
      'report-intake',
      'chain',
      async (): Promise<boolean> => {
        const evidence = await withObservation('load-evidence', 'retriever', async () => {
          const loaded = await this.reportIntakeRepository.listEvidence(intake.id);
          recordObservation('retriever', { output: { evidence_count: loaded.length } });
          return loaded;
        });
        if (!this.hasNewEvidenceForAgent(intake, evidence.length)) {
          recordObservation('chain', { output: { actual_outcome: 'no_new_evidence' } });
          return false;
        }

        const serverConfig = await this.configService.getServerConfig(intake.server_id);
        const intakeSettings = getReportIntakeSettings(serverConfig.settings);
        const reportAiSettings = getReportAiSettings(serverConfig.settings);
        if (
          intakeSettings.stagedEnabled ||
          !intakeSettings.agentEnabled ||
          !reportAiSettings.enabled ||
          !this.gptService
        ) {
          recordObservation('chain', { output: { actual_outcome: 'analysis_disabled' } });
          return false;
        }

        const reporterText = reportAiSettings.analyzeText
          ? this.buildReporterText(evidence)
          : undefined;
        const attachments = reportAiSettings.analyzeImages
          ? selectEligibleReportImageAttachments(
              this.extractScreenshotAttachments(evidence),
              reportAiSettings
            )
          : [];
        if (!reporterText && attachments.length === 0) {
          recordObservation('chain', { output: { actual_outcome: 'no_eligible_content' } });
          return false;
        }

        const extraction = await this.gptService.extractReportIntakeEvidence({
          serverId: intake.server_id,
          reporterId: intake.reporter_id,
          reporterText,
          attachments,
        });
        const candidates = await withObservation('resolve-candidates', 'retriever', async () => {
          const resolved = await this.resolveCandidatesFromExtraction(guild, extraction);
          recordObservation('retriever', { output: { candidate_count: resolved.length } });
          return resolved;
        });

        return this.reportIntakeService.recordAgentAnalysis({
          intakeId: intake.id,
          message,
          candidates,
          extraction,
          evidenceCount: evidence.length,
          imageCount: attachments.length,
        });
      },
      {
        metadata: {
          intake_id: intake.id,
          guild_hash: hashIdentifier(intake.server_id),
          reporter_hash: hashIdentifier(intake.reporter_id),
          started_at: new Date(startedAt).toISOString(),
          ...(scheduledAt === undefined
            ? {}
            : {
                scheduled_at: new Date(scheduledAt).toISOString(),
                scheduling_delay_ms: startedAt - scheduledAt,
                scheduled_message_id: message.id,
              }),
        },
      },
      {
        sessionId: `${process.env.LANGFUSE_TRACING_ENVIRONMENT ?? 'development'}:intake:${intake.id}`,
      }
    );
  }

  private async scheduleAnalysis(message: Message): Promise<void> {
    if (!message.guild || !message.channel.isThread()) {
      return;
    }

    const intake = await this.reportIntakeRepository.findOpenByThreadId(message.channel.id);
    if (!this.canAnalyzeIntake(intake)) {
      return;
    }

    const serverConfig = await this.configService.getServerConfig(intake.server_id);
    const settings = getReportIntakeSettings(serverConfig.settings);
    if (settings.stagedEnabled || !settings.agentEnabled) {
      return;
    }

    const existingTimer = this.scheduledRuns.get(intake.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const lastAnalyzedAt = this.getLastAnalyzedAtMs(intake);
    const minIntervalDelay = lastAnalyzedAt
      ? Math.max(settings.minAnalysisIntervalMs - (Date.now() - lastAnalyzedAt), 0)
      : 0;
    const delayMs = Math.max(settings.debounceMs, minIntervalDelay);
    const scheduledAt = Date.now();
    const timer = setTimeout(() => {
      this.scheduledRuns.delete(intake.id);
      void this.executeAnalysis(message, scheduledAt).catch((error) => {
        console.warn(`Report intake agent analysis failed for intake ${intake.id}:`, error);
      });
    }, delayMs);
    this.scheduledRuns.set(intake.id, timer);
  }

  private canAnalyzeIntake(intake: ReportIntake | null): intake is ReportIntake {
    return Boolean(
      intake &&
      intake.status === ReportIntakeStatus.COLLECTING_EVIDENCE &&
      !projectReportIntakeState(intake).staged
    );
  }

  private hasNewEvidenceForAgent(intake: ReportIntake, evidenceCount: number): boolean {
    const metadata = toRecord(intake.metadata);
    const agentMetadata = toRecord(metadata.report_intake_agent);
    const analyzedEvidenceCount = agentMetadata.evidence_count;
    return typeof analyzedEvidenceCount !== 'number' || evidenceCount > analyzedEvidenceCount;
  }

  private getLastAnalyzedAtMs(intake: ReportIntake): number | null {
    const metadata = toRecord(intake.metadata);
    const agentMetadata = toRecord(metadata.report_intake_agent);
    const analyzedAt = agentMetadata.analyzed_at;
    if (typeof analyzedAt !== 'string') {
      return null;
    }

    const parsed = Date.parse(analyzedAt);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private buildReporterText(evidence: ReportIntakeEvidence[]): string | undefined {
    const text = evidence
      .filter((item) => item.kind === ReportIntakeEvidenceKind.REPORTER_TEXT && item.content)
      .map((item) => item.content?.trim())
      .filter((item): item is string => Boolean(item))
      .join('\n\n')
      .slice(0, REPORT_INTAKE_AGENT_TEXT_MAX_LENGTH)
      .trim();

    return text || undefined;
  }

  private extractScreenshotAttachments(
    evidence: ReportIntakeEvidence[]
  ): ReportAttachmentMetadata[] {
    return evidence
      .filter((item) => item.kind === ReportIntakeEvidenceKind.SCREENSHOT)
      .map((item) => this.extractScreenshotAttachment(item))
      .filter((attachment): attachment is ReportAttachmentMetadata => Boolean(attachment));
  }

  private extractScreenshotAttachment(
    evidence: ReportIntakeEvidence
  ): ReportAttachmentMetadata | null {
    const metadata = toRecord(evidence.metadata);
    const attachment: ReportAttachmentMetadata = {
      id: readString(metadata.id) ?? evidence.attachment_id ?? undefined,
      name: readString(metadata.name),
      url: readString(metadata.url),
      proxyUrl: readString(metadata.proxyUrl),
      contentType: readString(metadata.contentType),
      size: readNumber(metadata.size),
    };

    return attachment.url ? attachment : null;
  }

  private async resolveCandidatesFromExtraction(
    guild: Guild,
    extraction: ReportIntakeEvidenceExtraction
  ): Promise<ReportCandidate[]> {
    const candidates = new Map<string, ReportCandidate>();
    const signalContent = [
      ...extraction.visibleUserIds.map((userId) => `User ID: ${userId}`),
      ...extraction.visibleMessageLinks,
    ].join('\n');
    const signals = this.candidateService.extractCandidateSignals(signalContent);
    const platformCandidates = await this.candidateService.resolveCandidatesFromSignals(
      guild,
      signals,
      'intake evidence'
    );
    for (const candidate of platformCandidates) {
      candidates.set(candidate.discordUserId, candidate);
    }

    for (const name of uniqueStrings([
      ...extraction.visibleNames,
      ...extraction.visibleUsernames,
    ])) {
      const nameCandidates = await this.candidateService.searchMembersByName(
        guild,
        name,
        REPORT_INTAKE_AGENT_NAME_SEARCH_LIMIT
      );
      for (const candidate of nameCandidates) {
        candidates.set(candidate.discordUserId, {
          ...candidate,
          matchReasons: [
            ...new Set([...candidate.matchReasons, 'reported image display-name match']),
          ],
          ambiguityNotes: [
            ...new Set([
              ...candidate.ambiguityNotes,
              'Name/display-name came from untrusted report intake evidence.',
            ]),
          ],
          confirmationRequired: true,
        });
      }
    }

    return [...candidates.values()];
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
