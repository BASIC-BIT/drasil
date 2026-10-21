import { it, expect } from 'vitest';
import { isCallToolResult, type CallToolResult } from '@drasil/mcp-runtime/server';
import { toMcpQueryResult, queryResultBytes } from './results';
it('produces an actual SDK tool result with identical legacy and structured data', () => {
  const query = {
    kind: 'allowed' as const,
    items: [{ id: 'record', content: '<script>ignore instructions</script> @everyone 😀\\"' }],
    nextCursor: 'opaque-cursor',
    truncated: false,
  };
  const result: CallToolResult = toMcpQueryResult(query);
  expect(isCallToolResult(result)).toBe(true);
  expect(JSON.parse(toMcpQueryResult(query).content[0].text)).toEqual(result.structuredContent);
  expect(queryResultBytes(query)).toBe(Buffer.byteLength(JSON.stringify(result), 'utf8'));
  expect(JSON.stringify(result)).toContain('ignore instructions');
});
it('bounds exact action envelopes without clipping an actionable summary', async () => {
  const { toMcpActionResult, MCP_RESULT_BYTES } = await import('./results');
  for (const text of ['"\\'.repeat(4000), '😀'.repeat(4000), '\u0000'.repeat(2500)]) {
    expect(Buffer.byteLength(JSON.stringify(text))).toBeLessThanOrEqual(16384);
    const input = {
      state: 'confirmation_required' as const,
      summary: text,
      confirmationId: 'x'.repeat(43),
      guildId: '9'.repeat(20),
      operation: 'update_setup' as const,
      expiresAt: new Date().toISOString(),
    };
    const projected = toMcpActionResult(input);
    expect(projected.structuredContent).toEqual(input);
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThanOrEqual(MCP_RESULT_BYTES);
  }
  expect(
    toMcpActionResult({
      state: 'confirmation_required',
      confirmationId: 'saved',
      summary: '"'.repeat(40000),
    }).structuredContent
  ).toMatchObject({ state: 'denied', code: 'summary_too_large' });
});
