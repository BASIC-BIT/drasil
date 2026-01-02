import { VerificationHistoryFormatter } from '../../utils/VerificationHistoryFormatter';
import {
  AdminAction,
  AdminActionType,
  VerificationEventWithActions,
  VerificationStatus,
} from '../../repositories/types';

describe('VerificationHistoryFormatter (unit)', () => {
  it('formats verification history with actions', () => {
    const action: AdminAction = {
      id: 'action-1',
      server_id: 'server-1',
      user_id: 'user-1',
      admin_id: 'admin-1',
      verification_event_id: 'event-1',
      action_type: AdminActionType.VERIFY,
      action_at: new Date('2024-01-02T00:00:00.000Z'),
      previous_status: VerificationStatus.PENDING,
      new_status: VerificationStatus.VERIFIED,
      notes: 'Looks good',
      metadata: null,
    };

    const event: VerificationEventWithActions = {
      id: 'event-1',
      server_id: 'server-1',
      user_id: 'user-1',
      detection_event_id: null,
      thread_id: 'thread-1',
      notification_message_id: 'notif-1',
      status: VerificationStatus.VERIFIED,
      created_at: new Date('2024-01-01T00:00:00.000Z'),
      updated_at: new Date('2024-01-01T00:00:00.000Z'),
      resolved_at: new Date('2024-01-02T00:00:00.000Z'),
      resolved_by: 'admin-1',
      notes: null,
      metadata: null,
      actions: [action],
    };

    const output = VerificationHistoryFormatter.formatForDiscord([event], 'user-1');

    expect(output).toContain('Verification History for <@user-1>');
    expect(output).toContain('Status: verified');
    expect(output).toContain('Thread: <#thread-1>');
    expect(output).toContain('Verified by <@admin-1>');
    expect(output).toContain('Status changed from pending to verified');
    expect(output).toContain('Notes: Looks good');
  });
});
