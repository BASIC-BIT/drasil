import { Client, GuildMember, ThreadAutoArchiveDuration } from 'discord.js';
import { NotificationManager } from '../../services/NotificationManager';
import { DetectionResult } from '../../services/DetectionOrchestrator';

// Mock classes
class MockThread {
  send = jest.fn().mockResolvedValue(undefined);
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
  id = 'mock-user-id';
  username = 'MockUser';
  tag = 'MockUser#1234';
  displayAvatarURL = () => 'https://example.com/avatar.png';
  createdTimestamp = Date.now() - 1000000;
}

class MockGuildMember {
  id = 'mock-member-id';
  user: MockUser;
  joinedAt = new Date();

  constructor() {
    this.user = new MockUser();
  }
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
    notificationManager = new NotificationManager(mockClient as unknown as Client);
  });

  describe('notifySuspiciousUser', () => {
    it('should send a notification message to the admin channel', async () => {
      notificationManager.setAdminChannelId('mock-channel-id');
      const mockDetectionResult: DetectionResult = {
        label: 'SUSPICIOUS',
        confidence: 0.85,
        usedGPT: true,
        reason: 'Suspicious behavior detected',
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
          reason: 'test',
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
        { label: 'SUSPICIOUS', confidence: 0.85, usedGPT: true, reason: 'test' }
      );

      expect(result).toBe(false);
    });
  });

  describe('createVerificationThread', () => {
    it('should create a verification thread successfully', async () => {
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
      });
    });

    it('should return false if admin channel ID is not configured', async () => {
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
        reason: 'test',
      });

      expect(mockClient.channels.fetch).toHaveBeenCalledWith(newChannelId);
    });
  });
});
