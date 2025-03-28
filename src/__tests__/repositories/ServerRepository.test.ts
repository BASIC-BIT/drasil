import { ServerRepository, IServerRepository } from '../../repositories/ServerRepository';
import { Server } from '../../repositories/types';
import { TYPES } from '../../di/symbols';
import { createServiceTestContainer, createMocks } from '../utils/test-container';
import { Container } from 'inversify';
import { SupabaseClient } from '@supabase/supabase-js';

describe('ServerRepository', () => {
  let container: Container;
  let repository: IServerRepository;
  let mocks: ReturnType<typeof createMocks>;

  const mockServer: Server = {
    guild_id: '123456789012345678',
    restricted_role_id: '123456789012345679',
    admin_channel_id: '123456789012345680',
    verification_channel_id: '123456789012345681',
    admin_notification_role_id: '123456789012345682',
    created_at: '2023-01-01T00:00:00.000Z',
    updated_at: '2023-01-01T00:00:00.000Z',
    is_active: true,
    settings: {
      message_threshold: 5,
      message_timeframe: 10,
      suspicious_keywords: ['free nitro', 'discord nitro'],
      min_confidence_threshold: 70,
      auto_restrict: true,
      use_gpt_on_join: true,
      gpt_message_check_count: 3,
      message_retention_days: 7,
      detection_retention_days: 30,
    },
  };

  beforeEach(() => {
    // Create mocks
    mocks = createMocks();

    // Create container with real ServerRepository and mocked Supabase client
    container = createServiceTestContainer(TYPES.ServerRepository, ServerRepository, {
      mockSupabaseClient: mocks.mockSupabaseClient as unknown as SupabaseClient,
    });

    // Get the repository from the container
    repository = container.get<IServerRepository>(TYPES.ServerRepository);
  });

  describe('findByGuildId', () => {
    it('should find a server by guild ID', async () => {
      // Setup the mock to return our test server
      const mockResult = {
        data: mockServer,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      // Call the repository method
      const result = await repository.findByGuildId(mockServer.guild_id);

      // Verify the result is as expected
      expect(result).toEqual(mockServer);

      // Verify the Supabase client was called correctly
      expect(mockFrom).toHaveBeenCalledWith('servers');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('guild_id', mockServer.guild_id);
      expect(mockSingle).toHaveBeenCalled();
    });

    it('should return null when server not found', async () => {
      // Setup the mock to return null data
      const mockResult = {
        data: null,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      // Call the repository method
      const result = await repository.findByGuildId('nonexistent-guild');

      // Verify the result is null
      expect(result).toBeNull();
    });

    it('should handle errors correctly', async () => {
      // Setup the mock to throw an error
      const mockError = new Error('Database error');
      const mockResult = {
        data: null,
        error: mockError,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      // Expect the method to throw an error
      await expect(repository.findByGuildId('error-guild')).rejects.toThrow();
    });
  });

  // Additional tests for other methods would go here
});
