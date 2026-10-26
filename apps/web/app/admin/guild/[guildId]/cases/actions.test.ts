import type { WebCaseAction } from '@/lib/activeCaseDataAdapter';
import type { WorkspaceMutationResult } from '@/lib/workspaceActionTypes';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  assertCanManageGuild: vi.fn(),
  getServer: vi.fn(),
  queue: vi.fn(),
  detail: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    const error = new Error(path);
    Object.assign(error, { digest: 'NEXT_REDIRECT;replace' });
    throw error;
  },
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: mocks.session,
  getCurrentDiscordToken: mocks.token,
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: mocks.assertCanManageGuild }),
}));
vi.mock('@/lib/setupDataAdapter', () => ({
  createSetupDataAdapter: () => ({ getServer: mocks.getServer }),
}));
vi.mock('@/lib/activeCaseDataAdapter', () => ({
  createActiveCaseDataAdapter: () => ({
    queueCaseAction: mocks.queue,
    getCaseDetail: mocks.detail,
  }),
}));

import { submitWorkspaceCaseAction } from './actions';

type Surface = 'case' | 'inbox';
const challengeId = '11111111-1111-4111-8111-111111111111';
function confirmedForm(): FormData {
  const form = new FormData();
  form.set('confirmAction', 'on');
  form.set('reason', ' Reviewed the case ');
  form.set('confirmedRecordId', 'case-1');
  form.set('confirmedTargetUserId', 'member-1');
  form.set('expectedCaptchaChallengeId', challengeId);
  form.set('expectedCaptchaGeneration', '3');
  form.set('expectedCaptchaMethod', 'turnstile');
  form.set('expectedCaptchaMethodRevision', '1');
  return form;
}
function submit(
  _surface: Surface,
  action: WebCaseAction,
  form: FormData
): Promise<WorkspaceMutationResult> {
  return submitWorkspaceCaseAction({ guildId: 'guild-1', caseId: 'case-1', action }, form);
}
async function expectDenied(
  surface: Surface,
  action: WebCaseAction,
  form: FormData,
  message: string
): Promise<void> {
  expect(await submit(surface, action, form)).toMatchObject({
    kind: 'failed',
    message: expect.stringContaining(message),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: 'moderator-1' });
  mocks.token.mockResolvedValue({ accessToken: 'synthetic-token' });
  mocks.assertCanManageGuild.mockResolvedValue({
    id: 'guild-1',
    owner: false,
    permissions: '1099511627776',
  });
  mocks.getServer.mockResolvedValue({ settings: { captcha_mode: 'off' } });
  mocks.detail.mockResolvedValue({
    id: 'case-1',
    guildId: 'guild-1',
    userId: 'member-1',
    allowedActions: ['bypass_captcha', 'challenge_user', 'retry_captcha'],
  });
  mocks.queue.mockResolvedValue({
    action: 'bypass_captcha',
    caseId: 'case-1',
    requestId: 'request-1',
    receipt: { id: 'request-1', status: 'queued' },
    status: 'queued',
  });
});

describe.each<Surface>(['case', 'inbox'])('%s CAPTCHA action submission', (surface) => {
  it.each([
    { captcha_mode: 'off' },
    { captcha_method: 'none', captcha_mode: 'off' },
    { captcha_method: 'none', captcha_mode: 'suspicious_join' },
  ])('queues authorized reasoned bypass after disablement %j', async (settings) => {
    mocks.getServer.mockResolvedValue({ settings });
    const result = await submit(surface, 'bypass_captcha', confirmedForm());
    expect(result).toMatchObject({
      kind: 'request',
      receipt: { status: 'queued', id: 'request-1' },
    });
    expect(mocks.assertCanManageGuild).toHaveBeenCalledWith('guild-1', 'synthetic-token');
    expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: 'bypass_captcha',
        adminId: 'moderator-1',
        guildId: 'guild-1',
        caseId: 'case-1',
        expectedCaptchaChallengeId: challengeId,
        expectedCaptchaGeneration: 3,
        attemptId: expect.any(String),
        reason: 'Reviewed the case',
      })
    );
  });

  it('retains guild/moderator authorization before bypass', async () => {
    mocks.assertCanManageGuild.mockRejectedValue(new Error('Moderator permission required.'));
    await expectDenied(
      surface,
      'bypass_captcha',
      confirmedForm(),
      'Moderator permission required.'
    );
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it('requires an authenticated session before bypass', async () => {
    mocks.session.mockResolvedValue(null);
    await expect(submit(surface, 'bypass_captcha', confirmedForm())).rejects.toThrow(
      '/api/auth/discord'
    );
    expect(mocks.assertCanManageGuild).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it.each([
    ['confirmAction', 'Review and confirm the current record'],
    ['reason', 'A reason is required'],
    ['expectedCaptchaChallengeId', 'The displayed security check is no longer available'],
    ['expectedCaptchaGeneration', 'The displayed security check is no longer available'],
  ])('requires %s even after disablement', async (field, message) => {
    const form = confirmedForm();
    form.delete(field);
    await expectDenied(surface, 'bypass_captcha', form, message);
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it('retains shared queue rejection of a changed case/challenge binding', async () => {
    mocks.queue.mockResolvedValue({
      action: 'bypass_captcha',
      caseId: 'case-1',
      status: 'not_allowed',
    });
    await expectDenied(
      surface,
      'bypass_captcha',
      confirmedForm(),
      'Case action is not available for this case state.'
    );
    expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        expectedCaptchaChallengeId: challengeId,
        expectedCaptchaGeneration: 3,
      })
    );
  });

  describe.each(['challenge_user', 'retry_captcha'] as const)('%s', (action) => {
    it.each([
      { captcha_mode: 'manual' },
      { captcha_method: 'discord_image', captcha_mode: 'suspicious_join' },
    ])('can issue under active effective settings %j', async (settings) => {
      mocks.getServer.mockResolvedValue({ settings });
      mocks.queue.mockResolvedValue({
        action,
        caseId: 'case-1',
        requestId: 'request-1',
        receipt: { id: 'request-1', status: 'queued' },
        status: 'queued',
      });
      const form = confirmedForm();
      form.set(
        'expectedCaptchaConfigurationMethod',
        'captcha_method' in settings ? 'discord_image' : 'turnstile'
      );
      form.set('expectedCaptchaConfigurationRevision', '0');
      const result = await submit(surface, action, form);
      expect(result).toMatchObject({ kind: 'request', receipt: { status: 'queued' } });
      expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action }));
    });

    it.each([
      { captcha_mode: 'off' },
      { captcha_method: 'none', captcha_mode: 'suspicious_join' },
      { captcha_method: 'discord_image', captcha_mode: 'off' },
      { captcha_method: null, captcha_mode: 'manual' },
    ])('cannot issue under disabled effective settings %j', async (settings) => {
      mocks.getServer.mockResolvedValue({ settings });
      await expectDenied(
        surface,
        action,
        confirmedForm(),
        'security checks are disabled for this server.'
      );
      expect(mocks.queue).not.toHaveBeenCalled();
    });
  });
});

describe('workspace case confirmation boundary', () => {
  function workspaceForm() {
    const form = confirmedForm();
    form.set('confirmedRecordId', 'case-1');
    form.set('confirmedTargetUserId', 'member-1');
    return form;
  }
  beforeEach(() => {
    mocks.detail.mockResolvedValue({
      id: 'case-1',
      guildId: 'guild-1',
      userId: 'member-1',
      allowedActions: [
        'verify_user',
        'close_no_action',
        'repair_thread',
        'refresh_notification',
        'bypass_captcha',
      ],
    });
    mocks.queue.mockResolvedValue({
      action: 'verify_user',
      caseId: 'case-1',
      status: 'queued',
      requestId: 'request-1',
      receipt: { id: 'request-1', status: 'processing' },
    });
  });
  it.each(['verify_user', 'close_no_action', 'repair_thread', 'refresh_notification'] as const)(
    'requires contextual confirmation for %s',
    async (action) => {
      const { submitWorkspaceCaseAction } = await import('./actions');
      const form = workspaceForm();
      form.delete('confirmAction');
      expect(
        await submitWorkspaceCaseAction({ guildId: 'guild-1', caseId: 'case-1', action }, form)
      ).toMatchObject({ kind: 'failed' });
      expect(mocks.queue).not.toHaveBeenCalled();
    }
  );
  it.each(['confirmedRecordId', 'confirmedTargetUserId'])(
    'blocks a wrong %s before queue submission',
    async (field) => {
      const { submitWorkspaceCaseAction } = await import('./actions');
      const form = workspaceForm();
      form.set(field, 'wrong');
      expect(
        await submitWorkspaceCaseAction(
          { guildId: 'guild-1', caseId: 'case-1', action: 'verify_user' },
          form
        )
      ).toMatchObject({ kind: 'failed' });
      expect(mocks.queue).not.toHaveBeenCalled();
    }
  );
  it.each([{ guildId: 'other-guild' }, { allowedActions: [] }])(
    'blocks a cross-guild or stale case %j',
    async (changes) => {
      const { submitWorkspaceCaseAction } = await import('./actions');
      mocks.detail.mockResolvedValue({
        id: 'case-1',
        guildId: 'guild-1',
        userId: 'member-1',
        allowedActions: ['verify_user'],
        ...changes,
      });
      expect(
        await submitWorkspaceCaseAction(
          { guildId: 'guild-1', caseId: 'case-1', action: 'verify_user' },
          workspaceForm()
        )
      ).toMatchObject({ kind: 'failed' });
      expect(mocks.queue).not.toHaveBeenCalled();
    }
  );
  it('binds workspace issuance to fresh configured method/revision and preserves it for the worker', async () => {
    const { submitWorkspaceCaseAction } = await import('./actions');
    mocks.detail.mockResolvedValue({
      id: 'case-1',
      guildId: 'guild-1',
      userId: 'member-1',
      allowedActions: ['challenge_user'],
    });
    mocks.getServer.mockResolvedValue({
      settings: {
        captcha_mode: 'manual',
        captcha_method: 'discord_image',
        captcha_method_revision: 8,
      },
    });
    const form = workspaceForm();
    form.set('expectedCaptchaConfigurationMethod', 'turnstile');
    form.set('expectedCaptchaConfigurationRevision', '7');
    expect(
      await submitWorkspaceCaseAction(
        { guildId: 'guild-1', caseId: 'case-1', action: 'challenge_user' },
        form
      )
    ).toMatchObject({ kind: 'failed' });
    expect(mocks.queue).not.toHaveBeenCalled();
    form.set('expectedCaptchaConfigurationMethod', 'discord_image');
    form.set('expectedCaptchaConfigurationRevision', '8');
    expect(
      await submitWorkspaceCaseAction(
        { guildId: 'guild-1', caseId: 'case-1', action: 'challenge_user' },
        form
      )
    ).toMatchObject({ kind: 'request' });
    expect(mocks.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedCaptchaConfiguration: { method: 'discord_image', methodRevision: 8 },
      })
    );
  });

  it('preserves actual request status from the queue adapter', async () => {
    const { submitWorkspaceCaseAction } = await import('./actions');
    expect(
      await submitWorkspaceCaseAction(
        { guildId: 'guild-1', caseId: 'case-1', action: 'close_no_action' },
        workspaceForm()
      )
    ).toEqual({ kind: 'request', receipt: { id: 'request-1', status: 'processing' } });
  });
  it('retains reason-policy failure and direct-case login return', async () => {
    const { submitWorkspaceCaseAction } = await import('./actions');
    const form = workspaceForm();
    form.delete('reason');
    expect(
      await submitWorkspaceCaseAction(
        { guildId: 'guild-1', caseId: 'case-1', action: 'bypass_captcha' },
        form
      )
    ).toMatchObject({ kind: 'failed', message: expect.stringContaining('reason') });
    expect(mocks.queue).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue(null);
    form.set('returnTo', '/admin/guild/guild-1/cases/case-1?returnTo=inbox');
    await expect(
      submitWorkspaceCaseAction(
        { guildId: 'guild-1', caseId: 'case-1', action: 'close_no_action' },
        form
      )
    ).rejects.toThrow(
      `returnTo=${encodeURIComponent('/admin/guild/guild-1/cases/case-1?returnTo=inbox')}`
    );
  });
});

describe('security-check option guard ordering', () => {
  it.each([
    ['expectedCaptchaMethod', 'none'],
    ['expectedCaptchaMethodRevision', '-1'],
    ['expectedCaptchaMethodRevision', '1.5'],
    ['expectedCaptchaMethodRevision', 'not-a-number'],
  ])('rejects invalid displayed %s=%s before queueing', async (field, value) => {
    const form = confirmedForm();
    form.set(field, value);
    await expectDenied('case', 'bypass_captcha', form, 'displayed security-check method');
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.getServer).not.toHaveBeenCalled();
  });
  it('checks bypass reason before challenge identity, then method binding', async () => {
    const form = confirmedForm();
    form.delete('reason');
    form.delete('expectedCaptchaChallengeId');
    form.set('expectedCaptchaMethod', 'none');
    await expectDenied('case', 'bypass_captcha', form, 'A reason is required');
    form.set('reason', 'Reviewed');
    await expectDenied(
      'case',
      'bypass_captcha',
      form,
      'displayed security check is no longer available'
    );
    form.set('expectedCaptchaChallengeId', challengeId);
    await expectDenied('case', 'bypass_captcha', form, 'displayed security-check method');
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it('rejects stale issuance configuration before displayed retry challenge validation', async () => {
    mocks.getServer.mockResolvedValue({
      settings: { captcha_mode: 'manual', captcha_method_revision: 2 },
    });
    const form = confirmedForm();
    form.set('expectedCaptchaConfigurationMethod', 'turnstile');
    form.set('expectedCaptchaConfigurationRevision', '1');
    form.delete('expectedCaptchaChallengeId');
    await expectDenied('case', 'retry_captcha', form, 'configured security-check method changed');
    form.set('expectedCaptchaConfigurationRevision', '2');
    await expectDenied(
      'case',
      'retry_captcha',
      form,
      'displayed security check is no longer available'
    );
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
