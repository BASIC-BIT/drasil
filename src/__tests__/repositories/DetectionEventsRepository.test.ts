import {
  DetectionEventsRepository,
  IDetectionEventsRepository,
} from '../../repositories/DetectionEventsRepository';
import { DetectionEvent } from '../../repositories/types';
import { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { TYPES } from '../../di/symbols';
import { createServiceTestContainer, createMocks } from '../utils/test-container';
import { Container } from 'inversify';

describe('DetectionEventsRepository', () => {
  let container: Container;
  let repository: IDetectionEventsRepository;
  let mocks: ReturnType<typeof createMocks>;

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
    // Create mocks
    mocks = createMocks();

    // Create container with real DetectionEventsRepository and mocked Supabase client
    container = createServiceTestContainer(
      TYPES.DetectionEventsRepository,
      DetectionEventsRepository,
      {
        mockSupabaseClient: mocks.mockSupabaseClient as unknown as SupabaseClient,
      }
    );

    // Get the repository from the container
    repository = container.get<IDetectionEventsRepository>(TYPES.DetectionEventsRepository);

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

      // Set up chained mock methods
      const mockResult = {
        data: mockEvents,
        error: null,
      };

      const mockOrder = jest.fn().mockResolvedValue(mockResult);
      const mockEq2 = jest.fn().mockReturnValue({ order: mockOrder });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findByServerAndUser('server1', 'user1');
      expect(result).toEqual(mockEvents);
      expect(mockFrom).toHaveBeenCalledWith('detection_events');
    });

    it('should handle errors gracefully', async () => {
      const mockError = {
        message: 'Database error',
        details: '',
        hint: '',
        code: 'PGRST301',
      } as PostgrestError;

      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: mockError,
      };

      const mockOrder = jest.fn().mockResolvedValue(mockResult);
      const mockEq2 = jest.fn().mockReturnValue({ order: mockOrder });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      await expect(repository.findByServerAndUser('server1', 'user1')).rejects.toThrow(
        /Database error/
      );
    });
  });

  describe('findRecentByServer', () => {
    it('should find recent detection events for a server', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: [mockEvent],
        error: null,
      };

      const mockLimit = jest.fn().mockResolvedValue(mockResult);
      const mockOrder = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findRecentByServer('server1', 10);
      expect(result).toEqual([mockEvent]);
    });
  });

  describe('recordAdminAction', () => {
    it('should record an admin action on a detection event', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: { ...mockEvent, admin_action: 'Verified', admin_action_by: 'admin1' },
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq = jest.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ update: mockUpdate });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

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

      // Set up chained mock methods
      const mockResult = {
        data: mockEvents,
        error: null,
      };

      const mockLte = jest.fn().mockResolvedValue(mockResult);
      const mockGte = jest.fn().mockReturnValue({ lte: mockLte });
      const mockEq = jest.fn().mockReturnValue({ gte: mockGte });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

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
      // Set up chained mock methods
      const mockResult = {
        count: 2,
        data: [mockEvent, mockEvent],
        error: null,
      };

      const mockLt = jest.fn().mockResolvedValue(mockResult);
      const mockDelete = jest.fn().mockReturnValue({ lt: mockLt });
      const mockFrom = jest.fn().mockReturnValue({ delete: mockDelete });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.cleanupOldEvents(30);
      expect(result).toBe(mockResult.count);
    });
  });
});
