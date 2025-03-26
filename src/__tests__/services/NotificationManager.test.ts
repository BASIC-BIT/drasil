import { Client, GuildMember, ThreadAutoArchiveDuration } from 'discord.js';
import { NotificationManager } from '../../services/NotificationManager';
import { DetectionResult } from '../../services/DetectionOrchestrator';

// Mock classes
class MockThread {
  send = jest.fn().mockResolvedValue(undefined);
  members = {
    add: jest.fn().mockResolvedValue(undefined),
  };
}

class MockThreadManager {
  create = jest.fn().mockImplementation(() => {
    const thread = new MockThread();
    return Promise.resolve(thread);
  });
}

class MockTextChannel {
  send = jest.fn().mockResolvedValue(undefined);
  threads = new MockThreadManager();
  isTextBased() {
    return true;
  }
  isDMBased() {
    return false;
  }
}

class MockChannelManager {
  private channel: MockTextChannel;
  constructor() {
    this.channel = new MockTextChannel();
  }
  fetch = jest.fn().mockImplementation(() => Promise.resolve(this.channel));
}

class MockClient {
  channels: MockChannelManager;
  constructor() {
    this.channels = new MockChannelManager();
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

describe('NotificationManager', () => {
  let notificationManager: NotificationManager;
  let mockClient: MockClient;
  let mockMember: MockGuildMember;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = new MockClient();
    mockMember = new MockGuildMember();
    delete process.env.ADMIN_CHANNEL_ID;
    delete process.env.VERIFICATION_CHANNEL_ID;
    notificationManager = new NotificationManager(mockClient as unknown as Client);
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

      expect(result).toBe(true);
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('mock-channel-id');
      const channel = await mockClient.channels.fetch();
      expect(channel.send).toHaveBeenCalled();

      // Verify the sent message has embeds and components
      const sentMessage = (channel.send as jest.Mock).mock.calls[0][0];
      expect(sentMessage.embeds).toBeDefined();
      expect(sentMessage.components).toBeDefined();
    });

    it('should return false if admin channel ID is not configured', async () => {
      const result = await notificationManager.notifySuspiciousUser(
        mockMember as unknown as GuildMember,
        {
          label: 'SUSPICIOUS',
          confidence: 0.85,
          usedGPT: true,
          reasons: ['test'],
          triggerSource: 'message',
        }
      );

      expect(result).toBe(false);
      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    });

    it('should return false if fetching the channel fails', async () => {
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
        }
      );

      expect(result).toBe(false);
    });
  });

  describe('createVerificationThread', () => {
    it('should create a verification thread successfully using admin channel', async () => {
      notificationManager.setAdminChannelId('mock-channel-id');
      const result = await notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      expect(result).toBe(true);
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('mock-channel-id');

      const channel = await mockClient.channels.fetch();
      expect(channel.threads.create).toHaveBeenCalledWith({
        name: `Verification: ${mockMember.user.username}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: expect.stringContaining('Verification thread for suspicious user'),
        type: 11, // PrivateThread
      });

      // Verify member is added to the thread
      const thread = await channel.threads.create();
      expect(thread.members.add).toHaveBeenCalledWith(mockMember.id);
    });

    it('should create a verification thread successfully using verification channel', async () => {
      notificationManager.setVerificationChannelId('verification-channel-id');
      const result = await notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      expect(result).toBe(true);
      expect(mockClient.channels.fetch).toHaveBeenCalledWith('verification-channel-id');
    });

    it('should return false if no channel IDs are configured', async () => {
      const result = await notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      expect(result).toBe(false);
      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    });

    it('should return false if creating the thread fails', async () => {
      notificationManager.setAdminChannelId('mock-channel-id');
      const channel = await mockClient.channels.fetch();
      channel.threads.create.mockRejectedValueOnce(new Error('Failed to create thread'));

      const result = await notificationManager.createVerificationThread(
        mockMember as unknown as GuildMember
      );

      expect(result).toBe(false);
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
      });

      expect(mockClient.channels.fetch).toHaveBeenCalledWith(newChannelId);
    });
  });

  describe('setVerificationChannelId', () => {
    it('should update the verification channel ID', async () => {
      const newChannelId = 'new-verification-channel-id';
      notificationManager.setVerificationChannelId(newChannelId);
      notificationManager.setAdminChannelId('admin-channel-id'); // Set admin channel too

      // Create a thread, it should use the verification channel
      await notificationManager.createVerificationThread(mockMember as unknown as GuildMember);

      expect(mockClient.channels.fetch).toHaveBeenCalledWith(newChannelId);
    });
  });

  // Add test for new logActionToMessage method
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

    it('should append to existing action log if one exists', async () => {
      const existingActionLog = '• <@123456> verified the user <t:1234567890:R>';
      const mockMessage = {
        embeds: [
          {
            data: {
              fields: [{ name: 'Action Log', value: existingActionLog }],
            },
          },
        ],
        edit: jest.fn().mockResolvedValue(undefined),
      };
      const mockAdmin = { id: '987654321' };

      await notificationManager.logActionToMessage(
        mockMessage as any,
        'banned the user',
        mockAdmin as any
      );

      // Check that the existing log is preserved in the update
      const editCall = mockMessage.edit.mock.calls[0][0];
      const updatedField = editCall.embeds[0].data.fields.find((f) => f.name === 'Action Log');
      expect(updatedField.value).toContain(existingActionLog);
      expect(updatedField.value).toContain('banned the user');
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
});
