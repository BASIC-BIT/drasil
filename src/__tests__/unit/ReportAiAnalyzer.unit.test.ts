import { ReportAiAnalyzer } from '../../services/ReportAiAnalyzer';
import type { JevService } from '../../services/JevService';
import type { IGPTService } from '../../services/GPTService';
import type { IServerRepository } from '../../repositories/ServerRepository';

it('sends report text to both checks and routes a Jev-only flag through report action settings', async () => {
  const serverRepository = {
    findByGuildId: jest.fn().mockResolvedValue({
      settings: { report_ai_max_action: 'open_case', report_ai_open_case_threshold: 0.5 },
    }),
  } as unknown as IServerRepository;
  const gptService = {
    analyzeReportEvidence: jest.fn().mockResolvedValue({
      result: 'low_risk',
      confidence: 0.99,
      summary: 'No abuse found.',
      reasonCodes: [],
      evidenceCategories: [],
      concerns: [],
      recommendedAction: 'none',
      analyzedImageCount: 0,
      model: 'gpt-test',
      promptVersion: 'report-test',
      isFallback: false,
    }),
  } as unknown as IGPTService;
  const jevService = {
    analyzeReportText: jest.fn().mockResolvedValue({
      result: 'SUSPICIOUS',
      suspiciousProbability: 0.96,
      reasonCodes: ['scam_link'],
      model: 'jev-test',
    }),
  } as unknown as JevService;

  const result = await new ReportAiAnalyzer(
    serverRepository,
    gptService,
    jevService
  ).analyzeIfEnabled({
    serverId: 'server',
    targetUserId: 'target',
    reporterId: 'reporter',
    reason: 'Please check this message',
    reportedMessageContent: 'Claim a prize at example.test',
  });

  expect(jevService.analyzeReportText).toHaveBeenCalledWith(
    'Please check this message',
    'Claim a prize at example.test'
  );
  expect(result).toMatchObject({
    gptResult: 'low_risk',
    gptSummary: 'No abuse found.',
    result: 'likely_abusive',
    confidence: 0.96,
    recommendedAction: 'open_case',
    jevAnalysis: { result: 'SUSPICIOUS', reasonCodes: ['scam_link'] },
  });

  const allegationOnly = await new ReportAiAnalyzer(
    serverRepository,
    gptService,
    jevService
  ).analyzeIfEnabled({
    serverId: 'server',
    targetUserId: 'target',
    reporterId: 'reporter',
    reason: 'They sent a phishing link',
  });
  expect(allegationOnly).toMatchObject({
    result: 'needs_review',
    recommendedAction: 'manual_review',
    jevAnalysis: { result: 'SUSPICIOUS' },
  });

  jest.mocked(gptService.analyzeReportEvidence).mockResolvedValueOnce({
    result: 'needs_review',
    confidence: 0.42,
    summary: 'Review the allegation.',
    reasonCodes: [],
    evidenceCategories: [],
    concerns: [],
    recommendedAction: 'manual_review',
    analyzedImageCount: 0,
    model: 'gpt-test',
    promptVersion: 'report-test',
    isFallback: false,
  });
  const existingReview = await new ReportAiAnalyzer(
    serverRepository,
    gptService,
    jevService
  ).analyzeIfEnabled({
    serverId: 'server',
    targetUserId: 'target',
    reporterId: 'reporter',
    reason: 'They sent a phishing link',
  });
  expect(existingReview).toMatchObject({
    result: 'needs_review',
    confidence: 0.42,
    recommendedAction: 'manual_review',
  });

  jest.mocked(serverRepository.findByGuildId).mockResolvedValueOnce({
    settings: { report_ai_max_action: 'hints' },
  } as any);
  const capped = await new ReportAiAnalyzer(
    serverRepository,
    gptService,
    jevService
  ).analyzeIfEnabled({
    serverId: 'server',
    targetUserId: 'target',
    reporterId: 'reporter',
    reportedMessageContent: 'Claim a prize at example.test',
  });
  expect(capped).toMatchObject({ result: 'likely_abusive', recommendedAction: 'manual_review' });
});
