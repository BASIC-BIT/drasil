import 'reflect-metadata';
import { Container } from 'inversify';
import { createMocks } from '../utils/test-container';
import { TYPES } from '../../di/symbols';
import { UserService } from '../../services/UserService';
import { IUserRepository } from '../../repositories/UserRepository';
import { IServerMemberRepository } from '../../repositories/ServerMemberRepository';

describe('UserService', () => {
  let container: Container;
  let userService: UserService;
  let mockUserRepository: jest.Mocked<IUserRepository>;
  let mockServerMemberRepository: jest.Mocked<IServerMemberRepository>;

  beforeEach(() => {
    // Create a new container for each test
    container = new Container();

    // Create our mock repositories
    const mocks = createMocks();
    mockUserRepository = mocks.mockUserRepository;
    mockServerMemberRepository = mocks.mockServerMemberRepository;

    // Bind repositories to the container
    container.bind(TYPES.UserRepository).toConstantValue(mockUserRepository);
    container.bind(TYPES.ServerMemberRepository).toConstantValue(mockServerMemberRepository);

    // Bind the real UserService
    container.bind(TYPES.UserService).to(UserService);

    // Get the service from the container
    userService = container.get<UserService>(TYPES.UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrCreateUser', () => {
    it('should return existing user if found', async () => {
      // Arrange
      const existingUser = {
        id: 'user-123',
        discord_id: 'discord-123',
        username: 'existing-user',
        global_reputation_score: 100,
        created_at: '2023-01-01T12:00:00Z',
        updated_at: '2023-01-01T12:00:00Z',
      };
      mockUserRepository.findByDiscordId.mockResolvedValue(existingUser);

      // Act
      const result = await userService.getOrCreateUser('discord-123');

      // Assert
      expect(result).toEqual(existingUser);
      expect(mockUserRepository.findByDiscordId).toHaveBeenCalledWith('discord-123');
      expect(mockUserRepository.upsertByDiscordId).not.toHaveBeenCalled();
    });

    it('should update username if changed', async () => {
      // Arrange
      const existingUser = {
        id: 'user-123',
        discord_id: 'discord-123',
        username: 'old-username',
        global_reputation_score: 100,
        created_at: '2023-01-01T12:00:00Z',
        updated_at: '2023-01-01T12:00:00Z',
      };

      const updatedUser = {
        ...existingUser,
        username: 'new-username',
      };

      mockUserRepository.findByDiscordId.mockResolvedValue(existingUser);
      mockUserRepository.upsertByDiscordId.mockResolvedValue(updatedUser);

      // Act
      const result = await userService.getOrCreateUser('discord-123', 'new-username');

      // Assert
      expect(result).toEqual(updatedUser);
      expect(mockUserRepository.findByDiscordId).toHaveBeenCalledWith('discord-123');
      expect(mockUserRepository.upsertByDiscordId).toHaveBeenCalledWith('discord-123', {
        ...existingUser,
        username: 'new-username',
      });
    });

    it('should create new user if not found', async () => {
      // Arrange
      const newUser = {
        id: 'user-123',
        discord_id: 'discord-123',
        username: 'new-user',
        global_reputation_score: 100,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      };

      mockUserRepository.findByDiscordId.mockResolvedValue(null);
      mockUserRepository.upsertByDiscordId.mockResolvedValue(newUser);

      // Mock Date.now to return a consistent timestamp
      const mockDate = new Date('2023-01-01T12:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

      // Act
      const result = await userService.getOrCreateUser('discord-123', 'new-user');

      // Assert
      expect(result).toEqual(newUser);
      expect(mockUserRepository.findByDiscordId).toHaveBeenCalledWith('discord-123');
      expect(mockUserRepository.upsertByDiscordId).toHaveBeenCalledWith('discord-123', {
        discord_id: 'discord-123',
        username: 'new-user',
        global_reputation_score: 100,
        created_at: mockDate.toISOString(),
        updated_at: mockDate.toISOString(),
      });

      // Restore Date
      jest.restoreAllMocks();
    });
  });

  describe('getOrCreateMember', () => {
    it('should return existing member if found', async () => {
      // Arrange
      const existingMember = {
        id: 'member-123',
        server_id: 'server-123',
        user_id: 'user-123',
        join_date: '2023-01-01T12:00:00Z',
        message_count: 5,
        reputation_score: 80,
        is_restricted: false,
      };
      mockServerMemberRepository.findByServerAndUser.mockResolvedValue(existingMember);

      // Act
      const result = await userService.getOrCreateMember('server-123', 'user-123');

      // Assert
      expect(result).toEqual(existingMember);
      expect(mockServerMemberRepository.findByServerAndUser).toHaveBeenCalledWith(
        'server-123',
        'user-123'
      );
      expect(mockServerMemberRepository.upsertMember).not.toHaveBeenCalled();
    });

    it('should create new member if not found', async () => {
      // Arrange
      const newMember = {
        id: 'member-123',
        server_id: 'server-123',
        user_id: 'user-123',
        join_date: '2023-01-01T12:00:00Z',
        message_count: 0,
        reputation_score: 50,
        is_restricted: false,
      };

      mockServerMemberRepository.findByServerAndUser.mockResolvedValue(null);
      mockServerMemberRepository.upsertMember.mockResolvedValue(newMember);

      // Mock Date.now to return a consistent timestamp
      const mockDate = new Date('2023-01-01T12:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

      // Act
      const result = await userService.getOrCreateMember('server-123', 'user-123');

      // Assert
      expect(result).toEqual(newMember);
      expect(mockServerMemberRepository.findByServerAndUser).toHaveBeenCalledWith(
        'server-123',
        'user-123'
      );
      expect(mockServerMemberRepository.upsertMember).toHaveBeenCalledWith(
        'server-123',
        'user-123',
        {
          join_date: mockDate.toISOString(),
          message_count: 0,
          is_restricted: false,
          reputation_score: 50,
        }
      );

      // Restore Date
      jest.restoreAllMocks();
    });
  });

  describe('updateUserReputation', () => {
    it('should update server and global reputation', async () => {
      // Arrange
      const user = {
        id: 'user-123',
        discord_id: 'discord-123',
        username: 'test-user',
        global_reputation_score: 70,
      };

      const memberships = [
        { server_id: 'server-123', user_id: 'user-123', reputation_score: 80 },
        { server_id: 'server-456', user_id: 'user-123', reputation_score: 60 },
      ];

      mockUserRepository.findByDiscordId.mockResolvedValue(user);
      mockServerMemberRepository.findByUser.mockResolvedValue(memberships);

      // Act
      await userService.updateUserReputation('server-123', 'discord-123', 80);

      // Assert
      expect(mockServerMemberRepository.updateReputationScore).toHaveBeenCalledWith(
        'server-123',
        'discord-123',
        80
      );
      expect(mockUserRepository.findByDiscordId).toHaveBeenCalledWith('discord-123');
      expect(mockServerMemberRepository.findByUser).toHaveBeenCalledWith('discord-123');

      // Average of 80 and 60 is 70
      expect(mockUserRepository.updateReputationScore).toHaveBeenCalledWith('discord-123', 70);
    });

    it('should not update global reputation if user not found', async () => {
      // Arrange
      mockUserRepository.findByDiscordId.mockResolvedValue(null);

      // Act
      await userService.updateUserReputation('server-123', 'discord-123', 80);

      // Assert
      expect(mockServerMemberRepository.updateReputationScore).toHaveBeenCalledWith(
        'server-123',
        'discord-123',
        80
      );
      expect(mockUserRepository.findByDiscordId).toHaveBeenCalledWith('discord-123');
      expect(mockServerMemberRepository.findByUser).not.toHaveBeenCalled();
      expect(mockUserRepository.updateReputationScore).not.toHaveBeenCalled();
    });

    it('should not update global reputation if no memberships found', async () => {
      // Arrange
      const user = {
        id: 'user-123',
        discord_id: 'discord-123',
        username: 'test-user',
        global_reputation_score: 70,
      };

      mockUserRepository.findByDiscordId.mockResolvedValue(user);
      mockServerMemberRepository.findByUser.mockResolvedValue([]);

      // Act
      await userService.updateUserReputation('server-123', 'discord-123', 80);

      // Assert
      expect(mockServerMemberRepository.updateReputationScore).toHaveBeenCalledWith(
        'server-123',
        'discord-123',
        80
      );
      expect(mockUserRepository.findByDiscordId).toHaveBeenCalledWith('discord-123');
      expect(mockServerMemberRepository.findByUser).toHaveBeenCalledWith('discord-123');
      expect(mockUserRepository.updateReputationScore).not.toHaveBeenCalled();
    });

    it('should update user metadata', async () => {
      // Arrange
      const mockUser = {
        id: 'user-123',
        discord_id: 'discord-123',
        username: 'test-user',
        global_reputation_score: 70,
      };

      const metadata = {
        profile_analyzed: true,
        last_analysis: '2023-01-01T12:00:00Z',
      };

      const updatedUser = {
        ...mockUser,
        metadata,
        updated_at: expect.any(String),
      };

      mockUserRepository.findByDiscordId.mockResolvedValue(mockUser);
      mockUserRepository.upsertByDiscordId.mockResolvedValue(updatedUser);

      // Act
      const result = await userService.updateUserMetadata('discord-123', metadata);

      // Assert
      expect(result).toEqual(updatedUser);
      expect(mockUserRepository.upsertByDiscordId).toHaveBeenCalledWith('discord-123', {
        ...mockUser,
        metadata,
        updated_at: expect.any(String),
      });
    });

    it('should handle errors when updating metadata', async () => {
      // Arrange
      const error = new Error('Database error');

      // Mock the findByDiscordId to return valid user
      const mockUser = {
        discord_id: 'discord-123',
        username: 'test-user',
        global_reputation_score: 70,
      };

      mockUserRepository.findByDiscordId.mockResolvedValue(mockUser);
      mockUserRepository.upsertByDiscordId.mockRejectedValue(error);

      // Act & Assert
      await expect(
        userService.updateUserMetadata('discord-123', { profile_analyzed: true })
      ).rejects.toThrow('Database error');
    });
  });

  describe('findLowReputationUsers', () => {
    it('should find users with reputation below threshold', async () => {
      // Arrange
      const lowRepUsers = [
        {
          id: 'user-123',
          discord_id: 'discord-123',
          username: 'sus-user',
          global_reputation_score: 0.3,
        },
        {
          id: 'user-456',
          discord_id: 'discord-456',
          username: 'another-sus-user',
          global_reputation_score: 0.2,
        },
      ];

      mockUserRepository.findByReputationBelow.mockResolvedValue(lowRepUsers);

      // Act
      const result = await userService.findLowReputationUsers(0.4);

      // Assert
      expect(result).toEqual(lowRepUsers);
      expect(mockUserRepository.findByReputationBelow).toHaveBeenCalledWith(0.4);
    });

    it('should handle errors when finding low reputation users', async () => {
      // Arrange
      const error = new Error('Database error');
      mockUserRepository.findByReputationBelow.mockRejectedValue(error);

      // Act & Assert
      await expect(userService.findLowReputationUsers(0.4)).rejects.toThrow('Database error');
    });
  });

  // Additional test cases can be added for other methods
});
