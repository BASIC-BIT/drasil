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
