import { UserRepository, IUserRepository } from '../UserRepository';
import { User } from '../types';
import { SupabaseClient } from '@supabase/supabase-js';
import { TYPES } from '../../di/symbols';
import { createServiceTestContainer, createMocks } from '../../__tests__/utils/test-container';
import { Container } from 'inversify';

describe('UserRepository', () => {
  let container: Container;
  let repository: IUserRepository;
  let mocks: ReturnType<typeof createMocks>;

  const mockUser: User = {
    discord_id: 'discord-123',
    username: 'TestUser',
    global_reputation_score: 0.5,
    account_created_at: '2023-01-01T00:00:00Z',
    metadata: { flags: [] },
  };

  beforeEach(() => {
    // Create mocks
    mocks = createMocks();

    // Create container with real UserRepository and mocked Supabase client
    container = createServiceTestContainer(TYPES.UserRepository, UserRepository, {
      mockSupabaseClient: mocks.mockSupabaseClient as unknown as SupabaseClient,
    });

    // Get the repository from the container
    repository = container.get<IUserRepository>(TYPES.UserRepository);

    jest.clearAllMocks();
  });

  describe('findByDiscordId', () => {
    it('should find a user by Discord ID', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: mockUser,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findByDiscordId(mockUser.discord_id);

      expect(result).toEqual(mockUser);
      expect(mockFrom).toHaveBeenCalledWith('users');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('discord_id', mockUser.discord_id);
    });

    it('should return null when user not found', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { code: 'PGRST116' },
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findByDiscordId('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { message: 'Database error' },
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      await expect(repository.findByDiscordId(mockUser.discord_id)).rejects.toThrow();
    });
  });

  describe('upsertByDiscordId', () => {
    it('should update an existing user', async () => {
      const updatedUser = { ...mockUser, username: 'UpdatedUser' };

      // Set up chained mock methods
      const mockResult = {
        data: updatedUser,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockUpsert = jest.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = jest.fn().mockReturnValue({ upsert: mockUpsert });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.upsertByDiscordId(mockUser.discord_id, {
        username: 'UpdatedUser',
      });

      expect(result).toEqual(updatedUser);
      expect(mockFrom).toHaveBeenCalledWith('users');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          discord_id: mockUser.discord_id,
          username: 'UpdatedUser',
        }),
        { onConflict: 'discord_id' }
      );
    });

    it('should create a new user when not found', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: mockUser,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockUpsert = jest.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = jest.fn().mockReturnValue({ upsert: mockUpsert });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.upsertByDiscordId('new-discord-id', {
        username: 'NewUser',
      });

      expect(result).toEqual(mockUser);
      expect(mockFrom).toHaveBeenCalledWith('users');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          discord_id: 'new-discord-id',
          username: 'NewUser',
        }),
        { onConflict: 'discord_id' }
      );
    });
  });

  describe('updateReputationScore', () => {
    it("should update a user's reputation score", async () => {
      const updatedUser = { ...mockUser, global_reputation_score: 0.8 };

      // Set up chained mock methods
      const mockResult = {
        data: updatedUser,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq = jest.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ update: mockUpdate });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.updateReputationScore(mockUser.discord_id, 0.8);

      expect(result).toEqual(updatedUser);
      expect(mockFrom).toHaveBeenCalledWith('users');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          global_reputation_score: 0.8,
        })
      );
      expect(mockEq).toHaveBeenCalledWith('discord_id', mockUser.discord_id);
    });

    it('should handle database errors', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { message: 'Database error' },
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq = jest.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ update: mockUpdate });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      await expect(repository.updateReputationScore(mockUser.discord_id, 0.8)).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('findByReputationBelow', () => {
    it('should find users with reputation below threshold', async () => {
      const lowRepUsers = [
        { ...mockUser, global_reputation_score: 0.3 },
        { ...mockUser, discord_id: 'discord-456', global_reputation_score: 0.2 },
      ];

      // Set up chained mock methods
      const mockResult = {
        data: lowRepUsers,
        error: null,
      };

      const mockLt = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ lt: mockLt });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findByReputationBelow(0.4);

      expect(result).toEqual(lowRepUsers);
      expect(mockFrom).toHaveBeenCalledWith('users');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockLt).toHaveBeenCalledWith('global_reputation_score', 0.4);
    });

    it('should handle database errors', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { message: 'Database error' },
      };

      const mockLt = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ lt: mockLt });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      await expect(repository.findByReputationBelow(0.4)).rejects.toThrow('Database error');
    });
  });
});
