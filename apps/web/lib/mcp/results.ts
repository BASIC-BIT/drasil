import type { QueryResult } from './queries';

export const MCP_RESULT_BYTES = 65_536;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };
/** Task 13 must return this envelope unchanged: clipping after pagination would lose rows.
 * Legacy clients receive the same data as structured clients, including continuation cursors.
 */
export function toMcpQueryResult(result: QueryResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result,
    isError: result.kind === 'denied',
  };
}
export function queryResultBytes(result: QueryResult): number {
  return Buffer.byteLength(JSON.stringify(toMcpQueryResult(result)), 'utf8');
}
/** Inputs here have already been allowlisted by their resource projection. */
export function boundValue(
  value: JsonValue,
  textLimit = 4000,
  arrayLimit = 100,
  attachmentLimit = 10
): { value: JsonValue; truncated: boolean; attachmentCount: number } {
  let truncated = false;
  let attachmentCount = 0;
  function visit(value: JsonValue, key = ''): JsonValue {
    if (typeof value === 'string') {
      if (value.length > textLimit) truncated = true;
      return value.slice(0, textLimit);
    }
    if (Array.isArray(value)) {
      const limit =
        key === 'attachments'
          ? Math.min(attachmentLimit - attachmentCount, arrayLimit)
          : arrayLimit;
      if (key === 'attachments') attachmentCount += Math.min(value.length, limit);
      if (value.length > limit) truncated = true;
      return value.slice(0, limit).map((item) => visit(item));
    }
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, visit(item, key)])
      );
    }
    return value;
  }
  const bounded = visit(value);
  return { value: bounded, truncated, attachmentCount };
}
