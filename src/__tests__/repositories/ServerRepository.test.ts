import { ServerRepository } from '../../repositories/ServerRepository';
import { Server } from '../../repositories/types';
import * as supabaseConfig from '../../config/supabase';

// Mock the Supabase client
jest.mock('../../config/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockReturnThis(),
  },
  isSupabaseConfigured: jest.fn().mockReturnValue(true),
}));

describe('ServerRepository', () => {
  let repository: ServerRepository;
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
    jest.clearAllMocks();
    repository = new ServerRepository();
  });

  describe('findByGuildId', () => {
    it('should find a server by guild ID', async () => {
      // Setup the mock to return our test server
      const mockSupabase = supabaseConfig.supabase as jest.Mocked<any>;
      mockSupabase.from.mockReturnThis();
      mockSupabase.select.mockReturnThis();
      mockSupabase.eq.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: mockServer,
        error: null,
      });

      // Call the repository method
      const result = await repository.findByGuildId(mockServer.guild_id);

      // Verify the result is as expected
      expect(result).toEqual(mockServer);

      // Verify the Supabase client was called correctly
      expect(mockSupabase.from).toHaveBeenCalledWith('servers');
      expect(mockSupabase.select).toHaveBeenCalledWith('*');
      expect(mockSupabase.eq).toHaveBeenCalledWith('guild_id', mockServer.guild_id);
      expect(mockSupabase.single).toHaveBeenCalled();
    });

    it('should return null when server not found', async () => {
      // Setup the mock to return null data
      const mockSupabase = supabaseConfig.supabase as jest.Mocked<any>;
      mockSupabase.from.mockReturnThis();
      mockSupabase.select.mockReturnThis();
      mockSupabase.eq.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      // Call the repository method
      const result = await repository.findByGuildId('nonexistent-guild');

      // Verify the result is null
      expect(result).toBeNull();
    });

    it('should handle errors correctly', async () => {
      // Setup the mock to throw an error
      const mockError = new Error('Database error');
      const mockSupabase = supabaseConfig.supabase as jest.Mocked<any>;
      mockSupabase.from.mockReturnThis();
      mockSupabase.select.mockReturnThis();
      mockSupabase.eq.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: mockError,
      });

      // Expect the method to throw an error
      await expect(repository.findByGuildId('error-guild')).rejects.toThrow();
    });
  });

  // Additional tests for other methods would go here
});
