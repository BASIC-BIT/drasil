import {
  setupResourceFields,
  setupResourceReferences,
  validateSetupResourceReferences,
} from './resources';
import { fixtures } from './fieldFixtures.testData';
import {
  approvedResetDelivery,
  createSetupIntentResolver,
  setupChangeSummary,
  shippedResetChanges,
} from './resolution';
import {
  buildSetupSettingsPatch,
  settingsSectionSchemas,
  setupServerRecordSchema,
} from './settings';
import { operationCommandSchema } from '../operations/commands';
import { setupChangesSchema, setupCommandSchema } from './commands';
import { setupStoredChange } from './persistence';
import { confirmationRequirement } from '../delegation/confirmationPolicy';
import { workflowDefinitions } from '../delegation/commands';
import type { DelegatedPrincipal, IntentResolver } from '../delegation/types';
const state = setupServerRecordSchema.parse({
  guild_id: 'guild',
  case_role_id: null,
  admin_channel_id: null,
  verification_channel_id: null,
  admin_notification_role_id: null,
  heuristic_message_threshold: 9,
  heuristic_message_timeframe_seconds: 9,
  heuristic_suspicious_keywords: ['before'],
  created_at: null,
  updated_at: null,
  updated_by: null,
  settings: {},
  is_active: true,
});
const principal: DelegatedPrincipal = {
  userId: 'actor',
  clientId: 'client',
  connectionId: 'connection',
  grantVersion: 1,
  scopes: ['drasil:configure', 'drasil:moderate'],
};
function resolver(
  owner = true,
  provider = true,
  current = state,
  roles: { id: string; name: string }[] = [],
  channels: { id: string; name: string; type: number }[] = []
): IntentResolver {
  return createSetupIntentResolver({
    loadServer: async () => current,
    loadGuildResources: async () => ({ roles, channels }),
    authority: {
      loadFresh: async () => ({
        guildId: 'guild',
        userId: 'actor',
        present: true,
        owner,
        permissions: '8',
        roleIds: [],
      }),
    },
    provider: { isConfigured: () => provider },
    loadHeuristicDefaults: async (scope) => shippedResetChanges(scope),
  });
}
test('covers all 74 mapped inputs and all 76 keys in 11 strict sections', () => {
  expect(fixtures.fields).toHaveLength(74);
  expect(Object.keys(settingsSectionSchemas)).toEqual(Object.keys(fixtures.sections));
  expect(Object.values(fixtures.sections).flat()).toHaveLength(76);
  expect(Object.keys(setupChangesSchema.shape).sort()).toEqual(
    fixtures.fields.map((f) => f.input).sort()
  );
  for (const fixture of fixtures.fields) {
    const changes = setupChangesSchema.parse({ [fixture.input]: fixture.value });
    const change = setupStoredChange({
      columns: changes,
      settings: buildSetupSettingsPatch({ guildId: 'guild', ...changes }),
    });
    const key = fixture.location.replace('settings.', '');
    const value = fixture.location.startsWith('settings.')
      ? change.settings?.[key]
      : change.columns?.[key as keyof typeof change.columns];
    expect(value).toEqual(fixture.value);
    const before = {
      ...state,
      settings: {},
      ...(fixture.location.startsWith('settings.')
        ? {}
        : { [key]: fixture.value === null ? 'before' : state[key as keyof typeof state] }),
    };
    expect(setupChangeSummary(before, change)).toContain(`${key}:`);
  }
  for (const [section, keys] of Object.entries(fixtures.sections)) {
    const schema = settingsSectionSchemas[section as keyof typeof settingsSectionSchemas];
    expect(Object.keys(schema.shape).sort()).toEqual([...keys].sort());
    expect(schema.safeParse({ arbitrary_secret: true }).success).toBe(false);
  }
  for (const fixture of fixtures.sectionOnly)
    expect(setupChangeSummary(state, { settings: { [fixture.key]: fixture.value } })).toContain(
      `${fixture.key}:`
    );
});
test('full analytics is owner-only and enabled CAPTCHA needs a provider', async () => {
  await expect(
    resolver(false).resolve(principal, {
      workflowId: 'update_settings',
      guildId: 'guild',
      idempotencyKey: 'a',
      input: { patch: { section: 'analytics', changes: { analytics_consent_level: 'full' } } },
    })
  ).rejects.toMatchObject({ code: 'permission_denied' });
  await expect(
    resolver(true, false).resolve(principal, {
      workflowId: 'update_settings',
      guildId: 'guild',
      idempotencyKey: 'b',
      input: { patch: { section: 'verification', changes: { captcha_mode: 'manual' } } },
    })
  ).rejects.toMatchObject({ code: 'policy_disabled' });
});
test.each(['all', 'keywords'] as const)(
  'freezes %s reset into explicit approved defaults',
  async (scope) => {
    const result = await resolver().resolve(principal, {
      workflowId: 'reset_heuristics',
      guildId: 'guild',
      idempotencyKey: scope,
      input: { scope },
    });
    expect(result.delivery).toEqual({
      kind: 'queued',
      command: { kind: 'update_heuristics', changes: shippedResetChanges(scope) },
    });
    expect(result.summary).toContain(JSON.stringify(shippedResetChanges(scope)));
  }
);
test('only update_setup is delivered directly', () => {
  expect(
    workflowDefinitions
      .filter((w) => ['setup', 'operations'].includes(w.family) && w.delivery === 'direct')
      .map((w) => w.id)
  ).toEqual(['update_setup']);
});

test.each([false, undefined, true])(
  'includes the intended lockdown setting diff from %s with conditional outcome language',
  async (enabled) => {
    const current = {
      ...state,
      settings: enabled === undefined ? {} : { case_role_lockdown_enabled: enabled },
    };
    const result = await resolver(true, true, current).resolve(principal, {
      workflowId: 'apply_case_role_lockdown',
      guildId: 'guild',
      idempotencyKey: 'apply',
      input: { unsyncAllowedChannels: true },
    });
    expect(result.summary).toContain(
      setupChangeSummary(current, { settings: { case_role_lockdown_enabled: true } })
    );
    expect(result.summary).toContain('Intended settings change');
    expect(result.summary).toContain('no overwrite changes are needed');
    expect(result.summary).toContain('at least one planned overwrite succeeds');
    expect(result.summary).toContain('partial');
    expect(result.summary).toContain('"unsyncAllowedChannels":true');
    expect(result.preconditions).toEqual({ kind: 'setup', approvedState: current });
  }
);

test.each([
  {
    workflowId: 'update_setup' as const,
    input: { changes: { adminChannelId: 'foreign-channel' } },
  },
  {
    workflowId: 'update_settings' as const,
    input: {
      patch: { section: 'caseStaff', changes: { case_responder_role_ids: ['foreign-role'] } },
    },
  },
  {
    workflowId: 'lockdown_allow_add' as const,
    input: { targetKind: 'category', targetId: 'foreign-category' },
  },
])(
  'rejects a foreign guild resource for $workflowId before an intent is saved',
  async ({ workflowId, input }) => {
    await expect(
      resolver().resolve(principal, {
        workflowId,
        guildId: 'guild',
        idempotencyKey: 'foreign',
        input,
      })
    ).rejects.toMatchObject({ code: 'binding_mismatch' });
  }
);

test('covers the canonical role/channel/category fields without treating domain IDs as Discord references', () => {
  const expected = [
    'case_role_id',
    'admin_channel_id',
    'verification_channel_id',
    'admin_notification_role_id',
    'observed_detection_notification_channel_id',
    'moderation_queue_channel_id',
    'report_instructions_channel_id',
    'manual_intake_role_id',
    'case_role_lockdown_allowed_channel_ids',
    'case_role_lockdown_allowed_category_ids',
    'case_responder_role_ids',
    'honeypot_role_id',
    'member_access_role_id',
    'role_quarantine_exempt_role_ids',
  ];
  expect(Object.keys(setupResourceFields).sort()).toEqual(expected.sort());
  expect(
    setupResourceReferences({
      kind: 'update_setup',
      changes: {
        messageDeletionWatchlistDisabledDefaultIds: ['domain-id'],
        heuristicSuspiciousKeywords: ['arbitrary words'],
      },
    })
  ).toEqual([]);
  for (const fixture of fixtures.fields.filter((f) =>
    expected.includes(f.location.replace('settings.', ''))
  )) {
    const command = setupChangesSchema.parse({ [fixture.input]: fixture.value });
    expect(setupResourceReferences({ kind: 'update_setup', changes: command })).toHaveLength(
      Array.isArray(fixture.value) ? fixture.value.length : fixture.value ? 1 : 0
    );
  }
  expect(() =>
    validateSetupResourceReferences([{ kind: 'category', id: 'text' }], {
      roles: [],
      channels: [{ id: 'text', name: 'text', type: 0 }],
    })
  ).toThrow();
  expect(() =>
    validateSetupResourceReferences([{ kind: 'channel', id: 'category' }], {
      roles: [],
      channels: [{ id: 'category', name: 'category', type: 4 }],
    })
  ).toThrow();
});
test('allows clearing resource references and repairing unrelated legacy settings', async () => {
  await expect(
    resolver().resolve(principal, {
      workflowId: 'update_setup',
      guildId: 'guild',
      idempotencyKey: 'clear',
      input: { changes: { adminChannelId: null, caseResponderRoleIds: [] } },
    })
  ).resolves.toBeDefined();
  await expect(
    resolver().resolve(principal, {
      workflowId: 'update_settings',
      guildId: 'guild',
      idempotencyKey: 'clear-list',
      input: { patch: { section: 'caseStaff', changes: { case_responder_role_ids: [] } } },
    })
  ).resolves.toBeDefined();
});

test('binds both setup modes and detects create-versus-reuse changes in the saved selection', async () => {
  const invocation = {
    workflowId: 'complete_setup_verification_provision' as const,
    guildId: 'guild',
    idempotencyKey: 'provision',
    input: { adminChannelId: 'admin', onboardingWizard: false },
  };
  const channels = [{ id: 'admin', name: 'admin', type: 0 }];
  const initial = await resolver(true, true, state, [], channels).resolve(principal, invocation);
  expect(initial.preconditions).toMatchObject({
    provisioning: {
      role: { kind: 'create', name: 'Drasil Case' },
      verification: { kind: 'create', name: 'verification' },
      detectionResponseMode: 'notify_only',
    },
  });
  const changed = await resolver(
    true,
    true,
    state,
    [{ id: 'match', name: 'Drasil Case' }],
    channels
  ).resolve(principal, invocation);
  expect(changed.relevantState).not.toEqual(initial.relevantState);
  expect(changed.preconditions).toMatchObject({
    provisioning: { role: { kind: 'reuse', id: 'match' } },
  });
  const modal = await resolver(
    true,
    true,
    state,
    [{ id: 'case', name: 'selected' }],
    channels
  ).resolve(principal, {
    ...invocation,
    workflowId: 'complete_setup_verification_verification_modal',
    input: { adminChannelId: 'admin', caseRoleId: 'case', onboardingWizard: false },
  });
  expect(modal.delivery).toMatchObject({
    kind: 'queued',
    command: { mode: 'verification_modal', caseRoleId: 'case' },
  });
});
test.each([
  {
    mode: 'provision',
    reportInstructionsChannelId: 'new-report',
    onboardingWizard: false,
    expected: '"new-report"',
  },
  { mode: 'provision', onboardingWizard: true, expected: 'null' },
  { mode: 'provision', onboardingWizard: false, expected: null },
  { mode: 'verification_modal', onboardingWizard: true, expected: null },
] as const)('provisioning panel diff matches completion choices: %j', async (choice) => {
  const current = {
    ...state,
    case_role_id: 'case',
    admin_channel_id: 'admin',
    verification_channel_id: 'verification',
    settings: { report_instructions_channel_id: 'old-report' },
  };
  const { expected, mode, ...input } = choice;
  const result = await resolver(
    true,
    true,
    current,
    [{ id: 'case', name: 'Case' }],
    [
      { id: 'admin', name: 'admin', type: 0 },
      { id: 'verification', name: 'verification', type: 0 },
      { id: 'new-report', name: 'reports', type: 0 },
    ]
  ).resolve(principal, {
    workflowId:
      mode === 'provision'
        ? 'complete_setup_verification_provision'
        : 'complete_setup_verification_verification_modal',
    guildId: 'guild',
    idempotencyKey: 'panel-diff',
    input: {
      adminChannelId: 'admin',
      caseRoleId: 'case',
      verificationChannelId: 'verification',
      ...input,
    },
  });
  if (expected === null) {
    expect(result.summary).not.toContain('report_instructions_channel_id:');
    expect(result.summary).toContain('No editable settings change.');
  } else {
    expect(result.summary).toContain(`report_instructions_channel_id: "old-report" -> ${expected}`);
    expect(result.summary).not.toContain('No editable settings change.');
  }
});
test.each(['repair', 'repost'] as const)(
  'binds %s panel publication provenance and current channel',
  async (action) => {
    const current = {
      ...state,
      settings: {
        report_instructions_channel_id: 'old-channel',
        report_instructions_message_channel_id: 'message-channel',
        report_instructions_message_id: 'old-message',
      },
    };
    const result = await resolver(
      true,
      true,
      current,
      [],
      [{ id: 'new-channel', name: 'report', type: 0 }]
    ).resolve(principal, {
      workflowId: `upsert_report_instructions_${action}`,
      guildId: 'guild',
      idempotencyKey: 'panel',
      input: { channelId: 'new-channel' },
    });
    expect(result.bindings).toMatchObject({
      panel: { expectedMessageId: 'old-message', expectedChannelId: 'old-channel' },
    });
    expect(result.summary).toContain(`action: ${action}`);
    expect(
      result.delivery.kind === 'queued' &&
        confirmationRequirement(setupCommandSchema.parse(result.delivery.command))
    ).toBe(action === 'repost' ? 'confirm' : 'none');
  }
);
test('clearing a panel stays queued with its approved configured channel', async () => {
  const result = await resolver(true, true, {
    ...state,
    settings: { report_instructions_channel_id: 'old-channel' },
  }).resolve(principal, {
    workflowId: 'clear_report_instructions',
    guildId: 'guild',
    idempotencyKey: 'clear',
    input: {},
  });
  expect(result.delivery).toEqual({
    kind: 'queued',
    command: { kind: 'clear_report_instructions' },
  });
  expect(result.summary).toContain('report_instructions_channel_id: "old-channel" -> null');
});
test.each([
  { workflowId: 'sync_moderation_queue' as const, input: {}, confirmation: 'none' },
  { workflowId: 'clear_moderation_queue' as const, input: {}, confirmation: 'confirm' },
  { workflowId: 'audit_case_role_lockdown' as const, input: {}, confirmation: 'none' },
  {
    workflowId: 'apply_case_role_lockdown' as const,
    input: { unsyncAllowedChannels: false },
    confirmation: 'confirm',
  },
  {
    workflowId: 'audit_integrity' as const,
    input: { scope: 'all', days: 7, limit: 10, userId: null },
    confirmation: 'none',
  },
  ...(['guild_audit', 'administrator'] as const).flatMap((variant) =>
    [false, true].map((execute) => ({
      workflowId: `close_resolved_case_threads_${variant}` as const,
      input: { execute, days: 7, limit: 10, userId: null },
      confirmation: execute ? 'confirm' : 'none',
    }))
  ),
  ...[false, true].map((execute) => ({
    workflowId: 'intake_role_members' as const,
    input: { roleId: 'role', execute, limit: 10, reason: 'approved reason' },
    confirmation: execute ? 'confirm' : 'none',
  })),
])(
  'queues $workflowId with only its needed confirmation',
  async ({ workflowId, input, confirmation }) => {
    const result = await resolver(true, true, state, [{ id: 'role', name: 'intake' }]).resolve(
      principal,
      { workflowId, guildId: 'guild', idempotencyKey: 'ops', input }
    );
    expect(result.delivery.kind).toBe('queued');
    expect(
      result.delivery.kind === 'queued' &&
        confirmationRequirement(operationCommandSchema.parse(result.delivery.command))
    ).toBe(confirmation);
  }
);
test('fresh reason and enforcement policy changes change the relevant state and missing intake reasons deny execution', async () => {
  const invocation = {
    workflowId: 'intake_role_members' as const,
    guildId: 'guild',
    idempotencyKey: 'policy',
    input: { roleId: 'role', execute: true, limit: 10, reason: null },
  };
  const roles = [{ id: 'role', name: 'intake' }];
  const initial = await resolver(
    true,
    true,
    { ...state, settings: { admin_case_open_requires_reason: false } },
    roles
  ).resolve(principal, invocation);
  await expect(
    resolver(
      true,
      true,
      { ...state, settings: { admin_case_open_requires_reason: true } },
      roles
    ).resolve(principal, invocation)
  ).rejects.toMatchObject({ code: 'reason_required' });
  const changed = await resolver(
    true,
    true,
    {
      ...state,
      settings: { admin_case_open_requires_reason: false, moderator_ban_action_enabled: false },
    },
    roles
  ).resolve(principal, invocation);
  expect(changed.relevantState).not.toEqual(initial.relevantState);
});

test('shows legacy keyword normalization in the exact threshold-only heuristic diff', async () => {
  const result = await resolver(true, true, {
    ...state,
    heuristic_suspicious_keywords: [' Example ', 'EXAMPLE'],
  }).resolve(principal, {
    workflowId: 'update_heuristics',
    guildId: 'guild',
    idempotencyKey: 'normalize',
    input: { changes: { messageThreshold: 8 } },
  });
  expect(result.summary).toContain(
    'heuristic_suspicious_keywords: [" Example ","EXAMPLE"] -> ["example"]'
  );
});

test('reset delivery cannot add fields outside its exact approved scope', () => {
  const precondition = { kind: 'setup' as const, approvedState: state };
  expect(
    approvedResetDelivery(
      { kind: 'reset_heuristics', scope: 'keywords' },
      {
        kind: 'update_heuristics',
        changes: { ...shippedResetChanges('keywords'), messageThreshold: 5 },
      },
      precondition
    )
  ).toBe(false);
  expect(
    approvedResetDelivery(
      { kind: 'reset_heuristics', scope: 'all' },
      {
        kind: 'update_heuristics',
        changes: { ...shippedResetChanges('all'), timeframeSeconds: 99 },
      },
      precondition
    )
  ).toBe(false);
});
