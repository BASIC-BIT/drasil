import { createReportActions, type ReportActions } from './actions';
import type { ReportDependencies, ReportIntakeState } from './ports';
import type { ActionContext } from '../context';
import type { AuthorityFacts } from '../authorization';

const context: ActionContext = {
  guildId: 'guild',
  requestId: 'request',
  source: 'discord_interaction',
  actor: { kind: 'user', userId: 'reporter' },
};
function fixture(): {
  deps: ReportDependencies;
  intake: ReportIntakeState;
  actions: ReportActions;
  submissionCount: () => number;
} {
  const intake: ReportIntakeState = {
    id: 'intake',
    guildId: 'guild',
    reporterId: 'reporter',
    threadId: 'thread',
    status: 'needs_reporter_confirmation',
    confirmedTargetUserId: null,
    promptMessageId: 'current',
    promptToken: 'token',
    candidateIds: ['target'],
    claimed: false,
  };
  let submissions = 0;
  const deps: ReportDependencies = {
    authority: {
      loadFresh: async (guildId, userId) => ({
        guildId,
        userId,
        present: true,
        owner: false,
        permissions: '0',
        roleIds: [],
      }),
    },
    settings: { loadFresh: async () => ({ reasonRequired: false, staffRoleIds: ['staff'] }) },
    intakes: {
      load: async () => intake,
      findOpen: async () => null,
      open: async () => intake,
      markOpenFailed: async () => {},
      confirm: async () => {
        intake.confirmedTargetUserId = 'target';
        return {
          confirmed: true,
          message: 'Confirmed',
          reason: 'Evidence',
          reporterId: 'reporter',
        };
      },
      reject: async () => ({ rejected: true, message: 'Rejected' }),
      close: async () => ({
        closed: true,
        message: 'Report submitted.',
        shouldArchiveThread: true,
      }),
      markSubmitted: async () => true,
    },
    threads: {
      notifySubmitted: async () => {},
      prepareClose: async () => ({
        finish: async (result) => ({ archived: true, message: result.message }),
      }),
      create: async () => ({ id: 'thread', url: 'url' }),
      activate: async () => true,
      deleteFailed: async () => {},
      notifyOpened: async () => {},
    },
    submissions: {
      user: async () => ({ status: 'submitted', targetUserId: 'target' }),
      message: async () => {
        submissions++;
        return { status: 'submitted' };
      },
      confirmed: async (_context, state) => {
        submissions++;
        return { status: 'submitted', targetUserId: state.confirmedTargetUserId! };
      },
    },
  };
  return {
    deps,
    intake,
    actions: createReportActions(deps),
    submissionCount: (): number => submissions,
  };
}
it('reporter_cannot_choose_staff_authority', async () => {
  const { actions } = fixture();
  const spoofedStaff = await actions.execute(context, {
    kind: 'close_report_intake',
    intakeId: 'intake',
    closedByStaff: true,
  } as never);
  expect(spoofedStaff).toMatchObject({ code: 'permission_denied' });
});
it('candidate_confirmation_is_bound_to_current_prompt', async () => {
  const f = fixture();
  const wrongPrompt = await f.actions.execute(context, {
    kind: 'confirm_intake_candidate',
    intakeId: 'intake',
    targetUserId: 'target',
    threadId: 'thread',
    promptMessageId: 'old',
  });
  expect(wrongPrompt).toMatchObject({ code: 'confirmation_required' });
  expect(f.submissionCount()).toBe(0);
});
it('external_report_policy_is_preserved', async () => {
  const f = fixture();
  f.deps.authority.loadFresh = async (): Promise<null> => null;
  expect(
    await f.actions.execute(
      { ...context, guildId: '0' },
      {
        kind: 'submit_message_report',
        targetUserId: 'target',
        messageId: 'message',
        channelId: 'channel',
        reason: null,
      }
    )
  ).toMatchObject({ kind: 'outcome', outcome: { status: 'submitted' } });
  expect(f.submissionCount()).toBe(1);
});
it('report_claim_blocks_conflicting_closure', async () => {
  const f = fixture();
  f.intake.claimed = true;
  const claimedClosure = await f.actions.execute(context, {
    kind: 'close_report_intake',
    intakeId: 'intake',
  });
  expect(claimedClosure).toMatchObject({ outcome: { status: 'busy' } });
});
it('reporter can close a submitted intake without current membership or submission policy', async () => {
  const f = fixture();
  f.intake.status = 'submitted';
  f.deps.authority.loadFresh = async (): Promise<null> => null;
  f.deps.settings.loadFresh = async (): Promise<never> => {
    throw new Error('Closure must not need submission settings');
  };
  expect(
    await f.actions.execute(context, { kind: 'close_report_intake', intakeId: 'intake' })
  ).toMatchObject({ outcome: { status: 'closed', result: { message: 'Report submitted.' } } });
});
it('confirmed submission uses stored target and reporter', async () => {
  const f = fixture();
  expect(
    await f.actions.execute(context, {
      kind: 'confirm_intake_candidate',
      intakeId: 'intake',
      targetUserId: 'target',
      threadId: 'thread',
      promptMessageId: 'current',
    })
  ).toMatchObject({
    outcome: { status: 'submitted', targetUserId: 'target', statusRecorded: true },
  });
  expect(f.submissionCount()).toBe(1);
});
it('current configured staff roles can close another reporter intake', async () => {
  const f = fixture();
  f.deps.authority.loadFresh = async (guildId, userId): Promise<AuthorityFacts> => ({
    guildId,
    userId,
    present: true,
    owner: false,
    permissions: '0',
    roleIds: ['staff'],
  });
  expect(
    await f.actions.execute(
      { ...context, actor: { kind: 'user', userId: 'staff-user' } },
      { kind: 'close_report_intake', intakeId: 'intake' }
    )
  ).toMatchObject({ outcome: { status: 'closed' } });
});
it('changed reason policy blocks user report before submission', async () => {
  const f = fixture();
  f.deps.settings.loadFresh = async (): ReturnType<
    ReportDependencies['settings']['loadFresh']
  > => ({ reasonRequired: true, staffRoleIds: [] });
  expect(
    await f.actions.execute(context, {
      kind: 'submit_user_report',
      targetUserId: 'target',
      targetLabel: 'target',
      reason: null,
    })
  ).toMatchObject({ code: 'reason_required' });
});
it('a failed activation deletes the created thread and records failure', async () => {
  const f = fixture();
  const events: string[] = [];
  f.deps.threads.activate = async (): Promise<boolean> => false;
  f.deps.intakes.markOpenFailed = async (): Promise<void> => {
    events.push('failed');
  };
  f.deps.threads.deleteFailed = async (): Promise<void> => {
    events.push('deleted');
  };
  expect(
    await f.actions.execute(context, { kind: 'start_report_intake', channelId: 'channel' })
  ).toMatchObject({ outcome: { status: 'activation_failed' } });
  expect(events).toEqual(['failed', 'deleted']);
});
it('a claim acquired during closure is reported as busy without thread effects', async () => {
  const f = fixture();
  let effects = 0;
  f.deps.intakes.close = async (): ReturnType<ReportDependencies['intakes']['close']> => {
    f.intake.claimed = true;
    return { closed: false, message: 'The report changed. Please try closing it again.' };
  };
  f.deps.threads.prepareClose = async (): ReturnType<
    ReportDependencies['threads']['prepareClose']
  > => ({
    finish: async (): Promise<{ archived: boolean; message: string }> => {
      effects++;
      return { archived: true, message: 'closed' };
    },
  });
  expect(
    await f.actions.execute(context, { kind: 'close_report_intake', intakeId: 'intake' })
  ).toMatchObject({ outcome: { status: 'busy' } });
  expect(effects).toBe(0);
});
it('submission trusts the stored reporter rather than the confirmation payload reporter', async () => {
  const f = fixture();
  let reporter: string | null = null;
  f.deps.intakes.confirm = async (): ReturnType<ReportDependencies['intakes']['confirm']> => {
    f.intake.confirmedTargetUserId = 'target';
    return {
      confirmed: true,
      message: 'Confirmed',
      reason: 'Evidence',
      reporterId: 'model-selected-actor',
    };
  };
  f.deps.submissions.confirmed = async (
    _context,
    intake
  ): ReturnType<ReportDependencies['submissions']['confirmed']> => {
    reporter = intake.reporterId;
    return { status: 'submitted', targetUserId: 'target' };
  };
  await f.actions.execute(context, {
    kind: 'confirm_intake_candidate',
    intakeId: 'intake',
    threadId: 'thread',
    promptMessageId: 'current',
    targetUserId: 'target',
  });
  expect(reporter).toBe('reporter');
});
it('a changed persisted target prevents submission of the command target', async () => {
  const f = fixture();
  f.deps.intakes.confirm = async (): ReturnType<ReportDependencies['intakes']['confirm']> => {
    f.intake.confirmedTargetUserId = 'another-target';
    return { confirmed: true, message: 'Confirmed', reason: 'Evidence' };
  };
  expect(
    await f.actions.execute(context, {
      kind: 'confirm_intake_candidate',
      intakeId: 'intake',
      threadId: 'thread',
      promptMessageId: 'current',
      targetUserId: 'target',
    })
  ).toMatchObject({ code: 'stale_state' });
  expect(f.submissionCount()).toBe(0);
});
