import { Client, GuildMember, ThreadAutoArchiveDuration, ThreadChannel } from 'discord.js';
import { NotificationManager, INotificationManager } from '../../services/NotificationManager';
import { DetectionResult } from '../../services/DetectionOrchestrator';
import { IConfigService } from '../../config/ConfigService';
import { Container } from 'inversify';
import { TYPES } from '../../di/symbols';
import 'reflect-metadata';
import { IVerificationThreadRepository } from '../../repositories/VerificationThreadRepository';
import { createServiceTestContainer } from '../utils/test-container';

// Mock classes needed specifically for these tests
class MockThread {
  id = 'mock-thread-id';
  guild = { id: 'mock-guild-id' };
  send = jest.fn().mockResolvedValue(undefined);
  members = {
    add: jest.fn().mockResolvedValue(undefined),
  };
  url = 'https://discord.com/channels/123456789/987654321'; // Mock thread URL
}

class MockUser {
  username = 'testuser';
  discriminator = '1234';
  tag = 'testuser#1234';
  id = '123456789';
  displayAvatarURL = jest.fn().mockReturnValue('https://example.com/avatar.png');
  createdTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
}

class MockGuildMember {
  user = new MockUser();
  id = '123456789';
  guild = { id: 'mock-guild-id' };
  joinedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
  nickname = null;
  roles = {
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

// Mock discord.js
jest.mock('discord.js');

// Mock ConfigService
jest.mock('../../config/ConfigService');

describe('NotificationManager', () => {
  let notificationManager: INotificationManager;
  let mockMember: MockGuildMember;
  let container: Container;
  let mockClient: any;
  let mockConfigService: any;
  let mockVerificationThreadRepository: any;
  let mockThread: MockThread;
  let mockChannel: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMember = new MockGuildMember();
    mockThread = new MockThread();

    // Setup container with NotificationManager as the real service
    container = createServiceTestContainer(TYPES.NotificationManager, NotificationManager);

    // Get instances from container
    notificationManager = container.get<INotificationManager>(TYPES.NotificationManager);
    mockClient = container.get<Client>(TYPES.DiscordClient);
    mockConfigService = container.get<IConfigService>(TYPES.ConfigService);
    mockVerificationThreadRepository = container.get<IVerificationThreadRepository>(
      TYPES.VerificationThreadRepository
    );

    // Create a reusable mock channel
    mockChannel = {
      isTextBased: jest.fn().mockReturnValue(true),
      isDMBased: jest.fn().mockReturnValue(false),
      send: jest.fn().mockResolvedValue({
        embeds: [],
        components: [],
        edit: jest.fn().mockResolvedValue({}),
      }),
      threads: {
        create: jest.fn().mockResolvedValue(mockThread),
      },
    };

    // Setup mock client channel fetch
    mockClient.channels = {
      fetch: jest.fn().mockResolvedValue(mockChannel),
    };

    // Setup mock ConfigService
    mockConfigService.getServerConfig.mockResolvedValue({
      guild_id: 'mock-guild-id',
      admin_channel_id: 'mock-admin-channel-id',
      verification_channel_id: 'mock-verification-channel-id',
    });

    // Add user to client for permissions checks
    mockClient.user = { id: 'bot-user-id' };

    // Set channel IDs on NotificationManager
    notificationManager.setAdminChannelId('mock-admin-channel-id');
    notificationManager.setVerificationChannelId('mock-verification-channel-id');
  });

  describe('notifySuspiciousUser', () => {
    it('should send a notification message to the admin channel', async () => {
      // Setup return value for client.channels.fetch
      mockClient.channels.fetch.mockResolvedValue({
        isTextBased: jest.fn().mockReturnValue(true),
        isDMBased: jest.fn().mockReturnValue(false),
        send: jest.fn().mockResolvedValue({
          embeds: [{}],
          components: [{}],
        }),
      });

      const mockDetectionResult: DetectionResult = {
        label: 'SUSPICIOUS',
        confidence: 0.85,
        usedGPT: true,
        reasons: ['Suspicious behavior detected'],
        triggerSource: 'message',
        triggerContent: 'This is a test message',
      };

      const result = await notificationManager.notifySuspiciousUser(
        mockMember as unknown as GuildMember,
        mockDetectionResult
      );

      expect(result).toBeTruthy();
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('mock-admin-channel-id');
    });

    it('should return null if admin channel ID is not configured', async () => {
      // Override the setting
      notificationManager.setAdminChannelId('');

      const result = await notificationManager.notifySuspiciousUser(
        mockMember as unknown as GuildMember,
        {
          label: 'SUSPICIOUS',
          confidence: 0.85,
          usedGPT: true,
          reasons: ['test'],
          triggerSource: 'message',
          triggerContent: 'Test message',
        }
      );

      expect(result).toBeNull();
      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    });

    it('should return null if fetching the channel fails', async () => {
      mockClient.channels.fetch.mockRejectedValueOnce(new Error('Failed to fetch channel'));

      const result = await notificationManager.notifySuspiciousUser(
        mockMember as unknown as GuildMember,
        {
          label: 'SUSPICIOUS',
          confidence: 0.85,
          usedGPT: true,
          reasons: ['test'],
          triggerSource: 'join',
          triggerContent: 'User join event',
        }
      );

      expect(result).toBeNull();
    });
  });

  describe('createVerificationThread', () => {
    it('should create a verification thread successfully', async () => {
      // Add missing properties to mockMember and mockThread
      mockMember.guild = { id: 'mock-guild-id' };
      mockVerificationThreadRepository.createThread.mockResolvedValue({
        id: 'mock-thread-id',
        thread_id: mockThread.id,
        server_id: 'mock-guild-id',
        user_id: mockMember.id,
      });

      const result = await notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      expect(result).toBeTruthy();
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('mock-verification-channel-id');
      expect(mockChannel.threads.create).toHaveBeenCalledWith({
        name: `Verification: ${mockMember.user.username}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: expect.stringContaining('Verification thread for suspicious user'),
        type: 11, // PrivateThread
      });

      // Verify member is added to the thread
      expect(mockThread.members.add).toHaveBeenCalledWith(mockMember.id);
      expect(mockThread.send).toHaveBeenCalled();

      // Verify thread is recorded in repository
      expect(mockVerificationThreadRepository.createThread).toHaveBeenCalledWith(
        mockMember.guild.id,
        mockMember.id,
        mockThread.id
      );
    });

    it('should return null if no channel IDs are configured', async () => {
      // Override the setting
      notificationManager.setVerificationChannelId('');
      notificationManager.setAdminChannelId('');

      const result = await notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      expect(result).toBeNull();
      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    });

    it('should return null if creating the thread fails', async () => {
      mockChannel.threads.create.mockRejectedValueOnce(new Error('Failed to create thread'));

      const result = await notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      expect(result).toBeNull();
    });
  });

  describe('Channel IDs', () => {
    it('should update the admin channel ID', async () => {
      const newChannelId = 'new-channel-id';
      notificationManager.setAdminChannelId(newChannelId);

      // Setup mock channel for this test
      mockClient.channels.fetch.mockResolvedValue({
        isTextBased: jest.fn().mockReturnValue(true),
        isDMBased: jest.fn().mockReturnValue(false),
        send: jest.fn().mockResolvedValue({
          embeds: [{}],
          components: [{}],
        }),
      });

      await notificationManager.notifySuspiciousUser(mockMember as unknown as GuildMember, {
        label: 'SUSPICIOUS',
        confidence: 0.85,
        usedGPT: true,
        reasons: ['test'],
        triggerSource: 'message',
        triggerContent: 'Test message',
      });

      expect(mockClient.channels.fetch).toHaveBeenCalledWith(newChannelId);
    });

    it('should set the verification channel ID', async () => {
      const newChannelId = 'new-verification-channel-id';
      notificationManager.setVerificationChannelId(newChannelId);

      // Setup for this test
      mockMember.guild = { id: 'mock-guild-id' };
      mockVerificationThreadRepository.createThread.mockResolvedValue({
        id: 'mock-thread-id',
        thread_id: mockThread.id,
        server_id: 'mock-guild-id',
        user_id: mockMember.id,
      });

      await notificationManager.createVerificationThread(mockMember as unknown as GuildMember);

      expect(mockClient.channels.fetch).toHaveBeenCalledWith(newChannelId);
    });

    it('should get channel IDs from the database during initialization', async () => {
      await notificationManager.initialize('test-guild-id');

      // Verify the ConfigService was called with the correct guild ID
      expect(mockConfigService.getServerConfig).toHaveBeenCalledWith('test-guild-id');
    });
  });

  describe('logActionToMessage', () => {
    it('should update an existing message with action log', async () => {
      // Create a proper mock message with embeds that match EmbedBuilder expectations
      const mockEmbed = {
        data: {
          fields: [],
        },
        toJSON: function () {
          return this.data;
        },
      };

      const mockMessage = {
        embeds: [mockEmbed],
        edit: jest.fn().mockResolvedValue(undefined),
        guildId: 'mock-guild-id',
      };

      const mockAdmin = { id: '987654321' };

      const result = await notificationManager.logActionToMessage(
        mockMessage as any,
        'verified the user',
        mockAdmin as any
      );

      expect(result).toBe(true);
      expect(mockMessage.edit).toHaveBeenCalled();

      // Check that the edit call includes an embed with an Action Log field
      const editCall = mockMessage.edit.mock.calls[0][0];
      expect(editCall.embeds[0].data.fields).toContainEqual(
        expect.objectContaining({
          name: 'Action Log',
        })
      );
    });

    it('should include thread link when thread is provided', async () => {
      // Create a proper mock message with embeds that match EmbedBuilder expectations
      const mockEmbed = {
        data: {
          fields: [],
        },
        toJSON: function () {
          return this.data;
        },
      };

      const mockMessage = {
        embeds: [mockEmbed],
        edit: jest.fn().mockResolvedValue(undefined),
        guildId: 'mock-guild-id',
      };

      const mockAdmin = { id: '987654321' };

      await notificationManager.logActionToMessage(
        mockMessage as any,
        'created a verification thread',
        mockAdmin as any,
        mockThread as unknown as ThreadChannel
      );

      // Check that the thread link is included in the action log
      const editCall = mockMessage.edit.mock.calls[0][0];
      const updatedField = editCall.embeds[0].data.fields.find(
        (f: { name: string }) => f.name === 'Action Log'
      );
      expect(updatedField.value).toContain('created a verification thread');
      expect(updatedField.value).toContain(mockThread.url);
    });

    it('should append to existing action log if one exists', async () => {
      // Mock the date for consistent timestamps in tests
      const originalDateNow = Date.now;
      Date.now = jest.fn().mockReturnValue(1234567890000); // Fixed timestamp

      const existingActionLog = '• <@123456> verified the user <t:1234567890:R>';

      // Create an embed that exactly matches the structure expected by EmbedBuilder.from
      const mockEmbed = {
        data: {
          fields: [{ name: 'Action Log', value: existingActionLog }],
        },
        // Add the toJSON method required for EmbedBuilder.from to work correctly
        toJSON: function () {
          return this.data;
        },
      };

      // Create a proper mock message
      const mockMessage = {
        embeds: [mockEmbed],
        edit: jest.fn().mockResolvedValue(undefined),
        guildId: 'mock-guild-id',
      };

      const mockAdmin = { id: '987654321' };

      // Call the method
      await notificationManager.logActionToMessage(
        mockMessage as any,
        'banned the user',
        mockAdmin as any
      );

      // Restore the original Date.now
      Date.now = originalDateNow;

      // Check that edit was called with the right parameters
      expect(mockMessage.edit).toHaveBeenCalled();

      // Get the updated embed from the edit call
      const editCallArgs = mockMessage.edit.mock.calls[0][0];

      // Verify the action log has the expected content
      expect(editCallArgs.embeds[0].data.fields[0].name).toBe('Action Log');
      expect(editCallArgs.embeds[0].data.fields[0].value).toContain(existingActionLog);
      expect(editCallArgs.embeds[0].data.fields[0].value).toContain('banned the user');
      expect(editCallArgs.embeds[0].data.fields[0].value).toBe(
        `${existingActionLog}\n• <@987654321> banned the user <t:1234567890:R>`
      );
    });

    it('should return false if the message has no embeds', async () => {
      const mockMessage = {
        embeds: [],
        edit: jest.fn().mockResolvedValue(undefined),
      };
      const mockAdmin = { id: '987654321' };

      const result = await notificationManager.logActionToMessage(
        mockMessage as any,
        'verified the user',
        mockAdmin as any
      );

      expect(result).toBe(false);
      expect(mockMessage.edit).not.toHaveBeenCalled();
    });
  });

  describe('setupVerificationChannel', () => {
    let mockGuild: any;
    let mockRolesCache: Map<string, any>;
    let mockEveryoneRole: any;
    let mockAdminRole: any;
    let mockRestrictedRole: any;

    beforeEach(() => {
      // Set up mock guild with roles
      mockRolesCache = new Map();

      // Create mock roles
      mockEveryoneRole = {
        id: 'everyone-role-id',
      };

      mockAdminRole = {
        id: 'admin-role-id',
        permissions: {
          has: jest.fn().mockReturnValue(true), // This role has administrator permission
        },
      };

      mockRestrictedRole = {
        id: 'restricted-role-id',
      };

      // Add roles to the cache
      mockRolesCache.set(mockEveryoneRole.id, mockEveryoneRole);
      mockRolesCache.set(mockAdminRole.id, mockAdminRole);

      // Create the mock guild
      mockGuild = {
        roles: {
          everyone: mockEveryoneRole,
          cache: {
            filter: jest.fn().mockReturnValue({
              forEach: jest.fn((callback) => {
                callback(mockAdminRole);
              }),
            }),
          },
        },
        channels: {
          create: jest.fn().mockResolvedValue({
            id: 'verification-channel-id',
          }),
        },
      };
    });

    it('should create a verification channel with correct permissions', async () => {
      // Ensure guild.channels.create returns properly
      mockGuild.channels.create.mockResolvedValue({
        id: 'verification-channel-id',
      });

      const result = await notificationManager.setupVerificationChannel(
        mockGuild as any,
        mockRestrictedRole.id
      );

      // Check that the channel was created
      expect(result).toBe('verification-channel-id');
      expect(mockGuild.channels.create).toHaveBeenCalled();

      // Check the channel options passed to create
      const callArgs = mockGuild.channels.create.mock.calls[0][0];
      expect(callArgs.name).toBe('verification');
      expect(callArgs.type).toBeDefined();

      // Check permission overwrites were provided
      expect(callArgs.permissionOverwrites).toHaveLength(4); // everyone, restricted role, bot, admin role
    });

    it('should return null if guild is not provided', async () => {
      const result = await notificationManager.setupVerificationChannel(
        null as any,
        mockRestrictedRole.id
      );

      expect(result).toBeNull();
    });

    it('should return null if restricted role ID is not provided', async () => {
      const result = await notificationManager.setupVerificationChannel(mockGuild as any, '');

      expect(result).toBeNull();
    });

    it('should handle errors when creating the channel', async () => {
      // Mock the channel creation to fail
      mockGuild.channels.create.mockRejectedValueOnce(new Error('Failed to create channel'));

      const result = await notificationManager.setupVerificationChannel(
        mockGuild as any,
        mockRestrictedRole.id
      );

      expect(result).toBeNull();
    });
  });
});
