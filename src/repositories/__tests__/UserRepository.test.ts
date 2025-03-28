import { UserRepository } from '../UserRepository';
import { User } from '../types';
import { supabase } from '../../config/supabase';

// Mock Supabase client
jest.mock('../../config/supabase', () => ({
  supabase: {
    from: jest.fn(),
    upsert: jest.fn(),
  },
}));

describe('UserRepository', () => {
  let repository: UserRepository;
  const mockUser: User = {
    discord_id: '456789',
    username: 'testuser',
    global_reputation_score: 0.5,
    created_at: '2024-03-27T00:00:00Z',
    updated_at: '2024-03-27T00:00:00Z',
  };

  beforeEach(() => {
    repository = new UserRepository();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('findByDiscordId', () => {
    it('should return user when found', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockUser,
        error: null,
      });

      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const result = await repository.findByDiscordId(mockUser.discord_id);

      expect(result).toEqual(mockUser);
      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('discord_id', mockUser.discord_id);
    });

    it('should return null when user not found', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const result = await repository.findByDiscordId('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      await expect(repository.findByDiscordId('error-user')).rejects.toThrow('Database error');
    });
  });

  describe('upsertByDiscordId', () => {
    it('should update existing user', async () => {
      const updatedUser = { ...mockUser, username: 'newname' };

      // Mock for upsert
      const mockUpsertSingle = jest.fn().mockResolvedValue({
        data: updatedUser,
        error: null,
      });
      const mockUpsertSelect = jest.fn().mockReturnValue({ single: mockUpsertSingle });
      const mockUpsert = jest.fn().mockReturnValue({ select: mockUpsertSelect });

      // Setup supabase mock
      (supabase.from as jest.Mock).mockReturnValue({ upsert: mockUpsert });

      const result = await repository.upsertByDiscordId(mockUser.discord_id, {
        username: 'newname',
      });

      expect(result).toEqual(updatedUser);
      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          discord_id: mockUser.discord_id,
          username: 'newname',
          updated_at: expect.any(String),
        }),
        { onConflict: 'discord_id' }
      );
    });

    it('should create new user when not found', async () => {
      // Mock for upsert when creating new user
      const mockUpsertSingle = jest.fn().mockResolvedValue({
        data: mockUser,
        error: null,
      });
      const mockUpsertSelect = jest.fn().mockReturnValue({ single: mockUpsertSingle });
      const mockUpsert = jest.fn().mockReturnValue({ select: mockUpsertSelect });

      // Setup supabase mock
      (supabase.from as jest.Mock).mockReturnValue({ upsert: mockUpsert });

      const result = await repository.upsertByDiscordId('newuser', {
        username: 'newuser',
      });

      expect(result).toEqual(mockUser);
      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          discord_id: 'newuser',
          username: 'newuser',
          updated_at: expect.any(String),
        }),
        { onConflict: 'discord_id' }
      );
    });

    it('should handle database errors', async () => {
      // Mock for upsert that returns an error
      const mockUpsertSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });
      const mockUpsertSelect = jest.fn().mockReturnValue({ single: mockUpsertSingle });
      const mockUpsert = jest.fn().mockReturnValue({ select: mockUpsertSelect });

      // Setup supabase mock
      (supabase.from as jest.Mock).mockReturnValue({ upsert: mockUpsert });

      await expect(
        repository.upsertByDiscordId('error-user', { username: 'error' })
      ).rejects.toThrow('Database error');
    });
  });

  describe('updateGlobalReputationScore', () => {
    it('should update user reputation score', async () => {
      const updatedUser = { ...mockUser, global_reputation_score: 0.8 };
      const mockSingle = jest.fn().mockResolvedValue({
        data: updatedUser,
        error: null,
      });
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq = jest.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      const result = await repository.updateGlobalReputationScore(mockUser.discord_id, 0.8);

      expect(result).toEqual(updatedUser);
      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          global_reputation_score: 0.8,
          updated_at: expect.any(String),
        })
      );
    });

    it('should handle database errors', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq = jest.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      await expect(
        repository.updateGlobalReputationScore(mockUser.discord_id, 0.8)
      ).rejects.toThrow('Database error');
    });
  });

  describe('findUsersWithLowReputation', () => {
    it('should return users below threshold', async () => {
      const lowRepUsers = [
        { ...mockUser, global_reputation_score: 0.2 },
        { ...mockUser, id: '456', discord_id: '789', global_reputation_score: 0.3 },
      ];

      const mockLt = jest.fn().mockResolvedValue({
        data: lowRepUsers,
        error: null,
      });
      const mockSelect = jest.fn().mockReturnValue({ lt: mockLt });
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const result = await repository.findUsersWithLowReputation(0.4);

      expect(result).toEqual(lowRepUsers);
      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockLt).toHaveBeenCalledWith('global_reputation_score', 0.4);
    });

    it('should handle database errors', async () => {
      const mockLt = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });
      const mockSelect = jest.fn().mockReturnValue({ lt: mockLt });
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      await expect(repository.findUsersWithLowReputation(0.4)).rejects.toThrow('Database error');
    });
  });
});
