import { expect, it } from 'vitest';
import { workspaceResponseError } from './workspaceReadFailure';
it.each([
  [401, 'authentication_required'],
  [403, 'access_denied'],
  [404, 'not_found'],
  [503, 'unavailable'],
  [500, 'internal_error'],
] as const)('consumes the safe %s response code', async (status, code) => {
  expect(
    (await workspaceResponseError(Response.json({ code, error: 'PRIVATE' }, { status }))).code
  ).toBe(code);
});
it.each([
  [503, { code: 'access_denied' }],
  [403, { error: 'PRIVATE' }],
  [503, { code: 'PRIVATE' }],
  [502, {}],
] as const)('rejects mismatched or missing codes with status%s', async (status, body) => {
  const error = await workspaceResponseError(Response.json(body, { status }));
  expect(error.code).toBe('internal_error');
  expect(error.message).not.toContain('PRIVATE');
});
it('handles non-JSON failure safely', async () => {
  expect((await workspaceResponseError(new Response('PRIVATE', { status: 503 }))).code).toBe(
    'internal_error'
  );
});
