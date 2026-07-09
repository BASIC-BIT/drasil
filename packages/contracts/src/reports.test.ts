import { describe, expect, it } from 'vitest';
import { reportDetailSchema, sortReportQueueItems, type ReportQueueItem } from './reports';

const baseReport: ReportQueueItem = {
  id: 'report-1',
  guildId: 'guild-1',
  reporterId: 'reporter-1',
  targetUserId: 'user-1',
  status: 'submitted',
  summary: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  stale: false,
  staleHours: 1,
  evidenceCount: 0,
  reportThreadUrl: null,
  latestDetectionId: null,
  latestCaseId: null,
  allowedActions: ['mark_actioned', 'dismiss_no_action', 'mark_false_positive'],
};

describe('report contracts', () => {
  it('sorts stale reports before fresh reports, then oldest movement first', () => {
    const reports = sortReportQueueItems([
      { ...baseReport, id: 'fresh-old', updatedAt: '2026-06-01T00:00:00.000Z' },
      { ...baseReport, id: 'stale-new', stale: true, updatedAt: '2026-06-03T00:00:00.000Z' },
      { ...baseReport, id: 'stale-old', stale: true, updatedAt: '2026-06-02T00:00:00.000Z' },
    ]);

    expect(reports.map((report) => report.id)).toEqual(['stale-old', 'stale-new', 'fresh-old']);
  });

  it('parses report detail evidence and attachment metadata', () => {
    expect(
      reportDetailSchema.parse({
        ...baseReport,
        closedAt: null,
        evidence: [
          {
            id: 'evidence-1',
            kind: 'screenshot',
            content: null,
            createdAt: '2026-06-01T00:01:00.000Z',
            sourceMessageUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
            attachment: {
              id: 'attachment-1',
              name: 'proof.png',
              url: 'https://cdn.discordapp.com/attachments/proof.png',
              contentType: 'image/png',
              size: 12345,
            },
          },
        ],
      })
    ).toMatchObject({
      id: 'report-1',
      evidence: [expect.objectContaining({ kind: 'screenshot' })],
    });
  });
});
