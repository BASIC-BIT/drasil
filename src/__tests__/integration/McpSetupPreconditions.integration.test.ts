/// <reference lib="dom" />
import { Pool } from 'pg';
import { PostgresSetupDataAdapter, getPostgresPool } from '../../../apps/web/lib/setupDataAdapter';
import { decodeQueuedAction } from '@drasil/application';

jest.mock('@drasil/contracts', () => jest.requireActual('@drasil/application/setup-settings'), {
  virtual: true,
});
jest.mock('../../../apps/web/lib/e2eFixtures', () => ({}));
import { fixtures } from '../../../packages/application/src/setup/fieldFixtures.testData';
import { persistSetupChange } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../../../apps/web/lib/mcp/adapters/database';
import {
  createApprovedSetupConfiguration,
  SetupEffectsStateChangedError,
} from '../../application/adapters/approvedSetup';
import { ServerRepository } from '../../repositories/ServerRepository';
import { getPrismaClient } from '../testDb';
import { createBotSetupRuntime, type BotSetupDependencies } from '../../application/adapters/setup';
import { ConfigService } from '../../config/ConfigService';
import { mockDeep } from 'jest-mock-extended';
import type { Client } from 'discord.js';
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration('MCP setup approved writes', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
    await getPostgresPool().end();
  });
  it('rejects a confirmed write after the admin channel changes', async () => {
    await pool.query(
      "insert into servers(guild_id, admin_channel_id) values('guild', 'approved-channel')"
    );
    const adapter = new PostgresSetupDataAdapter();
    const approvedState = (await adapter.getServer('guild'))!;
    const otherWritersChannelId = 'other-channel';
    await pool.query('update servers set admin_channel_id = $1 where guild_id = $2', [
      otherWritersChannelId,
      'guild',
    ]);
    const result = await adapter
      .updateGuildSetup({ guildId: 'guild', userReportReasonRequired: false }, { approvedState })
      .then(
        () => ({ state: 'completed' }),
        (error: { code?: string }) => ({ state: 'denied', code: error.code })
      );
    const stored = (await pool.query("select * from servers where guild_id = 'guild'")).rows[0];
    expect(result).toMatchObject({ state: 'denied', code: 'stale_state' });
    expect(stored.admin_channel_id).toBe(otherWritersChannelId);
    expect(stored.settings.user_report_reason_required).toBeUndefined();
  });
  it('allows only one writer after the same approved full settings state', async () => {
    await pool.query("insert into servers(guild_id) values('guild')");
    const adapter = new PostgresSetupDataAdapter();
    const approvedState = (await adapter.getServer('guild'))!;
    const repository = new ServerRepository(getPrismaClient());
    const results = await Promise.all([
      repository.updateSetupIfUnchanged(
        'guild',
        { approvedState },
        { settings: { user_report_reason_required: false } }
      ),
      repository.updateSetupIfUnchanged(
        'guild',
        { approvedState },
        { columns: { admin_channel_id: 'new-channel' } }
      ),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = (await pool.query("select * from servers where guild_id='guild'")).rows[0];
    expect(Boolean(stored.admin_channel_id)).not.toBe(
      stored.settings.user_report_reason_required === false
    );
  });
  it('rejects a missing approved row without creating defaults', async () => {
    await pool.query("insert into servers(guild_id) values('guild')");
    const approvedState = (await new PostgresSetupDataAdapter().getServer('guild'))!;
    await pool.query("delete from servers where guild_id='guild'");
    expect(
      await new ServerRepository(getPrismaClient()).updateSetupIfUnchanged(
        'guild',
        { approvedState },
        { settings: { user_report_reason_required: false } }
      )
    ).toBeNull();
    expect((await pool.query('select count(*)::int as n from servers')).rows[0].n).toBe(0);
  });
  it('atomically removes reset keys while preserving a concurrent unrelated setting and cache', async () => {
    await pool.query(
      `insert into servers(guild_id, settings) values('guild', '{"verification_prompt_template":"old","verification_context":"context"}')`
    );
    const repository = new ServerRepository(getPrismaClient());
    const config = new ConfigService(repository, mockDeep<Client>());
    await config.getServerConfig('guild');
    await repository.updateSettings('guild', { user_report_reason_required: false });
    const updated = await config.updateSetupIfUnchanged('guild', undefined, {
      settings: { captcha_mode: 'off' },
      resetSettings: ['verification_prompt_template'],
    });
    expect(updated?.settings).toEqual({
      verification_context: 'context',
      user_report_reason_required: false,
      captcha_mode: 'off',
      captcha_method: 'none',
      captcha_method_revision: 0,
    });
    expect(config.getCachedServerConfig('guild')).toEqual(updated);
  });
  it('does not let a cached heuristic patch overwrite other writers omitted columns', async () => {
    await pool.query("insert into servers(guild_id) values('guild')");
    const repository = new ServerRepository(getPrismaClient());
    const config = new ConfigService(repository, mockDeep<Client>());
    await config.getServerConfig('guild');
    await repository.upsertByGuildId('guild', {
      heuristic_message_timeframe_seconds: 99,
      heuristic_suspicious_keywords: [' New current ', 'NEW CURRENT'],
    });
    await config.updateHeuristicSettings('guild', { messageThreshold: 17 });
    expect((await repository.findByGuildId('guild'))?.heuristic_message_timeframe_seconds).toBe(99);
    expect((await repository.findByGuildId('guild'))?.heuristic_suspicious_keywords).toEqual([
      'new current',
    ]);
  });
  it('applies native allowlist edits to the locked current lists instead of a stale prior read', async () => {
    await pool.query(
      `insert into servers(guild_id, settings) values('guild', '{"case_role_lockdown_allowed_channel_ids":["original"],"case_role_lockdown_allowed_category_ids":["original-category"]}')`
    );
    const repository = new ServerRepository(getPrismaClient());
    const client = mockDeep<Client>();
    const config = new ConfigService(repository, client);
    const originalRead = config.getServerConfig.bind(config);
    jest.spyOn(config, 'getServerConfig').mockImplementationOnce(async (guildId) => {
      const stale = await originalRead(guildId, { forceRefresh: true });
      await repository.updateSettings(guildId, {
        case_role_lockdown_allowed_channel_ids: ['concurrent'],
        case_role_lockdown_allowed_category_ids: ['concurrent-category'],
      });
      return stale;
    });
    const runtime = createBotSetupRuntime(
      { ...mockDeep<BotSetupDependencies>(), client, configService: config },
      {
        loadFresh: async () => ({
          guildId: 'guild',
          userId: 'actor',
          present: true,
          owner: true,
          permissions: '8',
          roleIds: [],
        }),
      }
    );
    await runtime.execute(
      {
        guildId: 'guild',
        requestId: 'native',
        source: 'discord',
        actor: { kind: 'user', userId: 'actor' },
      },
      { kind: 'lockdown_allow_add', targetKind: 'channel', targetId: 'requested' },
      { kind: 'configuration' }
    );
    const stored = (await repository.findByGuildId('guild'))!;
    expect(stored.settings.case_role_lockdown_allowed_channel_ids).toEqual([
      'concurrent',
      'requested',
    ]);
    expect(stored.settings.case_role_lockdown_allowed_category_ids).toEqual([
      'concurrent-category',
    ]);
  });
  it.each([
    {
      kind: 'update_settings',
      section: 'detection',
      changes: { observed_action_ban_requires_reason: false },
    },
    { kind: 'update_heuristics', changes: { suspiciousKeywords: [] } },
    { kind: 'reset_heuristics', scope: 'all' },
    { kind: 'lockdown_allow_add', targetKind: 'channel', targetId: 'channel' },
    { kind: 'lockdown_allow_remove', targetKind: 'category', targetId: 'category' },
    { kind: 'disable_lockdown' },
    { kind: 'clear_report_instructions' },
    {
      kind: 'complete_setup_verification',
      mode: 'verification_modal',
      adminChannelId: 'channel',
      caseRoleId: 'role',
      onboardingWizard: false,
    },
  ])('loads independently persisted new setup kind $kind', async (command) => {
    await pool.query("insert into servers(guild_id) values('guild')");
    const result = await pool.query(
      `insert into moderation_action_requests(server_id, action_type, actor_id, actor_surface, target_user_id, idempotency_key, metadata) values('guild', $1::moderation_action_request_type, 'actor', 'mcp', null, 'fixture', $2::jsonb) returning *`,
      [command.kind, JSON.stringify({ setup_command: command, requested_surface: 'mcp' })]
    );
    expect(decodeQueuedAction(result.rows[0]).command).toEqual(command);
  });
  it.each([
    { kind: 'audit_integrity', scope: 'all', days: 30, limit: 100, userId: null },
    {
      kind: 'close_resolved_case_threads',
      intent: 'guild_audit',
      days: 30,
      limit: 100,
      execute: false,
      userId: null,
    },
  ])('loads independently persisted operation $kind', async (command) => {
    await pool.query("insert into servers(guild_id) values('guild')");
    const result = await pool.query(
      `insert into moderation_action_requests(server_id, action_type, actor_id, actor_surface, target_user_id, idempotency_key, metadata) values('guild', $1::moderation_action_request_type, 'actor', 'mcp', null, 'fixture', $2::jsonb) returning *`,
      [command.kind, JSON.stringify({ operation_command: command, requested_surface: 'mcp' })]
    );
    expect(decodeQueuedAction(result.rows[0]).command).toEqual(command);
  });

  it('compares every editable column and section-only key against the locked row', async () => {
    await pool.query("insert into servers(guild_id) values('guild')");
    const repository = new ServerRepository(getPrismaClient());
    const adapter = new PostgresSetupDataAdapter();
    const cases = [
      ...fixtures.fields.map((f) => ({ location: f.location, value: f.value })),
      ...fixtures.sectionOnly.map((f) => ({ location: `settings.${f.key}`, value: f.value })),
    ];
    expect(cases).toHaveLength(83);
    for (const field of cases) {
      await pool.query(
        "update servers set settings='{}', case_role_id='initial', admin_channel_id='initial', verification_channel_id='initial', admin_notification_role_id='initial', heuristic_message_threshold=9, heuristic_message_timeframe_seconds=9, heuristic_suspicious_keywords=array['initial'] where guild_id='guild'"
      );
      const approvedState = (await adapter.getServer('guild'))!;
      if (field.location.startsWith('settings.'))
        await pool.query("update servers set settings=$1::jsonb where guild_id='guild'", [
          JSON.stringify({ [field.location.slice(9)]: field.value }),
        ]);
      else
        await pool.query(`update servers set ${field.location}=$1 where guild_id='guild'`, [
          field.value,
        ]);
      expect({
        location: field.location,
        result: await repository.updateSetupIfUnchanged(
          'guild',
          { approvedState },
          { settings: { server_about: 'must not write' } }
        ),
      }).toEqual({ location: field.location, result: null });
    }
  });
  it('advances approved state only through committed own workflow writes', async () => {
    await pool.query("insert into servers(guild_id) values('guild')");
    const repository = new ServerRepository(getPrismaClient());
    const config = new ConfigService(repository, mockDeep<Client>());
    const approvedState = (await new PostgresSetupDataAdapter().getServer('guild'))!;
    const scope = createApprovedSetupConfiguration(config, { approvedState });
    await scope.read('guild');
    await scope.save('guild', {
      settings: {
        report_instructions_pending_publication: { channel_id: 'channel', after_message_id: null },
      },
    });
    await scope.save('guild', {
      settings: {
        report_instructions_message_id: 'message',
        report_instructions_pending_publication: null,
      },
    });
    scope.startEffects();
    await repository.updateSettings('guild', { user_report_reason_required: false });
    await expect(
      scope.save('guild', { settings: { report_instructions_channel_id: 'channel' } })
    ).rejects.toBeInstanceOf(SetupEffectsStateChangedError);
    expect(
      (await repository.findByGuildId('guild'))?.settings.report_instructions_channel_id
    ).toBeUndefined();
  });
  it('cancels CAPTCHA with the settings commit and rolls both back together', async () => {
    await pool.query(
      'insert into servers(guild_id, settings) values(\'guild\', \'{"captcha_mode":"manual"}\')'
    );
    await pool.query("insert into users(discord_id) values('target')");
    const event = (
      await pool.query(
        "insert into verification_events(server_id,user_id) values('guild','target') returning id"
      )
    ).rows[0];
    await pool.query(
      "insert into captcha_challenges(verification_event_id,server_id,user_id,request_source,pass_effect,case_revision_at_issue,link_token_hash,expires_at) values($1,'guild','target','moderator','evidence_only',0,'fixture',now()+interval '1 hour')",
      [event.id]
    );
    const database = createWebDelegationDatabase(pool);
    await expect(
      database.transaction(async (tx) => {
        await persistSetupChange(tx, 'guild', { settings: { captcha_mode: 'off' } });
        throw new Error('abort');
      })
    ).rejects.toThrow('abort');
    expect((await pool.query('select status from captcha_challenges')).rows[0].status).toBe(
      'pending'
    );
    expect((await pool.query('select settings from servers')).rows[0].settings.captcha_mode).toBe(
      'manual'
    );
    const adapter = new PostgresSetupDataAdapter();
    await adapter.updateGuildSetup(
      { guildId: 'guild', captchaMode: 'off' },
      { approvedState: (await adapter.getServer('guild'))! }
    );
    expect((await pool.query('select status from captcha_challenges')).rows[0].status).toBe(
      'cancelled'
    );
  });

  it('does not overwrite another writer when native default initialization raced a missing read', async () => {
    const repository = new ServerRepository(getPrismaClient());
    const originalFind = repository.findByGuildId.bind(repository);
    jest.spyOn(repository, 'findByGuildId').mockImplementationOnce(async (guildId) => {
      const missing = await originalFind(guildId);
      expect(missing).toBeNull();
      await pool.query(
        "insert into servers(guild_id,admin_channel_id,settings) values($1,'other-admin','{\"user_report_reason_required\":false}')",
        [guildId]
      );
      return missing;
    });
    const config = new ConfigService(repository, mockDeep<Client>());
    const result = await config.getServerConfig('guild', {
      forceRefresh: true,
      failOnReadError: true,
    });
    expect(result.admin_channel_id).toBe('other-admin');
    expect(result.settings.user_report_reason_required).toBe(false);
    expect(config.getCachedServerConfig('guild')).toEqual(result);
  });
});
