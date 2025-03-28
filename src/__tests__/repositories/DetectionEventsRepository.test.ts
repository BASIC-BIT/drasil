import { DetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { DetectionEvent } from '../../repositories/types';
import { supabase } from '../../config/supabase';
import { PostgrestError } from '@supabase/supabase-js';

// Mock Supabase client
jest.mock('../../config/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

describe('DetectionEventsRepository', () => {
  let repository: DetectionEventsRepository;
  const mockEvent: DetectionEvent = {
    id: '123',
    server_id: 'server1',
    user_id: 'user1',
    message_id: 'msg1',
    detection_type: 'MESSAGE',
    confidence: 0.85,
    confidence_level: 'High',
    reasons: ['suspicious_pattern', 'new_account'],
    used_gpt: true,
    detected_at: new Date(),
    metadata: {},
  };

  beforeEach(() => {
    // Create a new repository instance
    repository = new DetectionEventsRepository();
    jest.clearAllMocks();
  });

  describe('findByServerAndUser', () => {
    it('should find detection events for a specific user in a server', async () => {
      const mockEvents = [
        {
          id: '1',
          server_id: 'server1',
          user_id: 'user1',
          detected_at: new Date().toISOString(),
        },
      ];

      const mockOrder = jest.fn().mockResolvedValue({
        data: mockEvents,
        error: null,
      });

      const mockEq2 = jest.fn().mockReturnValue({ order: mockOrder });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const result = await repository.findByServerAndUser('server1', 'user1');
      expect(result).toEqual(mockEvents);
    });

    it('should handle errors gracefully', async () => {
      const mockOrder = jest.fn().mockResolvedValue({
        data: null,
        error: {
          message: 'Database error',
          details: '',
          hint: '',
          code: 'PGRST301',
        } as PostgrestError,
      });

      const mockEq2 = jest.fn().mockReturnValue({ order: mockOrder });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      await expect(repository.findByServerAndUser('server1', 'user1')).rejects.toThrow(
        'Database error during findByServerAndUser: Database error'
      );
    });
  });

  describe('findRecentByServer', () => {
    it('should find recent detection events for a server', async () => {
      const mockLimit = jest.fn().mockResolvedValue({
        data: [mockEvent],
        error: null,
      });

      const mockOrder = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const result = await repository.findRecentByServer('server1', 10);
      expect(result).toEqual([mockEvent]);
    });
  });

  describe('recordAdminAction', () => {
    it('should record an admin action on a detection event', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: { ...mockEvent, admin_action: 'Verified', admin_action_by: 'admin1' },
        error: null,
      });

      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq = jest.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });

      (supabase.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      const result = await repository.recordAdminAction('123', 'Verified', 'admin1');
      expect(result).toMatchObject({
        ...mockEvent,
        admin_action: 'Verified',
        admin_action_by: 'admin1',
      });
    });
  });

  describe('getServerStats', () => {
    it('should return detection statistics for a server', async () => {
      const mockEvents = [
        { ...mockEvent, admin_action: 'Verified' },
        { ...mockEvent, admin_action: 'Banned' },
        { ...mockEvent, admin_action: 'Ignored' },
        { ...mockEvent },
        { ...mockEvent, used_gpt: true },
      ];

      const mockLte = jest.fn().mockResolvedValue({
        data: mockEvents,
        error: null,
      });

      const mockGte = jest.fn().mockReturnValue({ lte: mockLte });
      const mockEq = jest.fn().mockReturnValue({ gte: mockGte });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const result = await repository.getServerStats(
        'server1',
        new Date('2024-01-01'),
        new Date('2024-01-31')
      );

      expect(result).toEqual({
        total: 5,
        verified: 1,
        banned: 1,
        ignored: 1,
        pending: 2,
        gptUsage: 5,
      });
    });
  });

  describe('cleanupOldEvents', () => {
    it('should delete old detection events', async () => {
      const mockSelect = jest.fn().mockResolvedValue({
        data: [mockEvent, mockEvent],
        error: null,
      });

      const mockLt = jest.fn().mockReturnValue({ select: mockSelect });
      const mockDelete = jest.fn().mockReturnValue({ lt: mockLt });

      (supabase.from as jest.Mock).mockReturnValue({ delete: mockDelete });

      const result = await repository.cleanupOldEvents(30);
      expect(result).toBe(2);
    });
  });
});
