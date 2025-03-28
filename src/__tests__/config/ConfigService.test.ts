import { ConfigService } from '../../config/ConfigService';
import { ServerRepository } from '../../repositories/ServerRepository';
import { Server, ServerSettings } from '../../repositories/types';
import * as supabaseConfig from '../../config/supabase';
import { globalConfig } from '../../config/GlobalConfig';

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
    guild_id: '123456789012345678',
    restricted_role_id: undefined,
    admin_channel_id: undefined,
    verification_channel_id: undefined,
    admin_notification_role_id: undefined,
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

    // Set up the mocked ServerRepository instance
    mockServerRepository = {
      findAllActive: jest.fn().mockResolvedValue([mockServer]),
      findByGuildId: jest.fn().mockResolvedValue(mockServer),
      upsertByGuildId: jest.fn().mockImplementation(async (guildId, data) => ({
        ...mockServer,
        ...data,
        guild_id: guildId,
        updated_at: new Date().toISOString(),
      })),
      updateSettings: jest.fn().mockImplementation(async (guildId, settings) => ({
        ...mockServer,
        guild_id: guildId,
        settings: { ...mockServer.settings, ...settings },
        updated_at: new Date().toISOString(),
      })),
      setActive: jest.fn().mockImplementation(async (guildId, isActive) => ({
        ...mockServer,
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

      // Reset mocks
      mockServerRepository.findByGuildId.mockReset();
      mockServerRepository.upsertByGuildId.mockReset();

      // Mock findByGuildId to return null for the first call only (when checking if server exists)
      mockServerRepository.findByGuildId.mockImplementation(() => {
        if (mockServerRepository.findByGuildId.mock.calls.length === 1) {
          return Promise.resolve(null);
        } else {
          // For subsequent calls, return the saved server
          return Promise.resolve({
            ...mockServer,
            guild_id: 'new-guild-id',
            updated_at: fixedDate.toISOString(),
          });
        }
      });

      // Mock upsertByGuildId to return the saved server
      mockServerRepository.upsertByGuildId.mockResolvedValue({
        ...mockServer,
        guild_id: 'new-guild-id',
        updated_at: fixedDate.toISOString(),
      });

      // Call getServerConfig to trigger the creation of a default config
      const result = await configService.getServerConfig('new-guild-id');

      // Verify the result has expected properties
      expect(result.guild_id).toBe('new-guild-id');
      expect(result.restricted_role_id).toBeUndefined();
      expect(result.admin_channel_id).toBeUndefined();
      expect(result.verification_channel_id).toBeUndefined();
      expect(result.admin_notification_role_id).toBeUndefined();
      expect(result.is_active).toBe(true);

      // Verify upsertByGuildId was called
      expect(mockServerRepository.upsertByGuildId).toHaveBeenCalled();

      // Verify settings match the expected values
      expect(result.settings).toEqual({
        message_threshold: 5,
        message_timeframe: 10,
        suspicious_keywords: ['free nitro', 'discord nitro', 'claim your prize'],
        min_confidence_threshold: 70,
        auto_restrict: true,
        use_gpt_on_join: true,
        gpt_message_check_count: 3,
        message_retention_days: 7,
        detection_retention_days: 30,
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

  describe('createDefaultServerConfig', () => {
    const testGuildId = '123456789';

    beforeEach(() => {
      // Reset global config to default settings
      (globalConfig as any).settings = {
        autoSetupVerificationChannels: true,
        defaultServerSettings: {
          messageThreshold: 5,
          messageTimeframe: 10,
          minConfidenceThreshold: 70,
          messageRetentionDays: 7,
          detectionRetentionDays: 30,
        },
        defaultSuspiciousKeywords: ['free nitro', 'discord nitro', 'claim your prize'],
      };
    });

    it('should create default config using global settings', async () => {
      // Mock the repository's upsert method
      mockServerRepository.upsertByGuildId.mockResolvedValueOnce({
        guild_id: testGuildId,
        restricted_role_id: undefined,
        admin_channel_id: undefined,
        verification_channel_id: undefined,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Server);

      const config = await configService.getServerConfig(testGuildId);

      // Verify the settings match global config
      const globalSettings = globalConfig.getSettings();
      expect(config.settings).toEqual({
        message_threshold: globalSettings.defaultServerSettings.messageThreshold,
        message_timeframe: globalSettings.defaultServerSettings.messageTimeframe,
        suspicious_keywords: globalSettings.defaultSuspiciousKeywords,
        min_confidence_threshold: globalSettings.defaultServerSettings.minConfidenceThreshold,
        auto_restrict: true,
        use_gpt_on_join: true,
        gpt_message_check_count: 3,
        message_retention_days: globalSettings.defaultServerSettings.messageRetentionDays,
        detection_retention_days: globalSettings.defaultServerSettings.detectionRetentionDays,
      });
    });

    it('should use updated global settings when creating new server config', async () => {
      // Update global settings
      globalConfig.updateSettings({
        defaultServerSettings: {
          messageThreshold: 10,
          messageTimeframe: 20,
          minConfidenceThreshold: 80,
          messageRetentionDays: 14,
          detectionRetentionDays: 60,
        },
        defaultSuspiciousKeywords: ['test keyword'],
      });

      // Mock the repository's upsert method
      mockServerRepository.upsertByGuildId.mockResolvedValueOnce({
        guild_id: testGuildId,
        restricted_role_id: undefined,
        admin_channel_id: undefined,
        verification_channel_id: undefined,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Server);

      const config = await configService.getServerConfig(testGuildId);

      // Verify the settings match updated global config
      const globalSettings = globalConfig.getSettings();
      expect(config.settings).toEqual({
        message_threshold: globalSettings.defaultServerSettings.messageThreshold,
        message_timeframe: globalSettings.defaultServerSettings.messageTimeframe,
        suspicious_keywords: globalSettings.defaultSuspiciousKeywords,
        min_confidence_threshold: globalSettings.defaultServerSettings.minConfidenceThreshold,
        auto_restrict: true,
        use_gpt_on_join: true,
        gpt_message_check_count: 3,
        message_retention_days: globalSettings.defaultServerSettings.messageRetentionDays,
        detection_retention_days: globalSettings.defaultServerSettings.detectionRetentionDays,
      });
    });

    it('should preserve existing server settings when updating', async () => {
      // Mock an existing server configuration
      const existingServer: Server = {
        guild_id: testGuildId,
        is_active: true,
        settings: {
          message_threshold: 15,
          message_timeframe: 30,
          suspicious_keywords: ['custom keyword'],
          min_confidence_threshold: 90,
          auto_restrict: false,
          use_gpt_on_join: false,
          gpt_message_check_count: 5,
          message_retention_days: 10,
          detection_retention_days: 45,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Clear any previous mock implementations
      mockServerRepository.findByGuildId.mockReset();

      // Set up the mock to return the existing server for this specific test
      mockServerRepository.findByGuildId.mockImplementation((id) => {
        console.log(`findByGuildId called with: ${id}`);
        if (id === testGuildId) {
          console.log('Returning existing server');
          return Promise.resolve(existingServer);
        }
        console.log('Returning null');
        return Promise.resolve(null);
      });

      // Ensure Supabase is configured for this test
      (supabaseConfig.isSupabaseConfigured as jest.Mock).mockReturnValue(true);

      // Call the private method directly
      const config = await configService['createDefaultServerConfig'](testGuildId);

      console.log('Existing server settings:', existingServer.settings);
      console.log('Config settings:', config.settings);

      // Verify the existing settings are preserved
      expect(config.settings).toEqual(existingServer.settings);
    });
  });
});
