import { Client, GuildMember, ThreadAutoArchiveDuration, ThreadChannel } from 'discord.js';
import { NotificationManager, INotificationManager } from '../../services/NotificationManager';
import { DetectionResult } from '../../services/DetectionOrchestrator';
import { IConfigService } from '../../config/ConfigService';
import { Server } from '../../repositories/types';
import { Container } from 'inversify';
import { TYPES } from '../../di/symbols';
import 'reflect-metadata';

// Mock classes
class MockThread {
  send = jest.fn().mockResolvedValue(undefined);
  members = {
    add: jest.fn().mockResolvedValue(undefined),
  };
  url = 'https://discord.com/channels/123456789/987654321'; // Mock thread URL
}

class MockClient {
  channels: any;
  user?: any;

  constructor() {
    this.channels = {
      fetch: jest.fn().mockResolvedValue({
        isTextBased: jest.fn().mockReturnValue(true),
        isDMBased: jest.fn().mockReturnValue(false),
        send: jest.fn().mockResolvedValue({
          embeds: [],
          components: [],
          edit: jest.fn().mockResolvedValue({}),
        }),
        threads: {
          create: jest.fn().mockResolvedValue(new MockThread()),
        },
      }),
    };
  }
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
  joinedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
  nickname = null;
  roles = {
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

jest.mock('discord.js', () => ({
  ...jest.requireActual('discord.js'),
  Client: jest.fn().mockImplementation(() => new MockClient()),
}));

// Mock ConfigService
jest.mock('../../config/ConfigService');

describe('NotificationManager', () => {
  let notificationManager: INotificationManager;
  let mockClient: MockClient;
  let mockMember: MockGuildMember;
  let mockConfigService: jest.Mocked<IConfigService>;
  let container: Container;
  let notificationManagerInstance: NotificationManager;

  const mockServer: Server = {
    guild_id: 'mock-guild-id',
    admin_channel_id: 'mock-admin-channel-id',
    verification_channel_id: 'mock-verification-channel-id',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    restricted_role_id: 'restricted-role-id',
    admin_notification_role_id: 'admin-role-id',
    settings: {
      message_threshold: 5,
      message_timeframe: 60,
      suspicious_keywords: ['spam', 'scam'],
      min_confidence_threshold: 0.7,
      auto_restrict: true,
      use_gpt_on_join: true,
      gpt_message_check_count: 3,
      message_retention_days: 30,
      detection_retention_days: 90,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = new MockClient();
    mockMember = new MockGuildMember();

    // Create complete mock ConfigService
    mockConfigService = {
      getServerConfig: jest.fn().mockResolvedValue(mockServer),
      updateServerConfig: jest.fn().mockResolvedValue(mockServer),
      updateServerSettings: jest.fn().mockResolvedValue(mockServer),
      initialize: jest.fn().mockResolvedValue(undefined),
      clearCache: jest.fn(),
      getAllActiveServers: jest.fn().mockResolvedValue([mockServer]),
      getServerByGuildId: jest.fn().mockResolvedValue(mockServer),
    } as unknown as jest.Mocked<IConfigService>;

    // Set up container
    container = new Container();
    container.bind<Client>(TYPES.DiscordClient).toConstantValue(mockClient as unknown as Client);
    container.bind<IConfigService>(TYPES.ConfigService).toConstantValue(mockConfigService);

    // Create NotificationManager instance directly with only the required parameters
    notificationManagerInstance = new NotificationManager(
      mockClient as unknown as Client,
      mockConfigService
    );

    // Bind the instance to the container
    container
      .bind<INotificationManager>(TYPES.NotificationManager)
      .toConstantValue(notificationManagerInstance);

    // Get instance from container
    notificationManager = container.get<INotificationManager>(TYPES.NotificationManager);
  });

  describe('notifySuspiciousUser', () => {
    it('should send a notification message to the admin channel', async () => {
      notificationManager.setAdminChannelId('mock-channel-id');
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
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('mock-channel-id');
      const channel = await mockClient.channels.fetch();
      expect(channel.send).toHaveBeenCalled();

      // Verify the sent message has embeds and components
      const sentMessage = (channel.send as jest.Mock).mock.calls[0][0];
      expect(sentMessage.embeds).toBeDefined();
      expect(sentMessage.components).toBeDefined();
    });

    it('should return null if admin channel ID is not configured', async () => {
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
      notificationManager.setAdminChannelId('mock-channel-id');
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
    it('should create a verification thread successfully using admin channel', async () => {
      notificationManager.setAdminChannelId('mock-channel-id');

      // Ensure thread.members.add is called
      const mockThread = new MockThread();
      mockThread.members.add.mockClear();

      const channel = await mockClient.channels.fetch();
      channel.threads.create.mockImplementationOnce(() => Promise.resolve(mockThread));

      const result = await notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      expect(result).toBeTruthy();
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('mock-channel-id');
      expect(channel.threads.create).toHaveBeenCalledWith({
        name: `Verification: ${mockMember.user.username}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: expect.stringContaining('Verification thread for suspicious user'),
        type: 11, // PrivateThread
      });

      // Verify member is added to the thread
      expect(mockThread.members.add).toHaveBeenCalledWith(mockMember.id);
      expect(mockThread.send).toHaveBeenCalled();
    });

    it('should create a verification thread successfully using verification channel', async () => {
      notificationManager.setVerificationChannelId('verification-channel-id');
      const result = await notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      expect(result).toBeTruthy();
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('verification-channel-id');
    });

    it('should return null if no channel IDs are configured', async () => {
      const result = await notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      expect(result).toBeNull();
      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    });

    it('should return null if creating the thread fails', async () => {
      notificationManager.setAdminChannelId('mock-channel-id');
      const channel = await mockClient.channels.fetch();
      channel.threads.create.mockRejectedValueOnce(new Error('Failed to create thread'));

      const result = await notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      expect(result).toBeNull();
    });
  });

  describe('setAdminChannelId', () => {
    it('should update the admin channel ID', async () => {
      const newChannelId = 'new-channel-id';
      notificationManager.setAdminChannelId(newChannelId);

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
  });

  describe('setVerificationChannelId', () => {
    it('should set the verification channel ID', async () => {
      notificationManager.setVerificationChannelId('verification-channel-id');

      // To test if the property was set, we need to call a method that uses it,
      // since we can't access the private property directly
      const verificationChannel = notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      await expect(verificationChannel).resolves.not.toBeNull();
      expect(mockClient.channels.fetch).toBeCalledWith('verification-channel-id');
    });
  });

  describe('initialize', () => {
    it('should get channel IDs from the database during initialization', async () => {
      // Create a new NotificationManager with no initial channel IDs
      const newNotificationManager = new NotificationManager(
        mockClient as unknown as Client,
        mockConfigService
      );

      // Initialize the notification manager with a guild ID
      await newNotificationManager.initialize('test-guild-id');

      // Verify the ConfigService was called with the correct guild ID
      expect(mockConfigService.getServerConfig).toHaveBeenCalledWith('test-guild-id');

      // Verify the channel IDs were set from the database
      expect(newNotificationManager['adminChannelId']).toBe('mock-admin-channel-id');
      expect(newNotificationManager['verificationChannelId']).toBe('mock-verification-channel-id');
    });
  });

  describe('logActionToMessage', () => {
    it('should update an existing message with action log', async () => {
      const mockMessage = {
        embeds: [{ data: { fields: [] } }],
        edit: jest.fn().mockResolvedValue(undefined),
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
      const mockMessage = {
        embeds: [{ data: { fields: [] } }],
        edit: jest.fn().mockResolvedValue(undefined),
      };
      const mockAdmin = { id: '987654321' };
      const mockThread = new MockThread();

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

      // Ensure the client has a user for permissions
      mockClient.user = { id: 'bot-user-id' };
    });

    it('should create a verification channel with correct permissions', async () => {
      const result = await notificationManager.setupVerificationChannel(
        mockGuild as any,
        mockRestrictedRole.id
      );

      // Check that the channel was created
      expect(result).toBe('verification-channel-id');
      expect(mockGuild.channels.create).toHaveBeenCalled();

      // Check the channel options
      const channelOptions = mockGuild.channels.create.mock.calls[0][0];
      expect(channelOptions.name).toBe('verification');
      expect(channelOptions.type).toBeDefined();

      // Check permission overwrites were provided
      expect(channelOptions.permissionOverwrites).toHaveLength(4); // everyone, restricted role, bot, admin role

      // Set the verification channel ID using the public method
      notificationManager.setVerificationChannelId('verification-channel-id');

      // Check that channel ID is set by mocking a method that would use it
      const mockChannel = { isTextBased: jest.fn().mockReturnValue(true) };
      mockClient.channels.fetch.mockResolvedValue(mockChannel);

      // Call getVerificationChannel through a public method that uses it
      await notificationManager.createVerificationThread(new MockGuildMember() as any);

      // Verify the channel fetch was called with the right ID
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('verification-channel-id');
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
