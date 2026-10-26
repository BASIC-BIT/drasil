import { beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({
  headers: new Headers({ origin: 'https://site.example', cookie: 'verified-session' }),
  requireBrowserSession: vi.fn(),
  approve: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: async () => deps.headers }));
vi.mock('../../../lib/mcp/connectionData', () => ({
  getMcpConnectionContext: () => ({
    config: { origin: 'https://site.example' },
    issuer: { requireBrowserSession: deps.requireBrowserSession },
  }),
}));
vi.mock('../../../lib/mcp/websiteApprovals', () => ({
  approveMcpIntentFromWebsite: deps.approve,
  cancelMcpIntentFromWebsite: deps.cancel,
}));
import { approveMcpConfirmation, cancelMcpConfirmation } from './[confirmationId]/actions';
beforeEach(() => {
  vi.clearAllMocks();
  deps.requireBrowserSession.mockResolvedValue({ user: { id: 'trusted' } });
  deps.approve.mockResolvedValue({ state: 'queued', executionId: 'receipt' });
  deps.cancel.mockResolvedValue({ state: 'denied', code: 'cancelled' });
});
describe('remote website approval actions', () => {
  it('revalidates the browser session and ignores tampered hidden authority', async () => {
    const form = new FormData();
    form.set('confirmationId', 'a'.repeat(43));
    form.set('session', JSON.stringify({ user: { id: 'attacker' } }));
    form.set('actor', 'attacker');
    form.set('guildId', 'other');
    form.set('connectionId', 'other');
    await expect(approveMcpConfirmation(form)).resolves.toEqual({
      state: 'queued',
      executionId: 'receipt',
    });
    const request = deps.requireBrowserSession.mock.calls[0][0] as Request;
    expect(request.method).toBe('POST');
    expect(request.headers.get('origin')).toBe('https://site.example');
    expect(deps.approve).toHaveBeenCalledWith({ user: { id: 'trusted' } }, 'a'.repeat(43));
  });
  it.each([approveMcpConfirmation, cancelMcpConfirmation])(
    'never mutates when browser session/CSRF validation fails',
    async (action) => {
      deps.requireBrowserSession.mockRejectedValue(new Error('Forbidden'));
      const form = new FormData();
      form.set('confirmationId', 'a'.repeat(43));
      await expect(action(form)).rejects.toThrow('Forbidden');
      expect(deps.approve).not.toHaveBeenCalled();
      expect(deps.cancel).not.toHaveBeenCalled();
    }
  );
  it('preserves the owned uncertain receipt after completion recording fails', async () => {
    const receipt = {
      state: 'uncertain',
      executionId: 'owned-execution',
      code: 'completion_recording_failed',
    };
    deps.approve.mockResolvedValue(receipt);
    const form = new FormData();
    form.set('confirmationId', 'a'.repeat(43));
    await expect(approveMcpConfirmation(form)).resolves.toEqual(receipt);
  });
});
