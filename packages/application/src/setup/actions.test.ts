import { materializeSetupStoredChange } from './persistence';
import { createSetupActions, type SetupActions } from './actions';
import type { SetupDependencies } from './ports';
import type { ActionContext } from '../context';
import type { SetupServerRecord } from './settings';

const context: ActionContext = {
  guildId: 'guild',
  requestId: 'request',
  source: 'web',
  actor: { kind: 'user', userId: 'admin' },
};
function arrange(): {
  actions: SetupActions;
  server(): SetupServerRecord;
  panelCount(): number;
  setOwner(value: boolean): void;
  setPermissions(value: bigint): void;
  setProvider(value: boolean): void;
  setConfirmed(value: boolean): void;
} {
  let owner = false;
  let permissions = String(1n << 3n);
  let providerConfigured = true;
  let confirmed = true;
  let panelCreateCount = 0;
  let server: SetupServerRecord = {
    guild_id: 'guild',
    case_role_id: null,
    admin_channel_id: null,
    verification_channel_id: null,
    admin_notification_role_id: null,
    heuristic_message_threshold: 5,
    heuristic_message_timeframe_seconds: 10,
    heuristic_suspicious_keywords: [],
    created_at: null,
    updated_at: null,
    updated_by: null,
    settings: { unrelated_setting: 'preserved' },
    is_active: true,
  };
  const panels = new Map<string, { action: 'reposted'; messageId: string }>();
  const deps: SetupDependencies = {
    authority: {
      async loadFresh(guildId, userId) {
        return { guildId, userId, owner, permissions, present: true, roleIds: [] };
      },
    },
    confirmations: {
      async verify() {
        return confirmed;
      },
    },
    configuration: {
      async loadFresh() {
        return server;
      },
      async save(_context, update) {
        server = { ...server, settings: { ...server.settings, ...update.settings } };
        for (const key of update.resetSettings ?? []) delete server.settings[key];
        return server;
      },
      async updateHeuristics() {
        return { messageThreshold: 5, timeWindowMs: 10000, suspiciousKeywords: [] };
      },
      async resetHeuristics() {
        return { messageThreshold: 5, timeWindowMs: 10000, suspiciousKeywords: [] };
      },
    },
    provider: { isConfigured: () => providerConfigured },
    provisioning: {
      async complete() {
        return { status: 'invalid_selection', detail: 'unused' };
      },
    },
    panels: {
      async upsert(_context, command) {
        const key = command.repost ? command.submissionId : 'repair';
        const previous = panels.get(key);
        if (previous) return previous;
        const result = { action: 'reposted' as const, messageId: String(++panelCreateCount) };
        panels.set(key, result);
        return result;
      },
      async clear() {
        return { action: 'cleared' };
      },
    },
  };
  return {
    actions: createSetupActions(deps),
    server: (): SetupServerRecord => server,
    panelCount: (): number => panelCreateCount,
    setOwner: (value: boolean): void => {
      owner = value;
    },
    setPermissions: (value: bigint): void => {
      permissions = String(value);
    },
    setProvider: (value: boolean): void => {
      providerConfigured = value;
    },
    setConfirmed: (value: boolean): void => {
      confirmed = value;
    },
  };
}
test('only_owner_can_enable_full_analytics', async () => {
  const state = arrange();
  const result = await state.actions.execute(context, {
    kind: 'update_settings',
    section: 'analytics',
    changes: { analytics_consent_level: 'full' },
  });
  expect(result).toEqual({ kind: 'denied', code: 'permission_denied' });
  state.setOwner(true);
  expect(
    (
      await state.actions.execute(context, {
        kind: 'update_settings',
        section: 'analytics',
        changes: { analytics_consent_level: 'full' },
      })
    ).kind
  ).toBe('outcome');
});
test('setup_requires_admin_beyond_web_entry_access', async () => {
  const state = arrange();
  state.setPermissions(1n << 5n);
  expect(
    await state.actions.execute(context, {
      kind: 'update_setup',
      changes: { adminChannelId: 'channel' },
    })
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
});
test('section_patch_preserves_other_settings', async () => {
  const state = arrange();
  await state.actions.execute(context, {
    kind: 'update_settings',
    section: 'queue',
    changes: { moderation_queue_channel_id: 'queue' },
  });
  expect(state.server().settings).toEqual({
    unrelated_setting: 'preserved',
    moderation_queue_channel_id: 'queue',
  });
});
test('report_panel_repost_requires_fresh_submission', async () => {
  const state = arrange();
  const command = {
    kind: 'upsert_report_instructions',
    channelId: 'channel',
    repost: true,
    expectedMessageId: null,
    expectedChannelId: null,
    submissionId: 'submission',
  } as const;
  state.setConfirmed(false);
  expect(await state.actions.execute(context, command)).toEqual({
    kind: 'denied',
    code: 'confirmation_required',
  });
  state.setConfirmed(true);
  await state.actions.execute(context, command);
  await state.actions.execute(context, command);
  expect(state.panelCount()).toBe(1);
});
test('provider_mode_requires_configuration', async () => {
  const state = arrange();
  state.setProvider(false);
  expect(
    await state.actions.execute(context, {
      kind: 'update_settings',
      section: 'verification',
      changes: { captcha_mode: 'manual' },
    })
  ).toEqual({ kind: 'denied', code: 'policy_disabled' });
  expect(state.server().settings.captcha_mode).toBeUndefined();
});

test('nonowner preserves existing full consent only for a full setup save, using fresh state', async () => {
  const state = arrange();
  state.setOwner(true);
  await state.actions.execute(context, {
    kind: 'update_settings',
    section: 'analytics',
    changes: { analytics_consent_level: 'full' },
  });
  state.setOwner(false);
  expect(
    (
      await state.actions.execute(context, {
        kind: 'update_setup',
        changes: { analyticsConsentLevel: 'full' },
      })
    ).kind
  ).toBe('outcome');
  expect(
    await state.actions.execute(context, {
      kind: 'update_settings',
      section: 'analytics',
      changes: { analytics_consent_level: 'full' },
    })
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
  await state.actions.execute(context, {
    kind: 'update_settings',
    section: 'analytics',
    changes: { analytics_consent_level: 'anonymous' },
  });
  expect(
    await state.actions.execute(context, {
      kind: 'update_setup',
      changes: { analyticsConsentLevel: 'full' },
    })
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
});
test('verification resets remove only their owned fields', async () => {
  const state = arrange();
  await state.actions.execute(context, {
    kind: 'update_settings',
    section: 'verification',
    changes: {
      verification_prompt_template: 'prompt',
      server_about: 'about',
      verification_context: 'context',
      expected_topics: ['topic'],
      captcha_mode: 'off',
    },
  });
  await state.actions.execute(context, {
    kind: 'update_settings',
    section: 'verification',
    changes: {},
    reset: 'context',
  });
  expect(state.server().settings).toEqual({
    unrelated_setting: 'preserved',
    verification_prompt_template: 'prompt',
    captcha_mode: 'off',
  });
  await state.actions.execute(context, {
    kind: 'update_settings',
    section: 'verification',
    changes: {},
    reset: 'prompt',
  });
  expect(state.server().settings).toEqual({ unrelated_setting: 'preserved', captcha_mode: 'off' });
});
test('lockdown allows mutate the fresh selected list and retain other categories', async () => {
  const state = arrange();
  await state.actions.execute(context, {
    kind: 'lockdown_allow_add',
    targetKind: 'category',
    targetId: 'category',
  });
  await state.actions.execute(context, {
    kind: 'lockdown_allow_add',
    targetKind: 'channel',
    targetId: 'one',
  });
  await state.actions.execute(context, {
    kind: 'lockdown_allow_add',
    targetKind: 'channel',
    targetId: 'two',
  });
  await state.actions.execute(context, {
    kind: 'lockdown_allow_remove',
    targetKind: 'channel',
    targetId: 'one',
  });
  await state.actions.execute(context, { kind: 'disable_lockdown' });
  expect(state.server().settings).toEqual({
    unrelated_setting: 'preserved',
    case_role_lockdown_allowed_channel_ids: ['two'],
    case_role_lockdown_allowed_category_ids: ['category'],
    case_role_lockdown_enabled: false,
  });
});
test.each(['web', 'discord_interaction', 'owner', 'system'])(
  'source %s cannot grant administrator authority',
  async (source) => {
    const state = arrange();
    state.setPermissions(0n);
    expect(
      await state.actions.execute(
        { ...context, source },
        { kind: 'update_heuristics', changes: { messageThreshold: 9 } }
      )
    ).toEqual({ kind: 'denied', code: 'permission_denied' });
  }
);

test('an unrelated patch can repair a server with a stale manual-intake role', async () => {
  const state = arrange();
  state.server().settings.manual_intake_enabled = true;
  state.server().settings.manual_intake_role_id = null;
  expect(
    (
      await state.actions.execute(context, {
        kind: 'update_settings',
        section: 'queue',
        changes: { moderation_queue_channel_id: 'queue' },
      })
    ).kind
  ).toBe('outcome');
});

test.each(['discord_image', 'none', 'turnstile'] as const)(
  'mode-only setup saves preserve the explicit %s method and its revision',
  async (method) => {
    const state = arrange();
    Object.assign(state.server().settings, {
      captcha_method: method,
      captcha_mode: 'manual',
      captcha_method_revision: 4,
    });
    for (const captchaMode of ['suspicious_join', 'off', 'manual'] as const) {
      const result = await state.actions.execute(context, {
        kind: 'update_setup',
        changes: { captchaMode },
      });
      expect(result.kind).toBe('outcome');
      expect(state.server().settings).toEqual({
        unrelated_setting: 'preserved',
        captcha_method: method,
        captcha_mode: captchaMode,
        captcha_method_revision: 4,
      });
    }
  }
);

test('mode-only setup saves leave legacy method metadata absent', async () => {
  const state = arrange();
  state.server().settings.captcha_mode = 'manual';
  const result = await state.actions.execute(context, {
    kind: 'update_setup',
    changes: { captchaMode: 'suspicious_join' },
  });
  expect(result.kind).toBe('outcome');
  expect(state.server().settings).toEqual({
    unrelated_setting: 'preserved',
    captcha_mode: 'suspicious_join',
  });
});

test('an explicit setup method selection still updates the selected method', async () => {
  const state = arrange();
  Object.assign(state.server().settings, {
    captcha_method: 'discord_image',
    captcha_mode: 'manual',
  });
  const result = await state.actions.execute(context, {
    kind: 'update_setup',
    changes: { captchaMethod: 'none' },
  });
  expect(result.kind).toBe('outcome');
  expect(state.server().settings).toEqual({
    unrelated_setting: 'preserved',
    captcha_method: 'none',
    captcha_mode: 'manual',
  });
});

test('method readiness uses the selected method even without a mode edit', async () => {
  const state = arrange();
  state.setProvider(false);
  expect(
    await state.actions.execute(context, {
      kind: 'update_setup',
      changes: { captchaMethod: 'turnstile' },
    })
  ).toEqual({ kind: 'denied', code: 'policy_disabled' });
  expect(state.server().settings.captcha_method).toBeUndefined();
});

test('None saves without secrets and unrelated edits survive provider outages', async () => {
  const state = arrange();
  state.setProvider(false);
  state.server().settings.captcha_method = 'turnstile';
  state.server().settings.captcha_mode = 'manual';
  expect(
    (
      await state.actions.execute(context, {
        kind: 'update_setup',
        changes: { captchaMethod: 'none' },
      })
    ).kind
  ).toBe('outcome');
  expect(
    (
      await state.actions.execute(context, {
        kind: 'update_setup',
        changes: { captchaMaxSubmissions: 7 },
      })
    ).kind
  ).toBe('outcome');
});

test.each(['turnstile', 'discord_image'] as const)(
  'activating %s from None uses manual unless explicitly suspicious join',
  (method) => {
    const state = arrange();
    Object.assign(state.server().settings, {
      captcha_method: 'none',
      captcha_mode: 'suspicious_join',
    });
    expect(
      materializeSetupStoredChange(state.server(), { settings: { captcha_method: method } })
        .settings
    ).toMatchObject({ captcha_method: method, captcha_mode: 'manual' });
    expect(
      materializeSetupStoredChange(state.server(), {
        settings: { captcha_method: method, captcha_mode: 'suspicious_join' },
      }).settings
    ).toMatchObject({ captcha_mode: 'suspicious_join' });
    state.server().settings.captcha_method = 'turnstile';
    expect(
      materializeSetupStoredChange(state.server(), {
        settings: { captcha_method: 'discord_image' },
      }).settings
    ).not.toHaveProperty('captcha_mode');
  }
);

test.each(['none', 'turnstile', 'discord_image'] as const)(
  'members cannot select %s',
  async (method) => {
    const state = arrange();
    state.setPermissions(0n);
    expect(
      await state.actions.execute(context, {
        kind: 'update_setup',
        changes: { captchaMethod: method },
      })
    ).toEqual({ kind: 'denied', code: 'permission_denied' });
    expect(state.server().settings).not.toHaveProperty('captcha_method');
  }
);

test('same-method Off resaves cannot activate checks during unrelated setup saves', () => {
  const state = arrange();
  Object.assign(state.server().settings, { captcha_method: 'turnstile', captcha_mode: 'off' });
  expect(
    materializeSetupStoredChange(state.server(), {
      settings: { captcha_method: 'turnstile', captcha_mode: 'off' },
    }).settings
  ).toMatchObject({ captcha_method: 'turnstile', captcha_mode: 'off' });
  expect(
    materializeSetupStoredChange(state.server(), { settings: { captcha_method: 'discord_image' } })
      .settings
  ).toMatchObject({ captcha_method: 'discord_image', captcha_mode: 'manual' });
});
