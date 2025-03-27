import { globalConfig } from '../../config/GlobalConfig';

describe('GlobalConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables before each test
    process.env = { ...originalEnv };
    // Reset singleton instance by accessing private property (for testing only)
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

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getSettings', () => {
    it('should return default settings when no overrides are provided', () => {
      const settings = globalConfig.getSettings();
      expect(settings).toEqual({
        autoSetupVerificationChannels: true,
        defaultServerSettings: {
          messageThreshold: 5,
          messageTimeframe: 10,
          minConfidenceThreshold: 70,
          messageRetentionDays: 7,
          detectionRetentionDays: 30,
        },
        defaultSuspiciousKeywords: ['free nitro', 'discord nitro', 'claim your prize'],
      });
    });

    it('should respect environment variable overrides', () => {
      process.env.AUTO_SETUP_VERIFICATION_CHANNELS = 'false';

      // Reset singleton to pick up new env vars
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

      const settings = globalConfig.getSettings();
      expect(settings.autoSetupVerificationChannels).toBe(false);
    });

    it('should return a copy of settings to prevent direct modification', () => {
      const settings = globalConfig.getSettings();
      settings.autoSetupVerificationChannels = false;

      const newSettings = globalConfig.getSettings();
      expect(newSettings.autoSetupVerificationChannels).toBe(true);
    });
  });

  describe('updateSettings', () => {
    it('should update settings with partial changes', () => {
      globalConfig.updateSettings({
        autoSetupVerificationChannels: false,
        defaultServerSettings: {
          messageThreshold: 10,
          messageTimeframe: 20,
          minConfidenceThreshold: 80,
          messageRetentionDays: 14,
          detectionRetentionDays: 60,
        },
      });

      const settings = globalConfig.getSettings();
      expect(settings).toEqual({
        autoSetupVerificationChannels: false,
        defaultServerSettings: {
          messageThreshold: 10,
          messageTimeframe: 20,
          minConfidenceThreshold: 80,
          messageRetentionDays: 14,
          detectionRetentionDays: 60,
        },
        defaultSuspiciousKeywords: ['free nitro', 'discord nitro', 'claim your prize'],
      });
    });

    it('should allow updating individual properties', () => {
      globalConfig.updateSettings({
        autoSetupVerificationChannels: false,
      });

      const settings = globalConfig.getSettings();
      expect(settings.autoSetupVerificationChannels).toBe(false);
      expect(settings.defaultServerSettings.messageThreshold).toBe(5); // Original value
    });

    it('should preserve unmodified settings', () => {
      const originalSettings = globalConfig.getSettings();
      globalConfig.updateSettings({
        defaultSuspiciousKeywords: ['test keyword'],
      });

      const newSettings = globalConfig.getSettings();
      expect(newSettings.autoSetupVerificationChannels).toBe(
        originalSettings.autoSetupVerificationChannels
      );
      expect(newSettings.defaultServerSettings).toEqual(originalSettings.defaultServerSettings);
      expect(newSettings.defaultSuspiciousKeywords).toEqual(['test keyword']);
    });
  });
});
