import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmationView } from './[confirmationId]/ConfirmationView';
describe('saved approval summary', () => {
  it('renders complete hostile text as data and requires an explicit action', () => {
    const approve = vi.fn(async () => ({ state: 'queued' as const }));
    const cancel = vi.fn(async () => ({ state: 'denied' as const, code: 'cancelled' }));
    const summary = '<script>alert(1)</script> @everyone ' + '😀'.repeat(3000);
    const html = renderToStaticMarkup(
      React.createElement(ConfirmationView, {
        summary,
        guildId: 'guild-a',
        clientId: 'original-client',
        connectionId: 'original-connection',
        confirmationId: 'a'.repeat(43),
        state: 'pending',
        approve,
        cancel,
      })
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('😀'.repeat(3000));
    expect(html).toContain('Approve');
    expect(approve).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(html).not.toContain('name="actor"');
    expect(html).not.toContain('name="connectionId"');
  });
});

it('distinguishes identical saved actions for two guilds and originating connections', () => {
  const render = (guildId: string) =>
    renderToStaticMarkup(
      React.createElement(ConfirmationView, {
        confirmationId: 'a'.repeat(43),
        summary: 'Ban the same target',
        state: 'pending',
        guildId,
        clientId: 'client <script>@everyone😀',
        connectionId: 'connection-id',
        approve: vi.fn(),
        cancel: vi.fn(),
      })
    );
  expect(render('guild-a')).toContain('guild-a');
  expect(render('guild-b')).toContain('guild-b');
  expect(render('guild-a')).toContain('client &lt;script&gt;@everyone😀');
  expect(render('guild-a')).toContain('connection-id');
});
it.each([
  [{ state: 'completed' as const, outcome: { status: 'busy' } }, 'Busy: no action was taken'],
  [
    { state: 'partial' as const, outcome: { status: 'closed', queueCleanupStatus: 'failed' } },
    'Queue cleanup failed',
  ],
  [
    {
      state: 'partial' as const,
      outcome: {
        items: [
          { itemId: '<script>😀', state: 'completed' as const, status: 'already_handled' },
          { itemId: 'second', state: 'uncertain' as const },
        ],
      },
    },
    'Item second: uncertain',
  ],
])('shows the actual owned result %j', (receipt, expected) => {
  const html = renderToStaticMarkup(
    React.createElement(ConfirmationView, {
      confirmationId: 'a'.repeat(43),
      summary: 'Saved action',
      state: 'consumed',
      guildId: 'guild-a',
      clientId: 'client',
      connectionId: 'connection',
      receipt,
      approve: vi.fn(),
      cancel: vi.fn(),
    })
  );
  expect(html).toContain(expected);
  expect(html).not.toContain('<script>');
});
