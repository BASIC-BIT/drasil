import { UserService, IUserService } from '../UserService';
import { IUserRepository } from '../../repositories/UserRepository';
import { IServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { User, ServerMember } from '../../repositories/types';
import { Container } from 'inversify';
import { TYPES } from '../../di/symbols';
import 'reflect-metadata';

// Mock repositories
jest.mock('../../repositories/UserRepository');
jest.mock('../../repositories/ServerMemberRepository');

describe('UserService', () => {
  let service: IUserService;
  let mockUserRepository: jest.Mocked<IUserRepository>;
  let mockServerMemberRepository: jest.Mocked<IServerMemberRepository>;
  let container: Container;

  const mockUser: User = {
    discord_id: '456789',
    username: 'testuser',
    global_reputation_score: 0.5,
    created_at: '2024-03-27T00:00:00Z',
    updated_at: '2024-03-27T00:00:00Z',
  };

  const mockMember: ServerMember = {
    server_id: 'server123',
    user_id: '456789',
    join_date: '2024-03-27T00:00:00Z',
    reputation_score: 0.5,
    is_restricted: false,
    last_verified_at: '2024-03-27T00:00:00Z',
    last_message_at: '2024-03-27T00:00:00Z',
    message_count: 10,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock repositories
    mockUserRepository = {
      findByDiscordId: jest.fn(),
      upsertByDiscordId: jest.fn(),
      updateReputationScore: jest.fn(),
      findMany: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      findByReputationBelow: jest.fn(),
    } as unknown as jest.Mocked<IUserRepository>;

    mockServerMemberRepository = {
      findByServerAndUser: jest.fn(),
      upsertMember: jest.fn(),
      findByUser: jest.fn(),
      updateReputationScore: jest.fn(),
      incrementMessageCount: jest.fn(),
      updateRestrictionStatus: jest.fn(),
      findRestrictedMembers: jest.fn(),
      findMany: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    } as unknown as jest.Mocked<IServerMemberRepository>;

    // Set up DI container
    container = new Container();
    container.bind<IUserRepository>(TYPES.UserRepository).toConstantValue(mockUserRepository);
    container
      .bind<IServerMemberRepository>(TYPES.ServerMemberRepository)
      .toConstantValue(mockServerMemberRepository);
    container.bind<IUserService>(TYPES.UserService).to(UserService);

    // Get service from container
    service = container.get<IUserService>(TYPES.UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('getOrCreateUser', () => {
    it('should return existing user when found', async () => {
      mockUserRepository.findByDiscordId.mockResolvedValue(mockUser);

      const result = await service.getOrCreateUser(mockUser.discord_id);

      expect(result).toEqual(mockUser);
      expect(mockUserRepository.findByDiscordId).toHaveBeenCalledWith(mockUser.discord_id);
      expect(mockUserRepository.upsertByDiscordId).not.toHaveBeenCalled();
    });

    it('should update username if different', async () => {
      const updatedUser = { ...mockUser, username: 'newname' };
      mockUserRepository.findByDiscordId.mockResolvedValue(mockUser);
      mockUserRepository.upsertByDiscordId.mockResolvedValue(updatedUser);

      const result = await service.getOrCreateUser(mockUser.discord_id, 'newname');

      expect(result).toEqual(updatedUser);
      expect(mockUserRepository.upsertByDiscordId).toHaveBeenCalledWith(mockUser.discord_id, {
        ...mockUser,
        username: 'newname',
      });
    });

    it('should create new user when not found', async () => {
      mockUserRepository.findByDiscordId.mockResolvedValue(null);
      mockUserRepository.upsertByDiscordId.mockResolvedValue(mockUser);

      const result = await service.getOrCreateUser('newuser', 'newname');

      expect(result).toEqual(mockUser);
      expect(mockUserRepository.upsertByDiscordId).toHaveBeenCalledWith(
        'newuser',
        expect.objectContaining({
          username: 'newname',
        })
      );
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      mockUserRepository.findByDiscordId.mockRejectedValue(error);

      await expect(service.getOrCreateUser(mockUser.discord_id)).rejects.toThrow('Database error');
    });
  });

  describe('getOrCreateMember', () => {
    it('should return existing member when found', async () => {
      mockServerMemberRepository.findByServerAndUser.mockResolvedValue(mockMember);

      const result = await service.getOrCreateMember(mockMember.server_id, mockMember.user_id);

      expect(result).toEqual(mockMember);
      expect(mockServerMemberRepository.findByServerAndUser).toHaveBeenCalledWith(
        mockMember.server_id,
        mockMember.user_id
      );
      expect(mockServerMemberRepository.upsertMember).not.toHaveBeenCalled();
    });

    it('should create new member when not found', async () => {
      mockServerMemberRepository.findByServerAndUser.mockResolvedValue(null);
      mockServerMemberRepository.upsertMember.mockResolvedValue(mockMember);

      const result = await service.getOrCreateMember('server123', 'user123');

      expect(result).toEqual(mockMember);
      expect(mockServerMemberRepository.upsertMember).toHaveBeenCalledWith(
        'server123',
        'user123',
        expect.objectContaining({
          join_date: expect.any(String),
          message_count: 0,
        })
      );
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      mockServerMemberRepository.findByServerAndUser.mockRejectedValue(error);

      await expect(service.getOrCreateMember('server123', 'user123')).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('updateUserReputation', () => {
    it('should update server and global reputation scores', async () => {
      const memberships = [
        { ...mockMember, reputation_score: 0.8 },
        { ...mockMember, server_id: 'server456', user_id: 'user456', reputation_score: 0.6 },
      ];

      mockServerMemberRepository.updateReputationScore.mockResolvedValue(mockMember);
      mockUserRepository.findByDiscordId.mockResolvedValue(mockUser);
      mockServerMemberRepository.findByUser.mockResolvedValue(memberships);
      mockUserRepository.updateReputationScore.mockResolvedValue(mockUser);

      await service.updateUserReputation(mockMember.server_id, mockMember.user_id, 0.8);

      expect(mockServerMemberRepository.updateReputationScore).toHaveBeenCalledWith(
        mockMember.server_id,
        mockMember.user_id,
        0.8
      );
      expect(mockUserRepository.updateReputationScore).toHaveBeenCalledWith(
        mockUser.discord_id,
        0.7 // Average of 0.8 and 0.6
      );
    });

    it('should not update global score if user not found', async () => {
      mockServerMemberRepository.updateReputationScore.mockResolvedValue(mockMember);
      mockUserRepository.findByDiscordId.mockResolvedValue(null);

      await service.updateUserReputation(mockMember.server_id, mockMember.user_id, 0.8);

      expect(mockServerMemberRepository.updateReputationScore).toHaveBeenCalled();
      expect(mockServerMemberRepository.findByUser).not.toHaveBeenCalled();
      expect(mockUserRepository.updateReputationScore).not.toHaveBeenCalled();
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      mockServerMemberRepository.updateReputationScore.mockRejectedValue(error);

      await expect(
        service.updateUserReputation(mockMember.server_id, mockMember.user_id, 0.8)
      ).rejects.toThrow('Database error');
    });
  });

  describe('handleUserMessage', () => {
    it('should update user and increment message count', async () => {
      mockUserRepository.findByDiscordId.mockResolvedValue(mockUser);
      mockServerMemberRepository.incrementMessageCount.mockResolvedValue(mockMember);

      await service.handleUserMessage(
        mockMember.server_id,
        mockMember.user_id,
        mockUser.discord_id,
        mockUser.username!
      );

      expect(mockUserRepository.findByDiscordId).toHaveBeenCalledWith(mockUser.discord_id);
      expect(mockServerMemberRepository.incrementMessageCount).toHaveBeenCalledWith(
        mockMember.server_id,
        mockMember.user_id
      );
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      mockUserRepository.findByDiscordId.mockRejectedValue(error);

      await expect(
        service.handleUserMessage(
          mockMember.server_id,
          mockMember.user_id,
          mockUser.discord_id,
          mockUser.username!
        )
      ).rejects.toThrow('Database error');
    });
  });

  describe('updateUserRestriction', () => {
    it('should update user restriction status', async () => {
      const restrictedMember = { ...mockMember, is_restricted: true };
      mockServerMemberRepository.updateRestrictionStatus.mockResolvedValue(restrictedMember);

      const result = await service.updateUserRestriction(
        mockMember.server_id,
        mockMember.user_id,
        true
      );

      expect(result).toEqual(restrictedMember);
      expect(mockServerMemberRepository.updateRestrictionStatus).toHaveBeenCalledWith(
        mockMember.server_id,
        mockMember.user_id,
        true
      );
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      mockServerMemberRepository.updateRestrictionStatus.mockRejectedValue(error);

      await expect(
        service.updateUserRestriction(mockMember.server_id, mockMember.user_id, true)
      ).rejects.toThrow('Database error');
    });
  });

  describe('getRestrictedUsers', () => {
    it('should return restricted users in server', async () => {
      const restrictedMembers = [
        { ...mockMember, is_restricted: true },
        { ...mockMember, server_id: 'server456', user_id: 'user456', is_restricted: true },
      ];
      mockServerMemberRepository.findRestrictedMembers.mockResolvedValue(restrictedMembers);

      const result = await service.getRestrictedUsers(mockMember.server_id);

      expect(result).toEqual(restrictedMembers);
      expect(mockServerMemberRepository.findRestrictedMembers).toHaveBeenCalledWith(
        mockMember.server_id
      );
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      mockServerMemberRepository.findRestrictedMembers.mockRejectedValue(error);

      await expect(service.getRestrictedUsers(mockMember.server_id)).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('updateUserMetadata', () => {
    it('should update user metadata', async () => {
      const metadata = {
        last_analysis: '2023-01-01T12:00:00Z',
        profile_analyzed: true,
      };
      const updatedUser = {
        ...mockUser,
        metadata,
      };
      mockUserRepository.findByDiscordId.mockResolvedValue(mockUser);
      mockUserRepository.upsertByDiscordId.mockResolvedValue(updatedUser);

      const result = await service.updateUserMetadata(mockUser.discord_id, metadata);

      // Assert
      expect(result).toEqual(updatedUser);
      expect(mockUserRepository.upsertByDiscordId).toHaveBeenCalledWith(mockUser.discord_id, {
        ...mockUser,
        metadata,
        updated_at: expect.any(String),
      });
    });

    it('should return null if user not found', async () => {
      mockUserRepository.findByDiscordId.mockResolvedValue(null);

      const result = await service.updateUserMetadata('discord-123', { profile_analyzed: true });

      expect(result).toBeNull();
      expect(mockUserRepository.upsertByDiscordId).not.toHaveBeenCalled();
    });

    it('should handle errors when updating metadata', async () => {
      const error = new Error('Database error');
      mockUserRepository.findByDiscordId.mockResolvedValue(mockUser);
      mockUserRepository.upsertByDiscordId.mockRejectedValue(error);

      await expect(
        service.updateUserMetadata('discord-123', { profile_analyzed: true })
      ).rejects.toThrow('Database error');
    });
  });

  describe('findLowReputationUsers', () => {
    it('should return users with reputation below threshold', async () => {
      const lowRepUsers = [
        { ...mockUser, global_reputation_score: 0.3 },
        { ...mockUser, discord_id: 'user456', global_reputation_score: 0.2 },
      ];
      mockUserRepository.findByReputationBelow.mockResolvedValue(lowRepUsers);

      const result = await service.findLowReputationUsers(0.4);

      expect(result).toEqual(lowRepUsers);
      expect(mockUserRepository.findByReputationBelow).toHaveBeenCalledWith(0.4);
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      mockUserRepository.findByReputationBelow.mockRejectedValue(error);

      await expect(service.findLowReputationUsers(0.4)).rejects.toThrow('Database error');
    });
  });
});
