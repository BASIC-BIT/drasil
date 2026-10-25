import { describe, expect, it } from 'vitest';
import { fixtureCaseDetails } from './caseFixtures';
import { fixtureReportDetails } from './reportFixtures';
import { groupEvidenceSources } from './evidenceSources';

const base = fixtureCaseDetails[0];
const url = 'https://discord.com/channels/guild-1/channel-1/message-1';

describe('groupEvidenceSources', () => {
  it('keeps both saved quotations when their message is the same', () => {
    const detail = {
      ...base,
      evidenceItems: [
        {
          id: 'a',
          kind: 'reported_text',
          content: 'Original quotation\nwith a second line',
          createdAt: null,
          url,
        },
        {
          id: 'b',
          kind: 'reported_text',
          content: 'A different saved quotation',
          createdAt: null,
          url,
        },
      ],
      messageContext: [],
    };
    const groups = groupEvidenceSources({ detail, report: null });
    expect(groups).toHaveLength(1);
    expect(groups[0].records.map((record) => record.content)).toEqual([
      'Original quotation\nwith a second line',
      'A different saved quotation',
    ]);
    expect(groups[0].records.map((record) => record.createdAt)).toEqual([null, null]);
    expect(groups[0].channelId).toBe('channel-1');
    expect(groups[0].messageId).toBe('message-1');
  });

  it('groups a source preview with its matching saved message URL without replacing either', () => {
    const detail = {
      ...base,
      evidenceItems: [
        { id: 'a', kind: 'reported_text', content: 'Saved quotation', createdAt: null, url },
      ],
      messageContext: [
        {
          id: 'preview',
          messageId: 'message-1',
          channelId: 'channel-1',
          contentPreview: 'Expiring preview',
          createdAt: base.createdAt,
          url: null,
          isSource: true,
        },
      ],
    };
    const groups = groupEvidenceSources({ detail, report: null });
    expect(groups).toHaveLength(1);
    expect(groups[0].records.map((record) => record.content)).toEqual([
      'Expiring preview',
      'Saved quotation',
    ]);
    expect(groups[0].url).toBe(url);
  });

  it('keeps unrelated messages in different channels separate, even with the same message ID', () => {
    const detail = {
      ...base,
      evidenceItems: [],
      messageContext: ['channel-a', 'channel-b'].map((channelId) => ({
        id: channelId,
        messageId: 'same-id',
        channelId,
        contentPreview: channelId,
        createdAt: base.createdAt,
        url: null,
        isSource: true,
      })),
    };
    expect(groupEvidenceSources({ detail, report: null })).toHaveLength(2);
  });

  it('groups recent member previews by channel without calling them conversation or merging them into saved sources', () => {
    const detail = {
      ...base,
      evidenceItems: [],
      messageContext: ['channel-a', 'channel-b', 'channel-a'].map((channelId, index) => ({
        id: String(index),
        messageId: String(index),
        channelId,
        contentPreview: `Member preview ${index}`,
        createdAt: base.createdAt,
        url: null,
        isSource: false,
      })),
    };
    const groups = groupEvidenceSources({ detail, report: null });
    expect(groups.map((group) => group.kind)).toEqual([
      'recent_member_previews',
      'recent_member_previews',
    ]);
    expect(groups.map((group) => group.channelId)).toEqual(['channel-a', 'channel-b']);
    expect(groups.map((group) => group.records.length)).toEqual([2, 1]);
  });

  it('keeps unlinked records distinct and preserves report attachments and original record IDs', () => {
    const report = fixtureReportDetails[0];
    const evidence = {
      id: 'attachment',
      kind: 'screenshot' as const,
      content: 'Recorded caption',
      createdAt: null,
      sourceMessageUrl: null,
      attachment: {
        id: 'file',
        name: 'proof.png',
        url: 'https://cdn.example/proof.png',
        contentType: 'image/png',
        size: 42,
      },
    };
    const groups = groupEvidenceSources({
      detail: { ...base, evidenceItems: [], messageContext: [] },
      report: { ...report, evidence: [evidence, { ...evidence, id: 'other' }] },
    });
    expect(groups).toHaveLength(2);
    expect(groups[0].records[0]).toMatchObject({
      sourceId: 'attachment',
      origin: 'report_evidence',
      content: evidence.content,
      attachment: evidence.attachment,
      createdAt: null,
    });
  });
});
