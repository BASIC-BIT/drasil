import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  workflowDefinitions,
  settingsSectionSchemas,
  setupChangesSchema,
} from '@drasil/application';
import { mcpWorkflowManifest, bindMcpTool } from './manifest';

it('binds every workflow to an object-root tool with complete coverage metadata', () => {
  expect(new Set(mcpWorkflowManifest.map((entry) => entry.toolName)).size).toBe(
    mcpWorkflowManifest.length
  );
  expect(mcpWorkflowManifest.map((entry) => entry.toolName)).toContain(
    'drasil_acknowledge_attention'
  );
  expect(mcpWorkflowManifest.map((entry) => entry.id)).toEqual(
    workflowDefinitions.map((entry) => entry.id)
  );
  for (const entry of mcpWorkflowManifest) {
    expect(entry.schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(entry).toHaveProperty('authorityPolicy');
    expect(entry).toHaveProperty('confirmationRule');
    expect(entry).toHaveProperty('resultContract');
  }
  const actual = new Set(mcpWorkflowManifest.flatMap((entry) => entry.settingsFields));
  const expected = new Set(Object.keys(setupChangesSchema.shape));
  expect(actual).toEqual(expected);
  expect(actual.size).toBe(73);
  expect(Object.keys(settingsSectionSchemas)).toHaveLength(11);
});

it('requires a real handler at composition and passes the trusted principal', async () => {
  const definition = mcpWorkflowManifest[0];
  const principal = {
    userId: 'u',
    clientId: 'c',
    connectionId: 'connection',
    grantVersion: 1,
    scopes: ['drasil:moderate'] as const,
  };
  const tool = bindMcpTool(definition, async (actor, input) => ({ actor, input }));
  expect(await tool.handler(principal, { guildId: 'g' })).toEqual({
    actor: principal,
    input: { guildId: 'g' },
  });
});

describe('strict public authority boundaries', () => {
  it.each([
    'actor',
    'source',
    'systemPurpose',
    'grantVersion',
    'confirmationMethod',
    'command',
    'intent',
    'promptToken',
    'interactionContext',
    'jobId',
    'attemptToken',
    'fencingToken',
  ])('rejects client authority field %s', async (key) => {
    const entry = mcpWorkflowManifest.find((entry) => entry.id === 'ban_user');
    expect(
      await entry?.schema['~standard'].validate({
        guildId: '123',
        idempotencyKey: 'retry',
        targetUserId: '456',
        reason: null,
        [key]: 'forged',
      })
    ).toHaveProperty('issues');
  });
});

it('advertises every canonical section field independently of the 73 mutable setup names', () => {
  const entry = mcpWorkflowManifest.find((entry) => entry.commandKind === 'update_settings');
  const advertised = entry?.schema['~standard'].jsonSchema.input({ target: 'draft-07' });
  const branches = z
    .object({ properties: z.object({ patch: z.object({ anyOf: z.array(z.unknown()) }) }) })
    .parse(advertised).properties.patch.anyOf;
  for (const [section, schema] of Object.entries(settingsSectionSchemas)) {
    expect(branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'object',
          additionalProperties: false,
          properties: expect.objectContaining({
            section: expect.objectContaining({ const: section }),
            changes: expect.objectContaining({
              type: 'object',
              additionalProperties: false,
              properties: expect.objectContaining(
                Object.fromEntries(
                  Object.keys(schema.shape).map((field) => [field, expect.anything()])
                )
              ),
            }),
          }),
        }),
      ])
    );
  }
  // Stored section patches also accept two fields absent from guildSetupUpdateSchema.
  expect(
    new Set(Object.values(settingsSectionSchemas).flatMap((section) => Object.keys(section.shape)))
      .size
  ).toBe(75);
});

it('rejects nested authority, raw prompt tokens and runtime-created cleanup jobs', async () => {
  const fixtures = [
    { id: 'update_setup', args: { changes: { updatedBy: 'forged' } } },
    { id: 'update_settings', args: { patch: { section: 'report', changes: { actor: 'forged' } } } },
    {
      id: 'submit_message_report',
      args: {
        targetUserId: '123',
        messageId: '456',
        channelId: '789',
        reason: null,
        interactionContext: 1,
      },
    },
    {
      id: 'reject_intake_candidates',
      args: { intakeId: 'i', intakePromptReference: 'ref', promptToken: 'forged' },
    },
    {
      id: 'preview_case_message_deletion',
      args: {
        caseId: 'c',
        targetUserId: '123',
        mode: 'delete_only',
        scope: 'source_message',
        reason: '',
        detectionEventId: null,
        cleanupReference: 'ref',
        jobId: 'forged',
      },
    },
  ];
  for (const fixture of fixtures) {
    const tool = mcpWorkflowManifest.find((entry) => entry.id === fixture.id);
    expect(
      await tool?.schema['~standard'].validate({
        guildId: '123',
        idempotencyKey: 'retry',
        ...fixture.args,
      })
    ).toHaveProperty('issues');
  }
});

it('requires bounded idempotency keys and string guild IDs', async () => {
  const tool = mcpWorkflowManifest.find((entry) => entry.id === 'ban_user');
  const valid = { guildId: '123', targetUserId: '456', reason: null, idempotencyKey: 'retry' };
  for (const key of [undefined, '', 'x'.repeat(129)])
    expect(
      await tool?.schema['~standard'].validate({ ...valid, idempotencyKey: key })
    ).toHaveProperty('issues');
  expect(await tool?.schema['~standard'].validate({ ...valid, guildId: 123 })).toHaveProperty(
    'issues'
  );
});
