import { Client, GuildMember, ThreadAutoArchiveDuration, ThreadChannel } from 'discord.js';
import { NotificationManager } from '../../services/NotificationManager';
import { DetectionResult } from '../../services/DetectionOrchestrator';

// Mock classes
class MockThread {
  send = jest.fn().mockResolvedValue(undefined);
  members = {
    add: jest.fn().mockResolvedValue(undefined),
  };
  url = 'https://discord.com/channels/123456789/987654321'; // Mock thread URL
}

class MockThreadManager {
  create = jest.fn().mockImplementation(() => {
    const thread = new MockThread();
    return Promise.resolve(thread);
  });
}

class MockMessage {
  embeds = [];
  components = [];
  edit = jest.fn().mockResolvedValue(undefined);
  url = 'https://discord.com/channels/123456789/message/123456';
}

class MockTextChannel {
  send = jest.fn().mockImplementation(() => {
    const message = new MockMessage();
    return Promise.resolve(message);
  });
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
});
