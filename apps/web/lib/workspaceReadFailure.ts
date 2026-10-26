export type WorkspaceReadFailureCode =
  'authentication_required' | 'access_denied' | 'unavailable' | 'not_found' | 'internal_error';

export class WorkspaceReadError extends Error {
  constructor(readonly code: WorkspaceReadFailureCode) {
    super('Workspace read failed.');
    this.name = 'WorkspaceReadError';
  }
}

/** Interpret only the stable protocol code at its matching HTTP status. */
export async function workspaceResponseError(response: Response): Promise<WorkspaceReadError> {
  const body: unknown = await response.json().catch(() => null);
  const code = body && typeof body === 'object' && 'code' in body ? body.code : undefined;
  const expected: Readonly<Record<number, WorkspaceReadFailureCode>> = {
    401: 'authentication_required',
    403: 'access_denied',
    404: 'not_found',
    503: 'unavailable',
    500: 'internal_error',
  };
  const expectedCode = expected[response.status];
  return new WorkspaceReadError(
    expectedCode && code === expectedCode ? expectedCode : 'internal_error'
  );
}
