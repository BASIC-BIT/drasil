import { VerificationHistoryFormatter } from '../../utils/VerificationHistoryFormatter';
import {
  AdminAction,
  AdminActionType,
  VerificationEventWithActions,
  VerificationStatus,
} from '../../repositories/types';

const buildAction = (overrides: Partial<AdminAction> = {}): AdminAction => ({
  id: 'action-1',
  server_id: 'server-1',
  user_id: 'user-1',
  admin_id: 'admin-1',
  verification_event_id: 'event-1',
  detection_event_id: null,
  action_type: AdminActionType.VERIFY,
  action_at: new Date('2024-01-02T00:00:00.000Z'),
  previous_status: VerificationStatus.PENDING,
  new_status: VerificationStatus.VERIFIED,
  notes: 'Looks good',
  metadata: null,
  ...overrides,
});

const buildEvent = (
  overrides: Partial<Omit<VerificationEventWithActions, 'actions'>> = {},
  actions: AdminAction[] = []
): VerificationEventWithActions => ({
  id: 'event-1',
  server_id: 'server-1',
  user_id: 'user-1',
  detection_event_id: null,
  thread_id: 'thread-1',
  private_evidence_thread_id: null,
  notification_message_id: 'notif-1',
  status: VerificationStatus.VERIFIED,
  created_at: new Date('2024-01-01T00:00:00.000Z'),
  updated_at: new Date('2024-01-01T00:00:00.000Z'),
  resolved_at: new Date('2024-01-02T00:00:00.000Z'),
  resolved_by: 'admin-1',
  notes: null,
  metadata: null,
  actions,
  ...overrides,
  notification_channel_id: overrides.notification_channel_id ?? null,
});

describe('VerificationHistoryFormatter (unit)', () => {
  it('formats verification history with actions', () => {
    const action = buildAction();
    const event = buildEvent({}, [action]);

    const output = VerificationHistoryFormatter.formatForDiscord([event], 'user-1');

    expect(output).toContain('Verification History for <@user-1>');
    expect(output).toContain('Status: verified');
    expect(output).toContain('Thread: <#thread-1>');
    expect(output).toContain('Verified by <@admin-1>');
    expect(output).toContain('Status changed from pending to verified');
    expect(output).toContain('Notes: Looks good');
  });

  it('formats observed admin actions without verification status changes', () => {
    const actions = [
      buildAction({
        id: 'action-open-case',
        action_type: AdminActionType.OPEN_CASE,
        previous_status: null,
        new_status: VerificationStatus.PENDING,
        notes: null,
      }),
      buildAction({
        id: 'action-restrict',
        action_type: AdminActionType.RESTRICT,
        previous_status: null,
        new_status: null,
        notes: null,
      }),
      buildAction({
        id: 'action-dismiss',
        action_type: AdminActionType.DISMISS,
        previous_status: null,
        new_status: null,
        notes: null,
      }),
      buildAction({
        id: 'action-false-positive',
        action_type: AdminActionType.FALSE_POSITIVE,
        previous_status: null,
        new_status: null,
        notes: null,
      }),
    ];
    const event = buildEvent({}, actions);

    const output = VerificationHistoryFormatter.formatForDiscord([event], 'user-1');

    expect(output).toContain('Verification case opened by <@admin-1>');
    expect(output).toContain('Case role applied by <@admin-1>');
    expect(output).toContain('Dismissed by <@admin-1>');
    expect(output).toContain('Marked false positive by <@admin-1>');
    expect(output).not.toContain('Status changed');
  });
});
