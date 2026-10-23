import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebCaseAction } from '@/lib/activeCaseDataAdapter';
import { initialInboxActionState, type InboxActionState } from '@/lib/inboxActionState';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  assertCanManageGuild: vi.fn(),
  getServer: vi.fn(),
  queue: vi.fn(),
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
  createActiveCaseDataAdapter: () => ({ queueCaseAction: mocks.queue }),
}));

import { queueCaseAction, queueInboxCaseAction } from './actions';

type Surface = 'case' | 'inbox';
const challengeId = '11111111-1111-4111-8111-111111111111';
function confirmedForm(): FormData {
  const form = new FormData();
  form.set('confirmAction', 'on');
  form.set('reason', ' Reviewed the case ');
  form.set('expectedCaptchaChallengeId', challengeId);
  form.set('expectedCaptchaGeneration', '3');
  return form;
}
function submit(
  surface: Surface,
  action: WebCaseAction,
  form: FormData
): Promise<void | InboxActionState> {
  return surface === 'case'
    ? queueCaseAction('guild-1', 'case-1', action, form)
    : queueInboxCaseAction('guild-1', 'case-1', action, initialInboxActionState, form);
}
async function expectDenied(
  surface: Surface,
  action: WebCaseAction,
  form: FormData,
  message: string
): Promise<void> {
  if (surface === 'case') await expect(submit(surface, action, form)).rejects.toThrow(message);
  else
    expect(await submit(surface, action, form)).toMatchObject({
      status: 'failed',
      requestId: null,
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
  mocks.queue.mockResolvedValue({
    action: 'bypass_captcha',
    caseId: 'case-1',
    requestId: 'request-1',
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
    if (surface === 'inbox')
      expect(result).toMatchObject({ status: 'queued', requestId: 'request-1' });
    else expect(result).toBeUndefined();
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
    ['confirmAction', 'Confirm the security-check action'],
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
        status: 'queued',
      });
      const result = await submit(surface, action, confirmedForm());
      if (surface === 'inbox') expect(result).toMatchObject({ status: 'queued' });
      else expect(result).toBeUndefined();
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
