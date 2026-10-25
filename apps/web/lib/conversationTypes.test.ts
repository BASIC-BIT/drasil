import { expect, it } from 'vitest';
import { caseConversationSources, reportConversationSources } from './conversationTypes';
import { fixtureCaseDetails } from './caseFixtures';
import { fixtureReportDetail } from './reportFixtures';
const guildId = '100000000000000001',
  url = `https://discord.com/channels/${guildId}/100000000000000002/100000000000000003`;
it('emits stored source surface and actual evidence keys, never member previews', () => {
  const detail = {
    ...fixtureCaseDetails[0],
    guildId,
    surfaces: [{ kind: 'source_message' as const, label: 'Source', url }],
    evidenceItems: fixtureCaseDetails[0].evidenceItems.map((item) => ({ ...item, url })),
  };
  expect(caseConversationSources(detail).map((source) => source.sourceKey)).toEqual([
    'source_message',
    ...detail.evidenceItems.map((item) => `evidence:${item.id}`),
  ]);
});
it('emits report evidence IDs and retains the independent report identity', () => {
  const report = { ...fixtureReportDetail('report-1')!, guildId };
  report.evidence = report.evidence.map((item) => ({ ...item, sourceMessageUrl: url }));
  expect(
    reportConversationSources(report).map((source) => [
      source.recordKind,
      source.recordId,
      source.sourceKey,
    ])
  ).toEqual(report.evidence.map((item) => ['report', 'report-1', `evidence:${item.id}`]));
});
