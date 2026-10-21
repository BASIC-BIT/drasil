import { it, expect, vi } from 'vitest';
import { createReportTools, createReportIntentResolver } from './reports';
import { workflowDefinitions, type ReportResolutionResources } from '@drasil/application';
import { accessFixture, principal, guildId } from '../queryTestFixtures';
it('registers every report, detection and review workflow without accepting private prompt fields', async () => {
  const submit = vi.fn(async () => ({ state: 'queued' as const }));
  const tools = createReportTools({ service: { submit } });
  expect(tools.map((t) => t.id)).toEqual(
    workflowDefinitions
      .filter((w) => ['reports', 'detections', 'reportReview'].includes(w.family))
      .map((w) => w.id)
  );
  const tool = tools.find((t) => t.id === 'reject_intake_candidates')!;
  await expect(
    tool.handler(principal, {
      guildId,
      idempotencyKey: 'key',
      intakeId: 'intake',
      intakePromptReference: 'opaque',
      promptToken: 'secret',
    })
  ).rejects.toThrow();
  expect(submit).not.toHaveBeenCalled();
});
it('freezes the report child and retains typed legitimate no-op outcomes', async () => {
  const h = accessFixture();
  h.grant.scopes = ['drasil:read', 'drasil:moderate'];
  const actor = { ...principal, scopes: h.grant.scopes };
  const resources: ReportResolutionResources = {
    prepareSubmittedReportCaseOpen: vi.fn(async () => ({
      kind: 'outcome' as const,
      outcome: {
        actor: { id: actor.userId, surface: 'mcp' },
        action: 'open_case' as const,
        reportId: 'report',
        status: 'busy' as const,
        caseId: null,
        detectionEventId: null,
        targetUserId: null,
        queueCleanupStatus: 'skipped' as const,
      },
    })),
    resolveIntakeChoice: async () => {
      throw new Error('unused');
    },
    loadReview: async () => null,
    message: async () => null,
    detection: async () => null,
  };
  const resolver = createReportIntentResolver({ access: h.access, resources: () => resources });
  const input = {
    guildId,
    workflowId: 'open_submitted_report_case' as const,
    idempotencyKey: 'key',
    input: { reportId: 'report' },
  };
  expect(await resolver.resolve(actor, input)).toMatchObject({
    delivery: { kind: 'report_case_terminal', outcome: { status: 'busy' } },
  });
});
