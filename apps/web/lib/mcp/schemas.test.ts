import { expect, it } from 'vitest';
import { z } from 'zod';
import { toMcpSchema } from './schemas';
import { mcpWorkflowManifest } from './manifest';

it('preserves canonical defaults and rejects authority injection', async () => {
  const canonicalSchema = z
    .object({
      userId: z.string().min(1),
      mode: z.enum(['first', 'second']).default('first'),
      reason: z.string().nullable(),
      optional: z.string().optional(),
    })
    .strict();
  const bridge = toMcpSchema(canonicalSchema);
  const inputWithOmittedDefaults = { userId: '999999999999999999', reason: null };
  const validInput = inputWithOmittedDefaults;
  const result = await bridge['~standard'].validate(inputWithOmittedDefaults);
  expect(result).toEqual({ value: canonicalSchema.parse(inputWithOmittedDefaults) });
  expect(
    await bridge['~standard'].validate({ ...validInput, actor: { userId: 'forged' } })
  ).toHaveProperty('issues');
  const publicTools = mcpWorkflowManifest.map((entry) => entry.toolName);
  const settingsFieldCoverage = new Set(
    mcpWorkflowManifest.flatMap((entry) => entry.settingsFields)
  );
  expect(publicTools).not.toContain('drasil_apply_captcha_pass');
  expect(settingsFieldCoverage.size).toBe(74);
  expect(settingsFieldCoverage).toContain('captchaMethod');
  expect(await bridge['~standard'].validate({ ...validInput, userId: 999 })).toHaveProperty(
    'issues'
  );
  expect(bridge['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toMatchObject({
    type: 'object',
    additionalProperties: false,
    required: ['userId', 'reason'],
    properties: { userId: { type: 'string' }, mode: { default: 'first' } },
  });
});

it('registers canonical schemas with the installed SDK and validates real client calls', async () => {
  const { McpServer } = await import('@drasil/mcp-runtime/server');
  const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client');
  const server = new McpServer({ name: 'drasil-schema-test', version: '1' });
  const client = new Client({ name: 'drasil-test-client', version: '1' });
  const canonical = z
    .object({
      userId: z.string(),
      reason: z.string().nullable(),
      mode: z.string().default('canonical'),
    })
    .strict();
  const received: z.infer<typeof canonical>[] = [];
  server.registerTool('canonical', { inputSchema: toMcpSchema(canonical) }, async (input) => {
    received.push(input);
    return { content: [{ type: 'text', text: JSON.stringify(input) }] };
  });
  for (const definition of mcpWorkflowManifest)
    server.registerTool(definition.toolName, { inputSchema: definition.schema }, async () => ({
      content: [],
    }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(mcpWorkflowManifest.length + 1);
    expect(listed.tools[0].inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['userId', 'reason'],
    });
    const result = await client.callTool({
      name: 'canonical',
      arguments: { userId: '999999999999999999', reason: null },
    });
    expect(result.isError).not.toBe(true);
    expect(received).toEqual([{ userId: '999999999999999999', reason: null, mode: 'canonical' }]);
    const rejected = await client.callTool({
      name: 'canonical',
      arguments: { userId: '123', reason: null, actor: { userId: 'forged' } },
    });
    expect(rejected.isError).toBe(true);
    expect(received).toHaveLength(1);
  } finally {
    await client.close();
    await server.close();
  }
});

it('imports the pinned transport and issuer APIs from the Zod 4 package boundary', async () => {
  const [handler, auth, oauth, cimd, plugins] = await Promise.all([
    import('@drasil/mcp-runtime/handler'),
    import('@drasil/mcp-runtime/auth'),
    import('@drasil/mcp-runtime/oauth-provider'),
    import('@drasil/mcp-runtime/cimd'),
    import('@drasil/mcp-runtime/plugins'),
  ]);
  expect(handler.createMcpHandler).toBeTypeOf('function');
  expect(auth.betterAuth).toBeTypeOf('function');
  expect(oauth.oauthProvider).toBeTypeOf('function');
  expect(cimd.cimd).toBeTypeOf('function');
  expect(plugins.jwt).toBeTypeOf('function');
});

it('exposes the maintained Node CIMD fetcher and Next.js issuer adapter', async () => {
  const [cimdNode, next] = await Promise.all([
    import('@drasil/mcp-runtime/cimd-node'),
    import('@drasil/mcp-runtime/auth-next'),
  ]);
  expect(cimdNode.fetchClientMetadataResource).toBeTypeOf('function');
  expect(next.toNextJsHandler).toBeTypeOf('function');
});

it('advertises the input of preprocessors without narrowing it to the transformed enum', async () => {
  const canonical = z
    .object({
      mode: z.preprocess(
        (value) => (value === 'previous' ? 'current' : value),
        z.enum(['current'])
      ),
    })
    .strict();
  const bridge = toMcpSchema(canonical);
  expect(await bridge['~standard'].validate({ mode: 'previous' })).toEqual({
    value: canonical.parse({ mode: 'previous' }),
  });
  expect(bridge['~standard'].jsonSchema.input({ target: 'draft-07' })).toMatchObject({
    properties: { mode: {} },
  });
  const input = bridge['~standard'].jsonSchema.input({ target: 'draft-07' });
  const mode = z
    .object({ properties: z.object({ mode: z.record(z.string(), z.unknown()) }) })
    .parse(input).properties.mode;
  expect(mode).not.toHaveProperty('enum');
});

it('exposes maintained OAuth verification helpers for the issuer and resource adapters', async () => {
  const [oauth, oauth2] = await Promise.all([
    import('@drasil/mcp-runtime/oauth-provider'),
    import('@drasil/mcp-runtime/oauth2'),
  ]);
  expect(oauth.getOAuthProviderState).toBeTypeOf('function');
  expect(oauth.verifyOAuthQueryParams).toBeTypeOf('function');
  expect(oauth2.requestToResourceInput).toBeTypeOf('function');
  expect(oauth2.verifyAccessTokenRequest).toBeTypeOf('function');
});
