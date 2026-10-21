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
