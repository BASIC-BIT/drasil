import {
  createDelegatedAccess,
  type DelegatedAccess,
  type MemberContextPurpose,
  type DelegatedReadQuery,
} from './access';
import type { AuthorityFacts } from '../authorization';
import type { ConnectionGrant, DelegatedPrincipal } from './types';
import { humanCommandSchema, workflowDefinitions, type WorkflowId } from './commands';
import { ReadDependencyUnavailableError } from './readFailures';

const guildId = 'guild';
const principal: DelegatedPrincipal = {
  userId: 'user',
  clientId: 'client',
  connectionId: 'connection',
  grantVersion: 1,
  scopes: ['drasil:read', 'drasil:moderate', 'drasil:configure'],
};
const caseQuery = { kind: 'cases' as const, guildId };
const banCommand = humanCommandSchema.parse({
  kind: 'ban_user',
  targetUserId: 'target',
  reason: null,
});
function fixture(): {
  access: DelegatedAccess;
  authority: { loadFresh: jest.Mock<Promise<AuthorityFacts>, [string]> };
  directory: {
    isActive: jest.Mock<Promise<boolean>, []>;
    listActive: jest.Mock<Promise<{ guildIds: string[]; nextCursor: null }>, []>;
  };
  setFacts(change: Partial<AuthorityFacts>): void;
  setGrant(change: Partial<ConnectionGrant>): void;
} {
  let grant: ConnectionGrant = {
    ...principal,
    version: 1,
    selection: { mode: 'selected', guildIds: [guildId] },
    createdAt: new Date(),
    revokedAt: null,
  };
  let facts: AuthorityFacts = {
    userId: principal.userId,
    guildId,
    present: true,
    owner: false,
    permissions: '0',
    roleIds: [],
  };
  const authority = { loadFresh: jest.fn(async (id: string) => ({ ...facts, guildId: id })) };
  const directory = {
    isActive: jest.fn(async () => true),
    listActive: jest.fn(async () => ({ guildIds: [guildId, 'new-guild'], nextCursor: null })),
  };
  const access = createDelegatedAccess({
    store: { findConnection: async () => grant },
    authority,
    staffRoles: { loadRoleIds: async () => ['staff'] },
    guilds: directory,
  });
  return {
    access,
    authority,
    directory,
    setFacts: (change: Partial<AuthorityFacts>): void => {
      facts = { ...facts, ...change };
    },
    setGrant: (change: Partial<ConnectionGrant>): void => {
      grant = { ...grant, ...change };
    },
  };
}

describe('delegated access', () => {
  it('preserves temporary authority failure advice and checks role changes on the next call', async () => {
    const f = fixture();
    f.setFacts({ roleIds: ['staff'] });
    expect(await f.access.authorizeRead(principal, caseQuery)).toMatchObject({ kind: 'allowed' });
    f.authority.loadFresh.mockRejectedValueOnce(
      new ReadDependencyUnavailableError({ retryAfterSeconds: 2 })
    );
    expect(await f.access.authorizeRead(principal, caseQuery)).toEqual({
      kind: 'denied',
      reason: 'unavailable',
      retryAfterSeconds: 2,
    });
    f.setFacts({ roleIds: [] });
    expect(await f.access.authorizeRead(principal, caseQuery)).toEqual({
      kind: 'denied',
      reason: 'permission_denied',
    });
    f.setGrant({ revokedAt: new Date() });
    expect(await f.access.authorizeRead(principal, caseQuery)).toEqual({
      kind: 'denied',
      reason: 'invalid_grant',
    });
  });
  it('preserves temporary failures in eligible-guild authority and directory lookups', async () => {
    const f = fixture();
    const failure = new ReadDependencyUnavailableError({ retryAfterSeconds: 2 });
    f.directory.listActive.mockRejectedValueOnce(failure);
    expect(await f.access.listEligibleGuilds(principal, {})).toEqual({
      kind: 'denied',
      reason: 'unavailable',
      retryAfterSeconds: 2,
    });
    f.authority.loadFresh.mockRejectedValueOnce(failure);
    expect(await f.access.listEligibleGuilds(principal, {})).toEqual({
      kind: 'denied',
      reason: 'unavailable',
      retryAfterSeconds: 2,
    });
  });
  it.each([
    ['owner', '0', true],
    ['Administrator', '8', false],
    ['Manage Server', '32', false],
    ['Moderate Members', (1n << 40n).toString(), false],
    ['Ban Members', '4', false],
    ['Kick Members', '2', false],
  ])('accepts current %s eligibility', async (_name, permissions, owner) => {
    const f = fixture();
    f.setFacts({ permissions, owner });
    expect(await f.access.authorizeGuild(principal, guildId, 'drasil:read')).toMatchObject({
      kind: 'allowed',
    });
  });
  it('does not turn staff eligibility into enforcement authority', async () => {
    const f = fixture();
    f.setFacts({ roleIds: ['staff'] });
    const roleOnly = principal;
    expect(await f.access.authorizeRead(roleOnly, caseQuery)).toMatchObject({ kind: 'allowed' });
    expect(await f.access.authorizeRead(roleOnly, { kind: 'reports', guildId })).toMatchObject({
      kind: 'allowed',
    });
    expect(await f.access.authorizeWorkflow(roleOnly, guildId, banCommand)).toMatchObject({
      kind: 'denied',
    });
    expect(
      await f.access.authorizeWorkflow(
        roleOnly,
        guildId,
        humanCommandSchema.parse({
          kind: 'open_admin_case',
          intent: 'native_case_open',
          targetUserId: 'target',
          reason: null,
          detectionEventId: null,
          selectedMessage: null,
        })
      )
    ).toMatchObject({ kind: 'denied' });
    expect(
      await f.access.authorizeWorkflow(roleOnly, guildId, {
        kind: 'open_submitted_report_case',
        reportId: 'report',
      })
    ).toMatchObject({ kind: 'denied' });
    f.setGrant({ revokedAt: new Date() });
    const revoked = principal;
    expect(await f.access.authorizeGuild(revoked, guildId, 'drasil:read')).toMatchObject({
      kind: 'denied',
    });
  });
  it.each(['2', '4'])(
    'limits enforcement-only permission %s to its workflow',
    async (permissions) => {
      const f = fixture();
      f.setFacts({ permissions });
      expect(await f.access.authorizeRead(principal, caseQuery)).toMatchObject({ kind: 'denied' });
      expect(await f.access.authorizeRead(principal, { kind: 'reports', guildId })).toMatchObject({
        kind: 'denied',
      });
      expect(
        await f.access.authorizeRead(principal, {
          kind: 'member_context',
          guildId,
          purpose: permissions === '4' ? 'ban' : 'kick',
          workflowId: permissions === '4' ? 'ban_user' : 'kick_user',
        })
      ).toMatchObject({ kind: 'allowed' });
      expect(
        await f.access.authorizeRead(principal, {
          kind: 'member_context',
          guildId,
          purpose: 'case',
          workflowId: 'open_admin_case_moderator',
        })
      ).toMatchObject({ kind: 'denied' });
    }
  );
  it('refreshes departed members, inactive installations and changed roles', async () => {
    const f = fixture();
    f.setFacts({ roleIds: ['staff'] });
    expect(await f.access.authorizeRead(principal, caseQuery)).toMatchObject({ kind: 'allowed' });
    f.setFacts({ roleIds: [] });
    expect(await f.access.authorizeRead(principal, caseQuery)).toMatchObject({ kind: 'denied' });
    f.setFacts({ owner: true, present: false });
    expect(await f.access.authorizeRead(principal, caseQuery)).toMatchObject({ kind: 'denied' });
    f.setFacts({ present: true });
    f.directory.isActive.mockResolvedValue(false);
    expect(await f.access.authorizeRead(principal, caseQuery)).toMatchObject({ kind: 'denied' });
  });
  it('fails closed on refresh failure or mismatched facts', async () => {
    const f = fixture();
    f.authority.loadFresh.mockRejectedValueOnce(new Error('Discord down'));
    expect(await f.access.authorizeRead(principal, caseQuery)).toMatchObject({
      kind: 'denied',
      reason: 'unavailable',
    });
    f.authority.loadFresh.mockResolvedValueOnce({
      guildId: 'other',
      userId: 'other',
      present: true,
      owner: true,
      roleIds: [],
      permissions: '8',
    });
    expect(await f.access.authorizeRead(principal, caseQuery)).toMatchObject({
      kind: 'denied',
      reason: 'binding_mismatch',
    });
  });
  it('enforces both scope ceilings and the persisted identity and version', async () => {
    const f = fixture();
    f.setFacts({ owner: true });
    for (const change of [
      { scopes: [] },
      { grantVersion: 2 },
      { userId: 'other' },
      { clientId: 'other' },
    ]) {
      expect(await f.access.authorizeRead({ ...principal, ...change }, caseQuery)).toMatchObject({
        kind: 'denied',
      });
    }
    f.setGrant({ scopes: ['drasil:read'] });
    expect(await f.access.authorizeWorkflow(principal, guildId, banCommand)).toMatchObject({
      kind: 'denied',
    });
  });
  it('keeps selected grants fixed and includes future guilds for all-eligible grants', async () => {
    const f = fixture();
    f.setFacts({ owner: true });
    expect(await f.access.authorizeGuild(principal, 'new-guild', 'drasil:read')).toMatchObject({
      kind: 'denied',
    });
    expect(await f.access.listEligibleGuilds(principal, {})).toMatchObject({
      kind: 'allowed',
      guilds: [{ guildId }],
    });
    f.setGrant({ selection: { mode: 'all_eligible' } });
    expect(await f.access.authorizeGuild(principal, 'new-guild', 'drasil:read')).toMatchObject({
      kind: 'allowed',
    });
    expect(await f.access.listEligibleGuilds(principal, {})).toMatchObject({
      kind: 'allowed',
      guilds: [{ guildId }, { guildId: 'new-guild' }],
    });
    f.setFacts({ owner: false });
    expect(await f.access.listEligibleGuilds(principal, {})).toMatchObject({
      kind: 'allowed',
      guilds: [],
    });
  });
  it('binds reporter reads and own status to the actor, connection and exact workflow', async () => {
    const f = fixture();
    f.setFacts({ permissions: '4' });
    expect(
      await f.access.authorizeRead(principal, { kind: 'reports', guildId, audience: 'reporter' })
    ).toMatchObject({ kind: 'allowed', reporterId: principal.userId });
    const query = {
      kind: 'own_execution' as const,
      guildId,
      userId: principal.userId,
      connectionId: principal.connectionId,
      workflowId: 'ban_user' as const,
    };
    expect(await f.access.authorizeRead(principal, query)).toMatchObject({ kind: 'allowed' });
    expect(
      await f.access.authorizeRead(principal, { ...query, connectionId: 'other' })
    ).toMatchObject({ kind: 'denied' });
    expect(
      await f.access.authorizeRead(principal, { ...query, workflowId: 'clear_moderation_queue' })
    ).toMatchObject({ kind: 'denied' });
  });
  it('keeps setup and diagnostics on their family authority', async () => {
    const f = fixture();
    f.setFacts({ permissions: '32' });
    expect(await f.access.authorizeRead(principal, { kind: 'diagnostics', guildId })).toMatchObject(
      { kind: 'allowed' }
    );
    expect(await f.access.authorizeRead(principal, { kind: 'setup', guildId })).toMatchObject({
      kind: 'denied',
    });
    expect(await f.access.authorizeRead(principal, { kind: 'attention', guildId })).toMatchObject({
      kind: 'allowed',
    });
  });
});

it.each([
  ['32', 'open_admin_case', 'native_case_open', 'denied'],
  ['32', 'open_admin_case', 'dashboard_case_open', 'allowed'],
  [(1n << 40n).toString(), 'open_admin_case', 'native_case_open', 'allowed'],
  [(1n << 40n).toString(), 'open_admin_case', 'dashboard_case_open', 'denied'],
])('retains %s permission semantics for %s %s', async (permissions, kind, intent, expected) => {
  const f = fixture();
  f.setFacts({ permissions });
  const command = humanCommandSchema.parse({
    kind,
    intent,
    targetUserId: 'target',
    reason: null,
    detectionEventId: null,
    selectedMessage: null,
  });
  expect(await f.access.authorizeWorkflow(principal, guildId, command)).toMatchObject({
    kind: expected,
  });
});
it.each([
  ['repair_active_case', 'administrator_repair', 'denied'],
  ['repair_active_case', 'moderator_repair', 'allowed'],
  ['close_resolved_case_threads', 'guild_audit', 'allowed'],
  ['close_resolved_case_threads', 'administrator_operation', 'denied'],
])('retains Manage Server semantics for %s %s', async (kind, intent, expected) => {
  const f = fixture();
  f.setFacts({ permissions: '32' });
  const command = humanCommandSchema.parse(
    kind === 'repair_active_case'
      ? { kind, intent, caseId: 'case', targetUserId: 'target' }
      : { kind, intent, execute: false, days: 30, limit: 25, userId: null }
  );
  expect(await f.access.authorizeWorkflow(principal, guildId, command)).toMatchObject({
    kind: expected,
  });
});

it('reports workflow capabilities from fresh family authority rather than eligibility', async () => {
  const f = fixture();
  f.setFacts({ roleIds: ['staff'] });
  expect(await f.access.listEligibleGuilds(principal, {})).toMatchObject({
    kind: 'allowed',
    guilds: [{ workflows: expect.arrayContaining(['close_submitted_report']) }],
  });
  const staff = await f.access.listEligibleGuilds(principal, {});
  for (const workflow of ['ban_user', 'open_admin_case_moderator', 'update_setup']) {
    expect(staff).toMatchObject({
      guilds: [{ workflows: expect.not.arrayContaining([workflow]) }],
    });
  }
  f.setFacts({ permissions: '4', roleIds: [] });
  expect(await f.access.listEligibleGuilds(principal, {})).toMatchObject({
    guilds: [
      {
        workflows: expect.arrayContaining(['ban_user', 'ban_observed_detection_report']),
        reads: [],
      },
    ],
  });
  f.setFacts({ permissions: '32' });
  const managed = await f.access.listEligibleGuilds(principal, {});
  expect(managed).toMatchObject({
    guilds: [
      {
        workflows: expect.arrayContaining([
          'open_admin_case_administrator',
          'repair_active_case_moderator',
          'close_resolved_case_threads_guild_audit',
        ]),
      },
    ],
  });
  for (const workflow of [
    'open_admin_case_moderator',
    'repair_active_case_administrator',
    'close_resolved_case_threads_administrator',
  ]) {
    expect(managed).toMatchObject({
      guilds: [{ workflows: expect.not.arrayContaining([workflow]) }],
    });
  }
  f.setFacts({ owner: true });
  expect(await f.access.listEligibleGuilds(principal, {})).toMatchObject({
    guilds: [{ workflows: workflowDefinitions.map((definition) => definition.id) }],
  });
  f.setGrant({ scopes: ['drasil:read'] });
  expect(await f.access.listEligibleGuilds(principal, {})).toMatchObject({
    guilds: [{ workflows: [] }],
  });
});

it.each<[string, WorkflowId, 'allowed' | 'denied']>([
  ['32', 'open_admin_case_administrator', 'allowed'],
  ['32', 'open_case_from_observed_detection', 'allowed'],
  ['32', 'open_admin_case_moderator', 'denied'],
  ['32', 'repair_active_case_administrator', 'denied'],
  ['32', 'manual_flag_user', 'denied'],
  [(1n << 40n).toString(), 'open_admin_case_moderator', 'allowed'],
  [(1n << 40n).toString(), 'open_admin_case_administrator', 'denied'],
])(
  'binds case context with permissions %s to workflow %s',
  async (permissions, workflowId, expected) => {
    const f = fixture();
    f.setFacts({ permissions });
    const result = await f.access.authorizeRead(principal, {
      kind: 'member_context',
      guildId,
      purpose: 'case',
      workflowId,
    });
    expect(result).toMatchObject({ kind: expected });
    if (expected === 'allowed')
      expect(result).toMatchObject({ memberContext: { purpose: 'case', workflowId } });
  }
);
it.each<[MemberContextPurpose, WorkflowId]>([
  ['case', 'ban_user'],
  ['ban', 'kick_user'],
  ['report', 'open_admin_case_moderator'],
  ['configure', 'manual_flag_user'],
  ['kick', 'update_setup'],
  ['case', 'acknowledge_attention'],
])(
  'rejects purpose %s mismatched with workflow %s even for owners',
  async (purpose, workflowId) => {
    const f = fixture();
    f.setFacts({ owner: true });
    expect(
      await f.access.authorizeRead(principal, {
        kind: 'member_context',
        guildId,
        purpose,
        workflowId,
      })
    ).toMatchObject({ kind: 'denied' });
  }
);
it('requires a known workflow and ignores caller-provided authority descriptors', async () => {
  const f = fixture();
  f.setFacts({ permissions: '32' });
  for (const workflowId of [undefined, 'unknown_workflow', 'apply_captcha_pass']) {
    const query = {
      kind: 'member_context',
      guildId,
      purpose: 'case',
      workflowId,
    } as unknown as DelegatedReadQuery;
    expect(await f.access.authorizeRead(principal, query)).toMatchObject({ kind: 'denied' });
  }
  const query = {
    kind: 'member_context' as const,
    guildId,
    purpose: 'case' as const,
    workflowId: 'open_admin_case_moderator' as const,
    authorityCommand: { kind: 'open_admin_case', intent: 'dashboard_case_open' },
  };
  expect(await f.access.authorizeRead(principal, query)).toMatchObject({ kind: 'denied' });
});
it('keeps exact workflow context on read consent and advertises only matching context bindings', async () => {
  const f = fixture();
  f.setFacts({ permissions: '32' });
  f.setGrant({ scopes: ['drasil:read'] });
  const readOnly = { ...principal, scopes: ['drasil:read'] as const };
  const workflowId = 'open_admin_case_administrator' as const;
  expect(
    await f.access.authorizeRead(readOnly, {
      kind: 'member_context',
      guildId,
      purpose: 'case',
      workflowId,
    })
  ).toMatchObject({
    kind: 'allowed',
    scope: 'drasil:read',
    memberContext: { purpose: 'case', workflowId },
  });
  const command = humanCommandSchema.parse({
    kind: 'open_admin_case',
    intent: 'dashboard_case_open',
    targetUserId: 'target',
    reason: null,
    detectionEventId: null,
    selectedMessage: null,
  });
  expect(await f.access.authorizeWorkflow(readOnly, guildId, command)).toMatchObject({
    kind: 'denied',
    reason: 'scope_denied',
  });
  const page = await f.access.listEligibleGuilds(readOnly, {});
  expect(page).toMatchObject({
    guilds: [
      { workflows: [], memberContext: expect.arrayContaining([{ purpose: 'case', workflowId }]) },
    ],
  });
  for (const workflowId of [
    'open_admin_case_moderator',
    'repair_active_case_administrator',
    'manual_flag_user',
  ]) {
    expect(page).toMatchObject({
      guilds: [{ memberContext: expect.not.arrayContaining([{ purpose: 'case', workflowId }]) }],
    });
  }
  f.setFacts({ permissions: (1n << 40n).toString() });
  expect(
    await f.access.authorizeRead(readOnly, {
      kind: 'member_context',
      guildId,
      purpose: 'case',
      workflowId,
    })
  ).toMatchObject({ kind: 'denied' });
});

it('refreshes capabilities and enforces read consent and selected guilds', async () => {
  const h = fixture();
  h.setFacts({ owner: true });
  expect(await h.access.getCapabilities(principal, guildId)).toMatchObject({
    kind: 'allowed',
    capabilities: {
      guildId,
      reads: expect.arrayContaining(['cases']),
      memberContext: expect.any(Array),
    },
  });
  h.setFacts({ owner: false, permissions: String(1n << 2n) });
  const changed = await h.access.getCapabilities(principal, guildId);
  expect(changed).toMatchObject({ kind: 'allowed' });
  if (changed.kind === 'allowed') expect(changed.capabilities.reads).not.toContain('cases');
  expect(
    await h.access.getCapabilities({ ...principal, scopes: ['drasil:moderate'] }, guildId)
  ).toMatchObject({ kind: 'denied', reason: 'scope_denied' });
  expect(await h.access.getCapabilities(principal, 'other')).toMatchObject({
    kind: 'denied',
    reason: 'guild_denied',
  });
  h.setGrant({ version: 2 });
  expect(await h.access.getCapabilities(principal, guildId)).toMatchObject({
    kind: 'denied',
    reason: 'invalid_grant',
  });
});
it('preflights exact semantic workflow authority without invented resource bindings', async () => {
  const f = fixture();
  f.setFacts({ permissions: '32' });
  expect(
    await f.access.authorizeWorkflowId(principal, guildId, 'open_admin_case_administrator')
  ).toMatchObject({ kind: 'allowed' });
  expect(
    await f.access.authorizeWorkflowId(principal, guildId, 'open_admin_case_moderator')
  ).toMatchObject({ kind: 'denied', reason: 'permission_denied' });
  f.setFacts({ permissions: '8' });
  expect(
    await f.access.authorizeWorkflowId(principal, guildId, 'execute_case_message_deletion')
  ).toMatchObject({ kind: 'allowed' });
  f.setGrant({ revokedAt: new Date() });
  expect(
    await f.access.authorizeWorkflowId(principal, guildId, 'execute_case_message_deletion')
  ).toEqual({ kind: 'denied', reason: 'invalid_grant' });
});
it('preflights staff-only and ban-only authority with the existing family predicates', async () => {
  const f = fixture();
  f.setFacts({ roleIds: ['staff'] });
  expect(
    await f.access.authorizeWorkflowId(principal, guildId, 'start_report_intake')
  ).toMatchObject({ kind: 'allowed' });
  expect(await f.access.authorizeWorkflowId(principal, guildId, 'ban_user')).toMatchObject({
    kind: 'denied',
  });
  f.setFacts({ permissions: '4', roleIds: [] });
  expect(await f.access.authorizeWorkflowId(principal, guildId, 'ban_user')).toMatchObject({
    kind: 'allowed',
  });
  expect(await f.access.authorizeWorkflowId(principal, guildId, 'kick_user')).toMatchObject({
    kind: 'denied',
  });
});
it('preflights current token scope, persisted scope, guild selection and grant version', async () => {
  const f = fixture();
  f.setFacts({ permissions: '8' });
  expect(
    await f.access.authorizeWorkflowId(
      { ...principal, scopes: ['drasil:read'] },
      guildId,
      'ban_user'
    )
  ).toEqual({ kind: 'denied', reason: 'scope_denied' });
  f.setGrant({ scopes: ['drasil:read'] });
  expect(await f.access.authorizeWorkflowId(principal, guildId, 'ban_user')).toEqual({
    kind: 'denied',
    reason: 'scope_denied',
  });
  f.setGrant({ scopes: principal.scopes, selection: { mode: 'selected', guildIds: [] } });
  expect(await f.access.authorizeWorkflowId(principal, guildId, 'ban_user')).toEqual({
    kind: 'denied',
    reason: 'guild_denied',
  });
  f.setGrant({ selection: { mode: 'all_eligible' }, version: 2 });
  expect(await f.access.authorizeWorkflowId(principal, guildId, 'ban_user')).toEqual({
    kind: 'denied',
    reason: 'invalid_grant',
  });
});

it.each([
  ['clear_moderation_queue', 'denied'],
  ['sync_moderation_queue', 'denied'],
  ['audit_case_role_lockdown', 'denied'],
  ['apply_case_role_lockdown', 'denied'],
  ['intake_role_members', 'denied'],
  ['close_resolved_case_threads_administrator', 'denied'],
  ['close_resolved_case_threads_guild_audit', 'allowed'],
  ['audit_integrity', 'allowed'],
] as const)(
  'checks own %s receipt authority under real read scope: %s',
  async (workflowId, kind) => {
    const f = fixture();
    const readOnly = { ...principal, scopes: ['drasil:read' as const] };
    const query = {
      kind: 'own_execution' as const,
      guildId,
      userId: principal.userId,
      connectionId: principal.connectionId,
      workflowId,
    };
    f.setFacts({ permissions: '8' });
    expect(await f.access.authorizeRead(readOnly, query)).toMatchObject({ kind: 'allowed' });
    f.setFacts({ permissions: '32' });
    expect(await f.access.authorizeRead(readOnly, query)).toMatchObject({ kind });
    f.setGrant({ revokedAt: new Date() });
    expect(await f.access.authorizeRead(readOnly, query)).toEqual({
      kind: 'denied',
      reason: 'invalid_grant',
    });
  }
);
