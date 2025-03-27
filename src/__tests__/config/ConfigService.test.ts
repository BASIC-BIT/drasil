import { ConfigService } from '../../config/ConfigService';
import { ServerRepository } from '../../repositories/ServerRepository';
import { Server, ServerSettings } from '../../repositories/types';
import * as supabaseConfig from '../../config/supabase';

// Mock the ServerRepository
jest.mock('../../repositories/ServerRepository');

// Mock the Supabase configuration
jest.mock('../../config/supabase', () => ({
  isSupabaseConfigured: jest.fn().mockReturnValue(true),
  supabase: {
    from: jest.fn(),
  },
}));

describe('ConfigService', () => {
  let configService: ConfigService;
  let mockServerRepository: jest.Mocked<ServerRepository>;
  let originalEnv: typeof process.env;
  const fixedDate = new Date('2023-01-01T00:00:00.000Z');

  const mockServer: Server = {
    id: 'local-123456789012345678',
    guild_id: '123456789012345678',
    restricted_role_id: 'env-role-id',
    admin_channel_id: 'env-channel-id',
    verification_channel_id: 'env-verification-id',
    admin_notification_role_id: 'env-notification-id',
    is_active: true,
    settings: {
      message_threshold: 5,
      message_timeframe: 10,
      suspicious_keywords: ['free nitro', 'discord nitro', 'claim your prize'],
      min_confidence_threshold: 70,
      auto_restrict: true,
      use_gpt_on_join: true,
      gpt_message_check_count: 3,
      message_retention_days: 7,
      detection_retention_days: 30,
    },
    created_at: fixedDate.toISOString(),
    updated_at: fixedDate.toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(fixedDate);

    // Store original environment
    originalEnv = process.env;

    // Set up environment variables
    process.env = {
      ...originalEnv,
      RESTRICTED_ROLE_ID: 'env-role-id',
      ADMIN_CHANNEL_ID: 'env-channel-id',
      VERIFICATION_CHANNEL_ID: 'env-verification-id',
      ADMIN_NOTIFICATION_ROLE_ID: 'env-notification-id',
    };

    // Set up the mocked ServerRepository instance
    mockServerRepository = {
      findAllActive: jest.fn().mockResolvedValue([mockServer]),
      findByGuildId: jest.fn().mockResolvedValue(mockServer),
      upsertByGuildId: jest.fn().mockImplementation(async (guildId, data) => ({
        ...mockServer,
        ...data,
        id: `local-${guildId}`,
        guild_id: guildId,
        updated_at: new Date().toISOString(),
      })),
      updateSettings: jest.fn().mockImplementation(async (guildId, settings) => ({
        ...mockServer,
        id: `local-${guildId}`,
        guild_id: guildId,
        settings: { ...mockServer.settings, ...settings },
        updated_at: new Date().toISOString(),
      })),
      setActive: jest.fn().mockImplementation(async (guildId, isActive) => ({
        ...mockServer,
        id: `local-${guildId}`,
        guild_id: guildId,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })),
      findById: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    } as unknown as jest.Mocked<ServerRepository>;

    // Mock the constructor to return our mocked instance
    (ServerRepository as jest.MockedClass<typeof ServerRepository>).mockImplementation(
      () => mockServerRepository
    );

    configService = new ConfigService();
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = originalEnv;
  });

  describe('initialize', () => {
    it('should load active servers into cache when Supabase is configured', async () => {
      (supabaseConfig.isSupabaseConfigured as jest.Mock).mockReturnValue(true);

      await configService.initialize();

      expect(mockServerRepository.findAllActive).toHaveBeenCalledTimes(1);

      const cachedServer = await configService.getServerConfig(mockServer.guild_id);
      expect(cachedServer).toEqual(mockServer);
      expect(mockServerRepository.findByGuildId).not.toHaveBeenCalled();
    });

    it('should warn and not load servers when Supabase is not configured', async () => {
      (supabaseConfig.isSupabaseConfigured as jest.Mock).mockReturnValue(false);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await configService.initialize();

      expect(mockServerRepository.findAllActive).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Supabase is not configured. Using environment variables for configuration.'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('getServerConfig', () => {
    it('should return server from cache if available', async () => {
      // Add server to cache
      configService['serverCache'].set(mockServer.guild_id, mockServer);

      const server = await configService.getServerConfig(mockServer.guild_id);
      expect(server).toEqual(mockServer);
      expect(mockServerRepository.findByGuildId).not.toHaveBeenCalled();
    });

    it('should fetch from database if not in cache', async () => {
      (supabaseConfig.isSupabaseConfigured as jest.Mock).mockReturnValue(true);
      mockServerRepository.findByGuildId.mockResolvedValueOnce(mockServer);

      const server = await configService.getServerConfig(mockServer.guild_id);
      expect(server).toEqual(mockServer);
      expect(mockServerRepository.findByGuildId).toHaveBeenCalledWith(mockServer.guild_id);
    });

    it('should create default config if not found in database', async () => {
      (supabaseConfig.isSupabaseConfigured as jest.Mock).mockReturnValue(true);
      mockServerRepository.findByGuildId.mockResolvedValueOnce(null);
      mockServerRepository.upsertByGuildId.mockResolvedValueOnce({
        ...mockServer,
        id: 'local-new-guild-id',
        guild_id: 'new-guild-id',
        updated_at: fixedDate.toISOString(),
      });

      // When Supabase is configured, it should try to save the default config
      expect(mockServerRepository.upsertByGuildId).toHaveBeenCalledWith('new-guild-id', {
        guild_id: 'new-guild-id',
        restricted_role_id: 'env-role-id',
        admin_channel_id: 'env-channel-id',
        verification_channel_id: 'env-verification-id',
        admin_notification_role_id: 'env-notification-id',
        is_active: true,
        settings: {
          message_threshold: 5,
          message_timeframe: 10,
          suspicious_keywords: ['free nitro', 'discord nitro', 'claim your prize'],
          min_confidence_threshold: 70,
          auto_restrict: true,
          use_gpt_on_join: true,
          gpt_message_check_count: 3,
          message_retention_days: 7,
          detection_retention_days: 30,
        },
      });
    });
  });

  describe('updateServerConfig', () => {
    it('should update server in database and cache when Supabase is configured', async () => {
      (supabaseConfig.isSupabaseConfigured as jest.Mock).mockReturnValue(true);

      const updateData = {
        restricted_role_id: 'new-role-id',
        settings: {
          message_threshold: 10,
        },
      };

      // First get the server to cache it
      await configService.getServerConfig(mockServer.guild_id);

      const updatedServer = await configService.updateServerConfig(mockServer.guild_id, updateData);

      expect(mockServerRepository.upsertByGuildId).toHaveBeenCalledWith(
        mockServer.guild_id,
        updateData
      );

      expect(updatedServer).toEqual({
        ...mockServer,
        ...updateData,
        updated_at: fixedDate.toISOString(),
      });

      // Verify cache was updated
      const cachedServer = await configService.getServerConfig(mockServer.guild_id);
      expect(cachedServer).toEqual(updatedServer);
    });

    it('should update server in cache when Supabase fails', async () => {
      mockServerRepository.upsertByGuildId.mockRejectedValue(new Error('Database error'));

      // First get the server to cache it
      await configService.getServerConfig(mockServer.guild_id);

      const updateData = {
        restricted_role_id: 'new-role-id',
      };

      const updatedServer = await configService.updateServerConfig(mockServer.guild_id, updateData);

      expect(updatedServer).toEqual({
        ...mockServer,
        ...updateData,
        updated_at: fixedDate.toISOString(),
      });

      // Verify cache was updated
      const cachedServer = await configService.getServerConfig(mockServer.guild_id);
      expect(cachedServer).toEqual(updatedServer);
    });
  });

  describe('updateServerSettings', () => {
    it('should merge settings with existing ones', async () => {
      (supabaseConfig.isSupabaseConfigured as jest.Mock).mockReturnValue(true);
      // Add server to cache
      configService['serverCache'].set(mockServer.guild_id, mockServer);

      const newSettings: Partial<ServerSettings> = {
        message_timeframe: 20,
        auto_restrict: false,
        suspicious_keywords: ['free nitro'],
      };

      mockServerRepository.upsertByGuildId.mockResolvedValueOnce({
        ...mockServer,
        settings: {
          ...mockServer.settings,
          ...newSettings,
        },
        updated_at: fixedDate.toISOString(),
      });

      const updatedServer = await configService.updateServerSettings(
        mockServer.guild_id,
        newSettings
      );

      expect(mockServerRepository.upsertByGuildId).toHaveBeenCalledWith(mockServer.guild_id, {
        settings: {
          message_threshold: 5,
          message_timeframe: 20,
          suspicious_keywords: ['free nitro'],
          min_confidence_threshold: 70,
          auto_restrict: false,
          use_gpt_on_join: true,
          gpt_message_check_count: 3,
          message_retention_days: 7,
          detection_retention_days: 30,
        },
      });

      expect(updatedServer.settings).toEqual({
        message_threshold: 5,
        message_timeframe: 20,
        suspicious_keywords: ['free nitro'],
        min_confidence_threshold: 70,
        auto_restrict: false,
        use_gpt_on_join: true,
        gpt_message_check_count: 3,
        message_retention_days: 7,
        detection_retention_days: 30,
      });
    });
  });
});
