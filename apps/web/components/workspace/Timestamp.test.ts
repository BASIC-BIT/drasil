import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Timestamp } from './Timestamp';
it('renders an unknown date without a fabricated datetime', () => {
  const markup = renderToStaticMarkup(
    createElement(Timestamp, { value: null, prefix: 'Reported' })
  );
  expect(markup).toContain('Reported');
  expect(markup).toContain('Unknown date');
  expect(markup).not.toContain('datetime');
  expect(markup).not.toContain('<time');
});
it('keeps a known date in the machine-readable datetime', () => {
  expect(
    renderToStaticMarkup(createElement(Timestamp, { value: '2026-10-21T14:40:00.000Z' }))
  ).toContain('dateTime="2026-10-21T14:40:00.000Z"');
});
