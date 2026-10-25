/** One identity for discovery and the maintained SDK's native result metadata stamp. */
export const MCP_SERVER_INFO = { name: 'Drasil', version: '1' } as const;
export const MCP_SERVER_RESULT_META = { 'io.modelcontextprotocol/serverInfo': MCP_SERVER_INFO };
// Appending this one property adds its JSON object minus one brace (including the comma).
export const MCP_RESULT_METADATA_BYTES =
  Buffer.byteLength(JSON.stringify({ _meta: MCP_SERVER_RESULT_META }), 'utf8') - 1;
