import { Guild, Message } from 'discord.js';
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
import type { IGPTService, ReportIntakeEvidenceExtraction } from './GPTService';
import { IReportCandidateService, ReportCandidate } from './ReportCandidateService';
import { IReportIntakeService } from './ReportIntakeService';

const REPORT_INTAKE_AGENT_TEXT_MAX_LENGTH = 2000;
const REPORT_INTAKE_AGENT_NAME_SEARCH_LIMIT = 5;

export interface IReportIntakeAgentService {
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
    @inject(TYPES.GPTService) @optional() private gptService?: IGPTService
  ) {}

  public scheduleAnalysisForThreadMessage(message: Message): void {
    void this.scheduleAnalysis(message).catch((error) => {
      console.warn('Failed to schedule report intake analysis:', error);
    });
  }

  public async runAnalysisForThreadMessage(message: Message): Promise<boolean> {
    if (!message.guild || !message.channel.isThread()) {
      return false;
    }

    const intake = await this.reportIntakeRepository.findOpenByThreadId(message.channel.id);
    if (!this.canAnalyzeIntake(intake)) {
      return false;
    }

    const evidence = await this.reportIntakeRepository.listEvidence(intake.id);
    if (!this.hasNewEvidenceForAgent(intake, evidence.length)) {
      return false;
    }

    const serverConfig = await this.configService.getServerConfig(intake.server_id);
    const intakeSettings = getReportIntakeSettings(serverConfig.settings);
    const reportAiSettings = getReportAiSettings(serverConfig.settings);
    if (!intakeSettings.agentEnabled || !reportAiSettings.enabled || !this.gptService) {
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
      return false;
    }

    const extraction = await this.gptService.extractReportIntakeEvidence({
      serverId: intake.server_id,
      reporterId: intake.reporter_id,
      reporterText,
      attachments,
    });
    const candidates = await this.resolveCandidatesFromExtraction(message.guild, extraction);

    return this.reportIntakeService.recordAgentAnalysis({
      intakeId: intake.id,
      message,
      candidates,
      extraction,
      evidenceCount: evidence.length,
      imageCount: attachments.length,
    });
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
    if (!settings.agentEnabled) {
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
    const timer = setTimeout(() => {
      this.scheduledRuns.delete(intake.id);
      void this.runAnalysisForThreadMessage(message).catch((error) => {
        console.warn(`Report intake agent analysis failed for intake ${intake.id}:`, error);
      });
    }, delayMs);
    this.scheduledRuns.set(intake.id, timer);
  }

  private canAnalyzeIntake(intake: ReportIntake | null): intake is ReportIntake {
    return Boolean(intake && intake.status === ReportIntakeStatus.COLLECTING_EVIDENCE);
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
      'AI-extracted intake evidence'
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
          matchReasons: [...new Set([...candidate.matchReasons, 'AI-extracted display name'])],
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
