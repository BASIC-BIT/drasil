import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanManageGuild: vi.fn(),
  connect: vi.fn(),
  getServer: vi.fn(),
  getCurrentAdminSession: vi.fn(),
  getCurrentDiscordToken: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    const error = new Error(path) as Error & { digest: string };
    error.digest = 'NEXT_REDIRECT;replace';
    throw error;
  },
}));
vi.mock('@/lib/discordPermissions', () => ({
  DISCORD_PERMISSIONS: { Administrator: 8n },
  hasPermission: (permissions: bigint, required: bigint) => (permissions & required) === required,
  parsePermissions: (permissions: string) => BigInt(permissions),
}));
vi.mock('@/lib/e2eFixtures', () => ({
  isWebE2eFixtureMode: () => process.env.DRASIL_WEB_E2E_FIXTURE_MODE === 'true',
}));
vi.mock('@/lib/inboxActionState', () => ({
  failedInboxActionState: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
    requestId: null,
    status: 'failed',
  }),
  queuedInboxActionState: (
    receipt: { id: string; status: string },
    message = 'Action queued for Drasil.'
  ) => ({ message, requestId: receipt.id, status: receipt.status }),
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: mocks.getCurrentAdminSession,
  getCurrentDiscordToken: mocks.getCurrentDiscordToken,
}));
vi.mock('@/lib/setupDataAdapter', () => ({
  createSetupDataAdapter: () => ({ getServer: mocks.getServer }),
  getPostgresPool: () => ({ connect: mocks.connect }),
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: mocks.assertCanManageGuild }),
}));

import {
  banCaseUserWithMessageCleanup,
  executeCaseMessageCleanup,
  previewCaseMessageCleanup,
} from './messageCleanupActions';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const MESSAGE_CAP_EXCEEDED = 101;
const initialInboxActionState = { message: null, requestId: null, status: 'idle' } as const;

const caseRow = {
  id: CASE_ID,
  server_id: 'guild-1',
  user_id: 'user-1',
  detection_event_id: null,
  private_evidence_thread_id: 'evidence-thread-1',
  status: 'pending',
};

const readyJob = {
  id: JOB_ID,
  server_id: 'guild-1',
  user_id: 'user-1',
  verification_event_id: CASE_ID,
  requested_by: 'admin-1',
  actor_surface: 'web_case',
  mode: 'delete_only',
  scope: 'last_day',
  status: 'ready',
  coverage: 'ready',
  reason: 'Reviewed spam cleanup.',
  evidence_thread_id: 'evidence-thread-1',
  candidate_count: 4,
  ban_status: 'not_requested',
  case_finalization_status: 'not_applicable',
};

function cleanupForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values = {
    confirmAction: 'on',
    idempotencyKey: 'submission_123456',
    jobId: JOB_ID,
    mode: 'delete_only',
    reason: 'Reviewed spam cleanup.',
    scope: 'last_day',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

function databaseClient(respond: (text: string, values: readonly unknown[]) => readonly unknown[]) {
  const query = vi.fn(async (text: string, values: readonly unknown[] = []) => ({
    rows: [...respond(text, values)],
  }));
  const release = vi.fn();
  mocks.connect.mockResolvedValue({ query, release });
  return { query, release };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAdminSession.mockResolvedValue({ userId: 'admin-1' });
  mocks.getCurrentDiscordToken.mockResolvedValue({ accessToken: 'discord-token' });
  mocks.assertCanManageGuild.mockResolvedValue({
    id: 'guild-1',
    owner: false,
    permissions: '8',
  });
  mocks.getServer.mockResolvedValue({ settings: { moderator_ban_action_enabled: true } });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('messageCleanupActions', () => {
  it('atomically creates a preview job and its queued request', async () => {
    const { query, release } = databaseClient((text) => {
      if (text.includes('from verification_events')) return [caseRow];
      if (text.includes('where idempotency_key')) return [];
      if (text.includes('select id::text from moderation_action_requests')) return [];
      if (text.includes('insert into message_deletion_jobs')) return [{ id: JOB_ID }];
      if (text.includes('insert into moderation_action_requests')) {
        return [{ id: REQUEST_ID, messageDeletionJobId: JOB_ID, status: 'queued' }];
      }
      return [];
    });

    const state = await previewCaseMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm()
    );

    expect(state).toEqual({
      message: 'Message cleanup preview queued.',
      requestId: REQUEST_ID,
      status: 'queued',
    });
    const statements = query.mock.calls.map(([text]) => text as string);
    expect(statements[0]).toBe('begin');
    expect(
      statements.findIndex((text) => text.includes('insert into message_deletion_jobs'))
    ).toBeLessThan(
      statements.findIndex((text) => text.includes('insert into moderation_action_requests'))
    );
    expect(statements.at(-1)).toBe('commit');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects a current guild manager who is not an Administrator', async () => {
    mocks.assertCanManageGuild.mockResolvedValue({
      id: 'guild-1',
      owner: false,
      permissions: '32',
    });

    const state = await previewCaseMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm()
    );

    expect(state.status).toBe('failed');
    expect(state.message).toContain('Administrator permission');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('blocks cleanup while another moderation action is active for the case', async () => {
    const { query } = databaseClient((text) => {
      if (text.includes('from verification_events')) return [caseRow];
      if (text.includes('where idempotency_key')) return [];
      if (text.includes('select id::text from moderation_action_requests')) {
        return [{ id: 'active-case-action' }];
      }
      return [];
    });

    const state = await previewCaseMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm()
    );

    expect(state).toEqual({
      message: 'Another moderation action is already in progress for this case.',
      requestId: null,
      status: 'failed',
    });
    expect(
      query.mock.calls.some(([text]) =>
        (text as string).includes('insert into message_deletion_jobs')
      )
    ).toBe(false);
  });
});

describe('messageCleanupActions execution', () => {
  it('rejects execution when submitted frozen fields no longer match the job', async () => {
    const { query } = databaseClient((text) => {
      if (text.includes('from verification_events')) return [caseRow];
      if (text.includes('from message_deletion_jobs')) {
        return [{ ...readyJob, reason: 'Different frozen reason.' }];
      }
      return [];
    });

    const state = await executeCaseMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm()
    );

    expect(state).toEqual({
      message: 'The cleanup preview changed. Refresh the case before continuing.',
      requestId: null,
      status: 'failed',
    });
    expect(query.mock.calls.map(([text]) => text)).toContain('rollback');
  });

  it('rejects previews above the 100-message execution cap', async () => {
    databaseClient((text) => {
      if (text.includes('from verification_events')) return [caseRow];
      if (text.includes('from message_deletion_jobs')) {
        return [{ ...readyJob, candidate_count: MESSAGE_CAP_EXCEEDED }];
      }
      return [];
    });

    const state = await executeCaseMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm()
    );

    expect(state.status).toBe('failed');
    expect(state.message).toBe('The cleanup preview is not eligible for execution.');
  });

  it('allows another current Administrator to execute a frozen case preview', async () => {
    mocks.getCurrentAdminSession.mockResolvedValue({ userId: 'admin-2' });
    databaseClient((text) => {
      if (text.includes('where idempotency_key')) return [];
      if (text.includes('from verification_events')) return [caseRow];
      if (text.includes('from message_deletion_jobs')) return [readyJob];
      if (text.includes('select id::text from moderation_action_requests')) return [];
      if (text.includes('insert into moderation_action_requests')) {
        return [{ id: REQUEST_ID, messageDeletionJobId: JOB_ID, status: 'queued' }];
      }
      return [];
    });

    const state = await executeCaseMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm()
    );

    expect(state).toEqual({
      message: 'Message cleanup queued.',
      requestId: REQUEST_ID,
      status: 'queued',
    });
  });

  it('honors the server setting that disables moderator ban actions', async () => {
    mocks.getServer.mockResolvedValue({ settings: { moderator_ban_action_enabled: false } });
    databaseClient((text) => {
      if (text.includes('where idempotency_key')) return [];
      if (text.includes('from verification_events')) return [caseRow];
      if (text.includes('from message_deletion_jobs')) {
        return [{ ...readyJob, mode: 'ban_with_cleanup' }];
      }
      return [];
    });

    const state = await banCaseUserWithMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm({ mode: 'ban_with_cleanup' })
    );

    expect(state).toEqual({
      message: 'Moderator ban actions are disabled for this server.',
      requestId: null,
      status: 'failed',
    });
    expect(mocks.connect).toHaveBeenCalled();
  });

  it('allows retrying a ready combined preview after its ban attempt failed', async () => {
    const failedBanJob = {
      ...readyJob,
      ban_status: 'failed',
      mode: 'ban_with_cleanup',
    };
    databaseClient((text) => {
      if (text.includes('where idempotency_key')) return [];
      if (text.includes('from verification_events')) return [caseRow];
      if (text.includes('from message_deletion_jobs')) return [failedBanJob];
      if (text.includes('select id::text from moderation_action_requests')) return [];
      if (text.includes('insert into moderation_action_requests')) {
        return [{ id: REQUEST_ID, messageDeletionJobId: JOB_ID, status: 'queued' }];
      }
      return [];
    });

    const state = await banCaseUserWithMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm({ mode: 'ban_with_cleanup' })
    );

    expect(state).toEqual({
      message: 'Ban and message cleanup queued.',
      requestId: REQUEST_ID,
      status: 'queued',
    });
  });

  it('allows retrying failed finalization after a completed ban and cleanup', async () => {
    mocks.getServer.mockResolvedValue({ settings: { moderator_ban_action_enabled: false } });
    const finalizationRetryJob = {
      ...readyJob,
      ban_status: 'succeeded',
      case_finalization_status: 'failed',
      mode: 'ban_with_cleanup',
      status: 'completed',
    };
    databaseClient((text) => {
      if (text.includes('where idempotency_key')) return [];
      if (text.includes('from verification_events')) return [caseRow];
      if (text.includes('from message_deletion_jobs')) return [finalizationRetryJob];
      if (text.includes('select id::text from moderation_action_requests')) return [];
      if (text.includes('insert into moderation_action_requests')) {
        return [{ id: REQUEST_ID, messageDeletionJobId: JOB_ID, status: 'queued' }];
      }
      return [];
    });

    const state = await banCaseUserWithMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm({ mode: 'ban_with_cleanup' })
    );

    expect(state).toEqual({
      message: 'Ban and message cleanup queued.',
      requestId: REQUEST_ID,
      status: 'queued',
    });
  });

  it('returns an existing completed execute receipt before mutable case or job checks', async () => {
    const { query } = databaseClient((text) => {
      if (text.includes('where idempotency_key')) {
        return [
          {
            id: REQUEST_ID,
            action_type: 'execute_case_message_deletion',
            actor_id: 'admin-1',
            message_deletion_job_id: JOB_ID,
            server_id: 'guild-1',
            status: 'completed',
            verification_event_id: CASE_ID,
          },
        ];
      }
      return [];
    });

    const state = await executeCaseMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm()
    );

    expect(state).toEqual({
      message: 'Message cleanup queued.',
      requestId: REQUEST_ID,
      status: 'completed',
    });
    const statements = query.mock.calls.map(([text]) => text as string);
    expect(statements.some((text) => text.includes('from verification_events'))).toBe(false);
    expect(statements.some((text) => text.includes('from message_deletion_jobs'))).toBe(false);
  });

  it('returns deterministic fixture receipts before UUID and database checks', async () => {
    vi.stubEnv('DRASIL_WEB_E2E_FIXTURE_MODE', 'true');

    const state = await previewCaseMessageCleanup(
      'guild-1',
      'case-stale',
      initialInboxActionState,
      cleanupForm({ jobId: 'cleanup-job-source', scope: 'source_message' })
    );

    expect(state).toEqual({
      message: 'Message cleanup preview queued.',
      requestId: 'fixture-preview_case_message_deletion-submission_123456',
      status: 'queued',
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('returns the original preview receipt for a duplicate idempotency token', async () => {
    const { query } = databaseClient((text) => {
      if (text.includes('from verification_events')) return [caseRow];
      if (text.includes('where idempotency_key')) {
        return [
          {
            id: REQUEST_ID,
            action_type: 'preview_case_message_deletion',
            actor_id: 'admin-1',
            message_deletion_job_id: JOB_ID,
            server_id: 'guild-1',
            status: 'queued',
            verification_event_id: CASE_ID,
          },
        ];
      }
      if (text.includes('from message_deletion_jobs')) return [readyJob];
      return [];
    });

    const state = await previewCaseMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm()
    );

    expect(state.requestId).toBe(REQUEST_ID);
    expect(state.status).toBe('queued');
    expect(
      query.mock.calls.some(([text]) =>
        (text as string).includes('insert into message_deletion_jobs')
      )
    ).toBe(false);
  });

  it('does not requeue a failed combined ban request', async () => {
    const combinedJob = { ...readyJob, mode: 'ban_with_cleanup' };
    const { query } = databaseClient((text) => {
      if (text.includes('from verification_events')) return [caseRow];
      if (text.includes('from message_deletion_jobs')) return [combinedJob];
      if (text.includes('where idempotency_key')) {
        return [
          {
            id: REQUEST_ID,
            action_type: 'ban_case_user_with_message_cleanup',
            actor_id: 'admin-1',
            message_deletion_job_id: JOB_ID,
            server_id: 'guild-1',
            status: 'failed',
            verification_event_id: CASE_ID,
          },
        ];
      }
      return [];
    });

    const state = await banCaseUserWithMessageCleanup(
      'guild-1',
      CASE_ID,
      initialInboxActionState,
      cleanupForm({ mode: 'ban_with_cleanup' })
    );

    expect(state).toEqual({
      message: 'Ban and message cleanup queued.',
      requestId: REQUEST_ID,
      status: 'failed',
    });
    expect(query.mock.calls.some(([text]) => (text as string).startsWith('update'))).toBe(false);
  });
});
