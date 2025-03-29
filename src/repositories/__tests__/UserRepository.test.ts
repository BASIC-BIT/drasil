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

  describe('incrementSuspiciousServerCount', () => {
    it('should increment the suspicious server count', async () => {
      const initialUser = {
        ...mockUser,
        suspicious_server_count: 1,
      };
      const updatedUser = {
        ...initialUser,
        suspicious_server_count: 2,
      };

      // Mock findByDiscordId to return the user first
      const mockFindResult = {
        data: initialUser,
        error: null,
      };

      const mockFindSingle = jest.fn().mockResolvedValue(mockFindResult);
      const mockFindEq = jest.fn().mockReturnValue({ single: mockFindSingle });
      const mockFindSelect = jest.fn().mockReturnValue({ eq: mockFindEq });
      const mockFindFrom = jest.fn().mockReturnValue({ select: mockFindSelect });

      // Mock the update operation
      const mockUpdateResult = {
        data: updatedUser,
        error: null,
      };

      const mockUpdateSingle = jest.fn().mockResolvedValue(mockUpdateResult);
      const mockUpdateSelect = jest.fn().mockReturnValue({ single: mockUpdateSingle });
      const mockUpdateEq = jest.fn().mockReturnValue({ select: mockUpdateSelect });
      const mockUpdateUpdate = jest.fn().mockReturnValue({ eq: mockUpdateEq });

      // Set up the mocks for from method, first return the find mock, then the update mock
      mocks.mockSupabaseClient!.from = mockFindFrom
        .mockReturnValueOnce({ select: mockFindSelect })
        .mockReturnValueOnce({ update: mockUpdateUpdate });

      const result = await repository.incrementSuspiciousServerCount(mockUser.discord_id);

      expect(result).toEqual(updatedUser);
      expect(mockFindFrom).toHaveBeenNthCalledWith(1, 'users');
      expect(mockFindSelect).toHaveBeenCalledWith('*');
      expect(mockFindEq).toHaveBeenCalledWith('discord_id', mockUser.discord_id);
      expect(mockFindFrom).toHaveBeenNthCalledWith(2, 'users');
      expect(mockUpdateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          suspicious_server_count: 2,
          updated_at: expect.any(String),
        })
      );
      expect(mockUpdateEq).toHaveBeenCalledWith('discord_id', mockUser.discord_id);
    });

    it('should return null when user not found', async () => {
      // Mock findByDiscordId to return null
      const mockFindResult = {
        data: null,
        error: { code: 'PGRST116' },
      };

      const mockFindSingle = jest.fn().mockResolvedValue(mockFindResult);
      const mockFindEq = jest.fn().mockReturnValue({ single: mockFindSingle });
      const mockFindSelect = jest.fn().mockReturnValue({ eq: mockFindEq });
      const mockFindFrom = jest.fn().mockReturnValue({ select: mockFindSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFindFrom;

      const result = await repository.incrementSuspiciousServerCount('nonexistent');

      expect(result).toBeNull();
      expect(mockFindFrom).toHaveBeenCalledWith('users');
      expect(mockFindSelect).toHaveBeenCalledWith('*');
      expect(mockFindEq).toHaveBeenCalledWith('discord_id', 'nonexistent');
    });

    it('should handle database errors', async () => {
      // Mock findByDiscordId to throw an error
      const mockFindResult = {
        data: null,
        error: { message: 'Database error' },
      };

      const mockFindSingle = jest.fn().mockResolvedValue(mockFindResult);
      const mockFindEq = jest.fn().mockReturnValue({ single: mockFindSingle });
      const mockFindSelect = jest.fn().mockReturnValue({ eq: mockFindEq });
      const mockFindFrom = jest.fn().mockReturnValue({ select: mockFindSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFindFrom;

      await expect(
        repository.incrementSuspiciousServerCount(mockUser.discord_id)
      ).rejects.toThrow();
    });
  });

  describe('decrementSuspiciousServerCount', () => {
    it('should decrement the suspicious server count', async () => {
      const initialUser = {
        ...mockUser,
        suspicious_server_count: 2,
      };
      const updatedUser = {
        ...initialUser,
        suspicious_server_count: 1,
      };

      // Mock findByDiscordId to return the user first
      const mockFindResult = {
        data: initialUser,
        error: null,
      };

      const mockFindSingle = jest.fn().mockResolvedValue(mockFindResult);
      const mockFindEq = jest.fn().mockReturnValue({ single: mockFindSingle });
      const mockFindSelect = jest.fn().mockReturnValue({ eq: mockFindEq });
      const mockFindFrom = jest.fn().mockReturnValue({ select: mockFindSelect });

      // Mock the update operation
      const mockUpdateResult = {
        data: updatedUser,
        error: null,
      };

      const mockUpdateSingle = jest.fn().mockResolvedValue(mockUpdateResult);
      const mockUpdateSelect = jest.fn().mockReturnValue({ single: mockUpdateSingle });
      const mockUpdateEq = jest.fn().mockReturnValue({ select: mockUpdateSelect });
      const mockUpdateUpdate = jest.fn().mockReturnValue({ eq: mockUpdateEq });

      // Set up the mocks for from method, first return the find mock, then the update mock
      mocks.mockSupabaseClient!.from = mockFindFrom
        .mockReturnValueOnce({ select: mockFindSelect })
        .mockReturnValueOnce({ update: mockUpdateUpdate });

      const result = await repository.decrementSuspiciousServerCount(mockUser.discord_id);

      expect(result).toEqual(updatedUser);
      expect(mockFindFrom).toHaveBeenNthCalledWith(1, 'users');
      expect(mockFindSelect).toHaveBeenCalledWith('*');
      expect(mockFindEq).toHaveBeenCalledWith('discord_id', mockUser.discord_id);
      expect(mockFindFrom).toHaveBeenNthCalledWith(2, 'users');
      expect(mockUpdateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          suspicious_server_count: 1,
          updated_at: expect.any(String),
        })
      );
    });

    it('should not decrement below zero', async () => {
      const initialUser = {
        ...mockUser,
        suspicious_server_count: 0,
      };
      const updatedUser = {
        ...initialUser,
        suspicious_server_count: 0,
      };

      // Mock findByDiscordId to return the user first
      const mockFindResult = {
        data: initialUser,
        error: null,
      };

      const mockFindSingle = jest.fn().mockResolvedValue(mockFindResult);
      const mockFindEq = jest.fn().mockReturnValue({ single: mockFindSingle });
      const mockFindSelect = jest.fn().mockReturnValue({ eq: mockFindEq });
      const mockFindFrom = jest.fn().mockReturnValue({ select: mockFindSelect });

      // Mock the update operation
      const mockUpdateResult = {
        data: updatedUser,
        error: null,
      };

      const mockUpdateSingle = jest.fn().mockResolvedValue(mockUpdateResult);
      const mockUpdateSelect = jest.fn().mockReturnValue({ single: mockUpdateSingle });
      const mockUpdateEq = jest.fn().mockReturnValue({ select: mockUpdateSelect });
      const mockUpdateUpdate = jest.fn().mockReturnValue({ eq: mockUpdateEq });

      // Set up the mocks for from method, first return the find mock, then the update mock
      mocks.mockSupabaseClient!.from = mockFindFrom
        .mockReturnValueOnce({ select: mockFindSelect })
        .mockReturnValueOnce({ update: mockUpdateUpdate });

      const result = await repository.decrementSuspiciousServerCount(mockUser.discord_id);

      expect(result).toEqual(updatedUser);
      expect(mockFindFrom).toHaveBeenNthCalledWith(1, 'users');
      expect(mockFindSelect).toHaveBeenCalledWith('*');
      expect(mockFindEq).toHaveBeenCalledWith('discord_id', mockUser.discord_id);
      expect(mockUpdateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          suspicious_server_count: 0,
          updated_at: expect.any(String),
        })
      );
    });
  });

  describe('setFirstFlagged', () => {
    it('should set the first flagged timestamp', async () => {
      const timestamp = '2024-03-27T12:00:00Z';
      const updatedUser = {
        ...mockUser,
        first_flagged_at: timestamp,
      };

      // Mock finding the user first
      const mockFindResult = {
        data: mockUser,
        error: null,
      };

      const mockFindSingle = jest.fn().mockResolvedValue(mockFindResult);
      const mockFindEq = jest.fn().mockReturnValue({ single: mockFindSingle });
      const mockFindSelect = jest.fn().mockReturnValue({ eq: mockFindEq });
      const mockFindFrom = jest.fn().mockReturnValue({ select: mockFindSelect });

      // Mock the update operation
      const mockUpdateResult = {
        data: updatedUser,
        error: null,
      };

      const mockUpdateSingle = jest.fn().mockResolvedValue(mockUpdateResult);
      const mockUpdateSelect = jest.fn().mockReturnValue({ single: mockUpdateSingle });
      const mockUpdateEq = jest.fn().mockReturnValue({ select: mockUpdateSelect });
      const mockUpdateUpdate = jest.fn().mockReturnValue({ eq: mockUpdateEq });

      // Set up the mocks for from method, first return the find mock, then the update mock
      mocks.mockSupabaseClient!.from = mockFindFrom
        .mockReturnValueOnce({ select: mockFindSelect })
        .mockReturnValueOnce({ update: mockUpdateUpdate });

      const result = await repository.setFirstFlagged(mockUser.discord_id, timestamp);

      expect(result).toEqual(updatedUser);
      expect(mockFindFrom).toHaveBeenNthCalledWith(1, 'users');
      expect(mockFindSelect).toHaveBeenCalledWith('*');
      expect(mockFindEq).toHaveBeenCalledWith('discord_id', mockUser.discord_id);
      expect(mockFindFrom).toHaveBeenNthCalledWith(2, 'users');
      expect(mockUpdateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          first_flagged_at: timestamp,
          updated_at: expect.any(String),
        })
      );
      expect(mockUpdateEq).toHaveBeenCalledWith('discord_id', mockUser.discord_id);
    });

    it('should use the current time if no timestamp provided', async () => {
      const updatedUser = {
        ...mockUser,
        first_flagged_at: expect.any(String),
      };

      // Mock finding the user first
      const mockFindResult = {
        data: mockUser,
        error: null,
      };

      const mockFindSingle = jest.fn().mockResolvedValue(mockFindResult);
      const mockFindEq = jest.fn().mockReturnValue({ single: mockFindSingle });
      const mockFindSelect = jest.fn().mockReturnValue({ eq: mockFindEq });
      const mockFindFrom = jest.fn().mockReturnValue({ select: mockFindSelect });

      // Mock the update operation
      const mockUpdateResult = {
        data: updatedUser,
        error: null,
      };

      const mockUpdateSingle = jest.fn().mockResolvedValue(mockUpdateResult);
      const mockUpdateSelect = jest.fn().mockReturnValue({ single: mockUpdateSingle });
      const mockUpdateEq = jest.fn().mockReturnValue({ select: mockUpdateSelect });
      const mockUpdateUpdate = jest.fn().mockReturnValue({ eq: mockUpdateEq });

      // Set up the mocks for from method, first return the find mock, then the update mock
      mocks.mockSupabaseClient!.from = mockFindFrom
        .mockReturnValueOnce({ select: mockFindSelect })
        .mockReturnValueOnce({ update: mockUpdateUpdate });

      const result = await repository.setFirstFlagged(mockUser.discord_id);

      expect(result).toEqual(updatedUser);
      expect(mockUpdateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          first_flagged_at: expect.any(String),
          updated_at: expect.any(String),
        })
      );
      expect(mockUpdateEq).toHaveBeenCalledWith('discord_id', mockUser.discord_id);
    });
  });

  describe('findUsersFlaggedInMultipleServers', () => {
    it('should find users flagged in multiple servers', async () => {
      const flaggedUsers = [
        { ...mockUser, suspicious_server_count: 3 },
        { ...mockUser, discord_id: 'discord-456', suspicious_server_count: 2 },
      ];

      // Set up chained mock methods
      const mockResult = {
        data: flaggedUsers,
        error: null,
      };

      const mockGte = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ gte: mockGte });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findUsersFlaggedInMultipleServers(2);

      expect(result).toEqual(flaggedUsers);
      expect(mockFrom).toHaveBeenCalledWith('users');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockGte).toHaveBeenCalledWith('suspicious_server_count', 2);
    });

    it('should use default threshold of 2', async () => {
      const flaggedUsers = [
        { ...mockUser, suspicious_server_count: 3 },
        { ...mockUser, discord_id: 'discord-456', suspicious_server_count: 2 },
      ];

      // Set up chained mock methods
      const mockResult = {
        data: flaggedUsers,
        error: null,
      };

      const mockGte = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ gte: mockGte });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findUsersFlaggedInMultipleServers();

      expect(result).toEqual(flaggedUsers);
      expect(mockGte).toHaveBeenCalledWith('suspicious_server_count', 2);
    });

    it('should handle database errors', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { message: 'Database error' },
      };

      const mockGte = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ gte: mockGte });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      await expect(repository.findUsersFlaggedInMultipleServers()).rejects.toThrow(
        'Database error'
      );
    });
  });
});
