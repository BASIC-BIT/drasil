import { UserService } from '../UserService';
import { UserRepository } from '../../repositories/UserRepository';
import { ServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { User, ServerMember } from '../../repositories/types';

// Mock repositories
jest.mock('../../repositories/UserRepository');
jest.mock('../../repositories/ServerMemberRepository');

describe('UserService', () => {
  let service: UserService;
  let userRepository: jest.Mocked<UserRepository>;
  let serverMemberRepository: jest.Mocked<ServerMemberRepository>;

  const mockUser: User = {
    id: '123',
    discord_id: '456789',
    username: 'testuser',
    global_reputation_score: 0.5,
    created_at: '2024-03-27T00:00:00Z',
    updated_at: '2024-03-27T00:00:00Z',
  };

  const mockMember: ServerMember = {
    id: 'member123',
    server_id: 'server123',
    user_id: '123',
    join_date: '2024-03-27T00:00:00Z',
    reputation_score: 0.5,
    is_restricted: false,
    last_verified_at: '2024-03-27T00:00:00Z',
    last_message_at: '2024-03-27T00:00:00Z',
    message_count: 10,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository = new UserRepository() as jest.Mocked<UserRepository>;
    serverMemberRepository = new ServerMemberRepository() as jest.Mocked<ServerMemberRepository>;
    service = new UserService(userRepository, serverMemberRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('getOrCreateUser', () => {
    it('should return existing user when found', async () => {
      userRepository.findByDiscordId.mockResolvedValue(mockUser);

      const result = await service.getOrCreateUser(mockUser.discord_id);

      expect(result).toEqual(mockUser);
      expect(userRepository.findByDiscordId).toHaveBeenCalledWith(mockUser.discord_id);
      expect(userRepository.upsertByDiscordId).not.toHaveBeenCalled();
    });

    it('should update username if different', async () => {
      const updatedUser = { ...mockUser, username: 'newname' };
      userRepository.findByDiscordId.mockResolvedValue(mockUser);
      userRepository.upsertByDiscordId.mockResolvedValue(updatedUser);

      const result = await service.getOrCreateUser(mockUser.discord_id, 'newname');

      expect(result).toEqual(updatedUser);
      expect(userRepository.upsertByDiscordId).toHaveBeenCalledWith(mockUser.discord_id, {
        username: 'newname',
      });
    });

    it('should create new user when not found', async () => {
      userRepository.findByDiscordId.mockResolvedValue(null);
      userRepository.upsertByDiscordId.mockResolvedValue(mockUser);

      const result = await service.getOrCreateUser('newuser', 'newname');

      expect(result).toEqual(mockUser);
      expect(userRepository.upsertByDiscordId).toHaveBeenCalledWith('newuser', {
        username: 'newname',
        global_reputation_score: 0.0,
        account_created_at: expect.any(String),
      });
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      userRepository.findByDiscordId.mockRejectedValue(error);

      await expect(service.getOrCreateUser(mockUser.discord_id)).rejects.toThrow('Database error');
    });
  });

  describe('getOrCreateMember', () => {
    it('should return existing member when found', async () => {
      serverMemberRepository.findByServerAndUser.mockResolvedValue(mockMember);

      const result = await service.getOrCreateMember(mockMember.server_id, mockMember.user_id);

      expect(result).toEqual(mockMember);
      expect(serverMemberRepository.findByServerAndUser).toHaveBeenCalledWith(
        mockMember.server_id,
        mockMember.user_id
      );
      expect(serverMemberRepository.upsertMember).not.toHaveBeenCalled();
    });

    it('should create new member when not found', async () => {
      serverMemberRepository.findByServerAndUser.mockResolvedValue(null);
      serverMemberRepository.upsertMember.mockResolvedValue(mockMember);

      const result = await service.getOrCreateMember('server123', 'user123');

      expect(result).toEqual(mockMember);
      expect(serverMemberRepository.upsertMember).toHaveBeenCalledWith('server123', 'user123', {
        join_date: expect.any(String),
        reputation_score: 0.0,
        message_count: 0,
      });
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      serverMemberRepository.findByServerAndUser.mockRejectedValue(error);

      await expect(service.getOrCreateMember('server123', 'user123')).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('updateUserReputation', () => {
    it('should update server and global reputation scores', async () => {
      const memberships = [
        { ...mockMember, reputation_score: 0.8 },
        { ...mockMember, id: 'member456', reputation_score: 0.6 },
      ];

      serverMemberRepository.updateReputationScore.mockResolvedValue(mockMember);
      userRepository.findById.mockResolvedValue(mockUser);
      serverMemberRepository.findMany.mockResolvedValue(memberships);
      userRepository.updateGlobalReputationScore.mockResolvedValue(mockUser);

      await service.updateUserReputation(mockMember.server_id, mockMember.user_id, 0.8);

      expect(serverMemberRepository.updateReputationScore).toHaveBeenCalledWith(
        mockMember.server_id,
        mockMember.user_id,
        0.8
      );
      expect(userRepository.updateGlobalReputationScore).toHaveBeenCalledWith(
        mockUser.discord_id,
        0.7 // Average of 0.8 and 0.6
      );
    });

    it('should not update global score if user not found', async () => {
      serverMemberRepository.updateReputationScore.mockResolvedValue(mockMember);
      userRepository.findById.mockResolvedValue(null);

      await service.updateUserReputation(mockMember.server_id, mockMember.user_id, 0.8);

      expect(serverMemberRepository.updateReputationScore).toHaveBeenCalled();
      expect(serverMemberRepository.findMany).not.toHaveBeenCalled();
      expect(userRepository.updateGlobalReputationScore).not.toHaveBeenCalled();
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      serverMemberRepository.updateReputationScore.mockRejectedValue(error);

      await expect(
        service.updateUserReputation(mockMember.server_id, mockMember.user_id, 0.8)
      ).rejects.toThrow('Database error');
    });
  });

  describe('handleUserMessage', () => {
    it('should update user and increment message count', async () => {
      userRepository.findByDiscordId.mockResolvedValue(mockUser);
      serverMemberRepository.incrementMessageCount.mockResolvedValue(mockMember);

      await service.handleUserMessage(
        mockMember.server_id,
        mockMember.user_id,
        mockUser.discord_id,
        mockUser.username!
      );

      expect(userRepository.findByDiscordId).toHaveBeenCalledWith(mockUser.discord_id);
      expect(serverMemberRepository.incrementMessageCount).toHaveBeenCalledWith(
        mockMember.server_id,
        mockMember.user_id
      );
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      userRepository.findByDiscordId.mockRejectedValue(error);

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
      serverMemberRepository.updateRestrictionStatus.mockResolvedValue(restrictedMember);

      const result = await service.updateUserRestriction(
        mockMember.server_id,
        mockMember.user_id,
        true
      );

      expect(result).toEqual(restrictedMember);
      expect(serverMemberRepository.updateRestrictionStatus).toHaveBeenCalledWith(
        mockMember.server_id,
        mockMember.user_id,
        true
      );
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      serverMemberRepository.updateRestrictionStatus.mockRejectedValue(error);

      await expect(
        service.updateUserRestriction(mockMember.server_id, mockMember.user_id, true)
      ).rejects.toThrow('Database error');
    });
  });

  describe('getRestrictedUsers', () => {
    it('should return restricted users in server', async () => {
      const restrictedMembers = [
        { ...mockMember, is_restricted: true },
        { ...mockMember, id: 'member456', is_restricted: true },
      ];
      serverMemberRepository.findRestrictedMembers.mockResolvedValue(restrictedMembers);

      const result = await service.getRestrictedUsers(mockMember.server_id);

      expect(result).toEqual(restrictedMembers);
      expect(serverMemberRepository.findRestrictedMembers).toHaveBeenCalledWith(
        mockMember.server_id
      );
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      serverMemberRepository.findRestrictedMembers.mockRejectedValue(error);

      await expect(service.getRestrictedUsers(mockMember.server_id)).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('updateUserMetadata', () => {
    it('should update user metadata', async () => {
      const metadata = { lastWarning: new Date().toISOString() };
      const updatedUser = { ...mockUser, metadata };
      userRepository.updateMetadata.mockResolvedValue(updatedUser);

      const result = await service.updateUserMetadata(mockUser.discord_id, metadata);

      expect(result).toEqual(updatedUser);
      expect(userRepository.updateMetadata).toHaveBeenCalledWith(mockUser.discord_id, metadata);
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      userRepository.updateMetadata.mockRejectedValue(error);

      await expect(
        service.updateUserMetadata(mockUser.discord_id, { test: 'data' })
      ).rejects.toThrow('Database error');
    });
  });

  describe('findLowReputationUsers', () => {
    it('should return users with low reputation', async () => {
      const lowRepUsers = [
        { ...mockUser, global_reputation_score: 0.2 },
        { ...mockUser, id: '456', discord_id: '789', global_reputation_score: 0.3 },
      ];
      userRepository.findUsersWithLowReputation.mockResolvedValue(lowRepUsers);

      const result = await service.findLowReputationUsers(0.4);

      expect(result).toEqual(lowRepUsers);
      expect(userRepository.findUsersWithLowReputation).toHaveBeenCalledWith(0.4);
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      userRepository.findUsersWithLowReputation.mockRejectedValue(error);

      await expect(service.findLowReputationUsers(0.4)).rejects.toThrow('Database error');
    });
  });
});
