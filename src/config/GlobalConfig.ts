/**
 * Global configuration settings for the bot
 * These settings apply across all servers/guilds
 */

export interface GlobalSettings {
  /**
   * Whether to automatically set up verification channels when joining new servers
   */
  autoSetupVerificationChannels: boolean;

  /**
   * Whether to use the new verification flow with dedicated events table
   */
  useNewVerificationFlow: boolean;

  /**
   * Default settings for new servers
   */
  defaultServerSettings: {
    messageThreshold: number;
    messageTimeframe: number;
    minConfidenceThreshold: number;
    messageRetentionDays: number;
    detectionRetentionDays: number;
  };

  /**
   * Default suspicious keywords
   */
  defaultSuspiciousKeywords: string[];
}

/**
 * Global configuration singleton
 */
class GlobalConfig {
  private static instance: GlobalConfig;
  private settings: GlobalSettings;

  private constructor() {
    // Initialize with default settings
    this.settings = {
      autoSetupVerificationChannels: true, // Default to true for convenience
      useNewVerificationFlow: false, // Default to false for gradual rollout
      defaultServerSettings: {
        messageThreshold: 5,
        messageTimeframe: 10,
        minConfidenceThreshold: 70,
        messageRetentionDays: 7,
        detectionRetentionDays: 30,
      },
      defaultSuspiciousKeywords: ['free nitro', 'discord nitro', 'claim your prize'],
    };

    // Load settings from environment variables
    this.loadFromEnvironment();
  }

  private loadFromEnvironment(): void {
    // Override with environment variables if provided
    if (process.env.AUTO_SETUP_VERIFICATION_CHANNELS === 'false') {
      this.settings.autoSetupVerificationChannels = false;
    }
    if (process.env.USE_NEW_VERIFICATION_FLOW === 'true') {
      this.settings.useNewVerificationFlow = true;
    }
  }

  public static getInstance(): GlobalConfig {
    if (!GlobalConfig.instance) {
      GlobalConfig.instance = new GlobalConfig();
    }
    return GlobalConfig.instance;
  }

  public getSettings(): GlobalSettings {
    // Reload from environment variables before returning
    this.loadFromEnvironment();
    return { ...this.settings }; // Return a copy to prevent direct modification
  }

  public updateSettings(newSettings: Partial<GlobalSettings>): void {
    this.settings = {
      ...this.settings,
      ...newSettings,
    };
  }
}

// Export a singleton instance
export const globalConfig = GlobalConfig.getInstance();
