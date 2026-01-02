import { DetectionHistoryFormatter } from '../../utils/DetectionHistoryFormatter';
import { DetectionEvent, DetectionType } from '../../repositories/types';

describe('DetectionHistoryFormatter (unit)', () => {
  it('orders events by most recent first and includes message details', () => {
    const events: DetectionEvent[] = [
      {
        id: 'event-1',
        server_id: 'server-1',
        user_id: 'user-1',
        detection_type: DetectionType.MESSAGE_FREQUENCY,
        confidence: 0.4,
        reasons: ['Frequency'],
        detected_at: new Date('2024-01-01T00:00:00.000Z'),
        thread_id: null,
        message_id: null,
        channel_id: null,
        metadata: {},
      },
      {
        id: 'event-2',
        server_id: 'server-1',
        user_id: 'user-1',
        detection_type: DetectionType.SUSPICIOUS_CONTENT,
        confidence: 0.9,
        reasons: ['Keyword'],
        detected_at: new Date('2024-01-02T00:00:00.000Z'),
        thread_id: null,
        message_id: 'msg-1',
        channel_id: 'chan-1',
        metadata: { content: 'free discord nitro' },
      },
    ];

    const output = DetectionHistoryFormatter.formatHistory('user-1', events, 'server-1');

    expect(output).toContain('Detection History for User <@user-1>');
    expect(output.indexOf('Type: suspicious_content')).toBeLessThan(
      output.indexOf('Type: message_frequency')
    );
    expect(output).toContain('Message Link: https://discord.com/channels/server-1/chan-1/msg-1');
    expect(output).toContain('Message Content: free discord nitro');
  });
});
