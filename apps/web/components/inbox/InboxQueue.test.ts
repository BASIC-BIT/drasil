import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { fixtureModerationInboxItems } from '@/lib/inboxFixtures';
import { parseInboxLocation } from '@/lib/inboxLocation';
import { moderationInboxItemSchema } from '@drasil/contracts';
import { InboxQueue } from './InboxQueue';

const base = fixtureModerationInboxItems()[0];
const metadata = {
  subtype: null,
  caseId: null,
  reportId: null,
  detectionId: null,
  sourceThreadId: null,
  latestReplyMessageId: null,
  eventAt: null,
  pendingSince: null,
  thresholdDays: null,
  lastCheckedAt: null,
};
function render(overrides: object) {
  return renderToStaticMarkup(
    createElement(InboxQueue, {
      guildId: base.guildId,
      items: [moderationInboxItemSchema.parse({ ...base, ...overrides })],
      location: parseInboxLocation(new URLSearchParams()),
      onSelect() {},
    })
  );
}
it.each([
  ['support_reply', 'Support reply'],
  ['recovery_reply', 'Recovery reply'],
  ['quarantine_breach', 'Containment breach'],
])('preserves %s triage context', (subtype, label) => {
  const html = render({
    kind: 'support_attention',
    title: label,
    sourceMetadata: { ...metadata, subtype },
    summary: 'https://discord.com/channels/guild-1/prohibited-channel/message-1',
  });
  expect(html).toContain(label);
  expect(html).toContain('prohibited-channel');
  if (subtype === 'quarantine_breach') {
    expect(html).toContain('data-severity="danger"');
    expect(html).not.toContain('Recovery thread');
  }
});
it.each([
  ['support_attention', 'Reply sent'],
  ['report_attention', 'Reply sent'],
  ['observed_alert', 'Detected'],
  ['pending_screening', 'Pending since'],
])('uses labelled source age for %s independently of queue freshness', (kind, label) => {
  const html = render({
    kind,
    updatedAt: '2026-10-25T12:00:00Z',
    sourceMetadata: {
      ...metadata,
      eventAt: '2026-10-01T12:00:00Z',
      pendingSince: '2026-10-01T12:00:00Z',
    },
  });
  expect(html).toContain(`${label} `);
  expect(html).toContain('dateTime="2026-10-01T12:00:00Z"');
  expect(html).toContain('Queue updated ');
  expect(html).toContain('dateTime="2026-10-25T12:00:00Z"');
});
it('keeps a missing source date unknown rather than substituting the queue date', () => {
  const html = render({
    kind: 'observed_alert',
    sourceMetadata: metadata,
    updatedAt: '2026-10-25T12:00:00Z',
  });
  expect(html).toContain('Detected Unknown date');
  expect(html.match(/<time /g)).toHaveLength(1);
});
it('labels the supplied report creation date without inventing a submission timestamp', () => {
  const html = render({ kind: 'submitted_report', createdAt: '2026-10-01T12:00:00Z' });
  expect(html).toContain('Report created ');
  expect(html).toContain('dateTime="2026-10-01T12:00:00Z"');
});
