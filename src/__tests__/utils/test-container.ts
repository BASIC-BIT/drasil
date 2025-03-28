import 'reflect-metadata';
import { Container } from 'inversify';
import { TYPES } from '../../di/symbols';

// Import interfaces
import { IHeuristicService } from '../../services/HeuristicService';
import { IGPTService } from '../../services/GPTService';
import { IDetectionOrchestrator } from '../../services/DetectionOrchestrator';
import { IRoleManager } from '../../services/RoleManager';
import { INotificationManager } from '../../services/NotificationManager';
import { IConfigService } from '../../config/ConfigService';
import { IUserRepository } from '../../repositories/UserRepository';
import { IServerRepository } from '../../repositories/ServerRepository';
import { IServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { IDetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { Client } from 'discord.js';
import { OpenAI } from 'openai';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates mock implementations for all services and repositories
 * @returns Object containing all mock services and repositories
 */
export function createMocks() {
  // Create mocks for all services
  const mockHeuristicService: jest.Mocked<IHeuristicService> = {
    analyzeMessage: jest.fn().mockReturnValue({ result: 'OK', reasons: [] }),
    isMessageSuspicious: jest.fn().mockReturnValue(false),
    isFrequencyAboveThreshold: jest.fn().mockReturnValue(false),
    containsSuspiciousKeywords: jest.fn().mockReturnValue(false),
    clearMessageHistory: jest.fn(),
  };

  const mockGPTService: jest.Mocked<IGPTService> = {
    analyzeProfile: jest.fn().mockResolvedValue({
      result: 'OK',
      confidence: 0.1,
      reasons: [],
    }),
  };

  const mockDetectionOrchestrator: jest.Mocked<IDetectionOrchestrator> = {
    detectMessage: jest.fn().mockResolvedValue({
      label: 'OK',
      confidence: 0.1,
      reasons: [],
      usedGPT: false,
      triggerSource: 'message',
      triggerContent: '',
    }),
    detectNewJoin: jest.fn().mockResolvedValue({
      label: 'OK',
      confidence: 0.1,
      reasons: [],
      usedGPT: false,
      triggerSource: 'join',
      triggerContent: '',
    }),
  };

  const mockRoleManager: jest.Mocked<IRoleManager> = {
    initialize: jest.fn().mockResolvedValue(undefined),
    setRestrictedRoleId: jest.fn(),
    getRestrictedRoleId: jest.fn().mockReturnValue('mock-role-id'),
    assignRestrictedRole: jest.fn().mockResolvedValue(true),
    removeRestrictedRole: jest.fn().mockResolvedValue(true),
  };

  const mockNotificationManager: jest.Mocked<INotificationManager> = {
    initialize: jest.fn().mockResolvedValue(undefined),
    setAdminChannelId: jest.fn(),
    setVerificationChannelId: jest.fn(),
    notifySuspiciousUser: jest.fn().mockResolvedValue({}),
    createVerificationThread: jest.fn().mockResolvedValue({}),
    logActionToMessage: jest.fn().mockResolvedValue(true),
    setupVerificationChannel: jest.fn().mockResolvedValue('mock-channel-id'),
  };

  const mockConfigService: jest.Mocked<IConfigService> = {
    initialize: jest.fn().mockResolvedValue(undefined),
    getServerConfig: jest.fn().mockResolvedValue({
      guild_id: 'mock-guild-id',
      restricted_role_id: 'mock-role-id',
      admin_channel_id: 'mock-channel-id',
      verification_channel_id: 'mock-verification-channel-id',
      is_active: true,
      settings: {
        message_threshold: 5,
        message_timeframe: 10,
        min_confidence_threshold: 0.7,
        auto_restrict: true,
        use_gpt_on_join: true,
        suspicious_keywords: ['free nitro', 'discord nitro'],
        message_retention_days: 7,
        detection_retention_days: 30,
        gpt_message_check_count: 3,
      },
    }),
    updateServerConfig: jest.fn().mockImplementation(async (guildId, data) => ({
      guild_id: guildId,
      ...data,
    })),
    updateServerSettings: jest.fn().mockImplementation(async (guildId, settings) => ({
      guild_id: guildId,
      settings,
    })),
    clearCache: jest.fn(),
  };

  // Create mocks for all repositories
  const mockUserRepository: jest.Mocked<IUserRepository> = {
    findByDiscordId: jest.fn().mockResolvedValue(null),
    upsertByDiscordId: jest.fn().mockImplementation(async (discordId, data) => ({
      id: 'mock-user-id',
      discord_id: discordId,
      ...data,
    })),
    updateReputationScore: jest.fn().mockResolvedValue({
      id: 'mock-user-id',
      discord_id: 'mock-discord-id',
      global_reputation_score: 100,
    }),
    findByReputationBelow: jest.fn().mockResolvedValue([]),
  };

  const mockServerRepository: jest.Mocked<IServerRepository> = {
    findByGuildId: jest.fn().mockResolvedValue(null),
    findAllActive: jest.fn().mockResolvedValue([]),
    upsertByGuildId: jest.fn().mockImplementation(async (guildId, data) => ({
      id: 'mock-server-id',
      guild_id: guildId,
      ...data,
    })),
  };

  const mockServerMemberRepository: jest.Mocked<IServerMemberRepository> = {
    findByServerAndUser: jest.fn().mockResolvedValue(null),
    findByServer: jest.fn().mockResolvedValue([]),
    findRestrictedMembers: jest.fn().mockResolvedValue([]),
    upsertMember: jest.fn().mockImplementation(async (serverId, userId, data) => ({
      id: 'mock-member-id',
      server_id: serverId,
      user_id: userId,
      ...data,
    })),
    updateReputationScore: jest.fn().mockResolvedValue({
      id: 'mock-member-id',
      reputation_score: 100,
    }),
    incrementMessageCount: jest.fn().mockResolvedValue({
      id: 'mock-member-id',
      message_count: 1,
    }),
    updateRestrictionStatus: jest
      .fn()
      .mockImplementation(async (serverId, userId, isRestricted) => ({
        id: 'mock-member-id',
        server_id: serverId,
        user_id: userId,
        is_restricted: isRestricted,
      })),
    findMany: jest.fn().mockResolvedValue([]),
  };

  const mockDetectionEventsRepository: jest.Mocked<IDetectionEventsRepository> = {
    createDetectionEvent: jest.fn().mockImplementation(async (data) => ({
      id: 'mock-event-id',
      ...data,
    })),
    findByServerAndUser: jest.fn().mockResolvedValue([]),
    findRecentByServerAndUser: jest.fn().mockResolvedValue([]),
    countRecentByServerAndUser: jest.fn().mockResolvedValue(0),
    cleanupOldEvents: jest.fn().mockResolvedValue(0),
  };

  // External dependencies
  const mockDiscordClient: jest.Mocked<Partial<Client>> = {
    login: jest.fn().mockResolvedValue('mock-token'),
    destroy: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    once: jest.fn(),
    user: {
      id: 'mock-bot-id',
      tag: 'MockBot#0000',
    },
  };

  const mockOpenAI: jest.Mocked<Partial<OpenAI>> = {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: '{"result": "OK", "confidence": 0.9, "reasons": []}',
              },
            },
          ],
        }),
      },
    },
  };

  const mockSupabaseClient: jest.Mocked<Partial<SupabaseClient>> = {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      gt: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      and: jest.fn().mockReturnThis(),
      match: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockReturnThis(),
      filter: jest.fn().mockReturnThis(),
      then: jest.fn().mockImplementation((callback) => {
        return Promise.resolve(callback({ data: [], error: null }));
      }),
    }),
  };

  return {
    // Services
    mockHeuristicService,
    mockGPTService,
    mockDetectionOrchestrator,
    mockRoleManager,
    mockNotificationManager,
    mockConfigService,

    // Repositories
    mockUserRepository,
    mockServerRepository,
    mockServerMemberRepository,
    mockDetectionEventsRepository,

    // External dependencies
    mockDiscordClient,
    mockOpenAI,
    mockSupabaseClient,
  };
}

/**
 * Create a test container with mock implementations
 * @param customMocks Optional custom mocks to override the default ones
 * @returns Configured InversifyJS container for testing
 */
export function createTestContainer(
  customMocks?: Partial<ReturnType<typeof createMocks>>
): Container {
  const container = new Container();
  const mocks = { ...createMocks(), ...customMocks };

  // Bind external dependencies
  container.bind(TYPES.DiscordClient).toConstantValue(mocks.mockDiscordClient as Client);
  container.bind(TYPES.OpenAI).toConstantValue(mocks.mockOpenAI as OpenAI);
  container.bind(TYPES.SupabaseClient).toConstantValue(mocks.mockSupabaseClient as SupabaseClient);

  // Bind services
  container
    .bind<IHeuristicService>(TYPES.HeuristicService)
    .toConstantValue(mocks.mockHeuristicService);
  container.bind<IGPTService>(TYPES.GPTService).toConstantValue(mocks.mockGPTService);
  container
    .bind<IDetectionOrchestrator>(TYPES.DetectionOrchestrator)
    .toConstantValue(mocks.mockDetectionOrchestrator);
  container.bind<IRoleManager>(TYPES.RoleManager).toConstantValue(mocks.mockRoleManager);
  container
    .bind<INotificationManager>(TYPES.NotificationManager)
    .toConstantValue(mocks.mockNotificationManager);
  container.bind<IConfigService>(TYPES.ConfigService).toConstantValue(mocks.mockConfigService);

  // Bind repositories
  container.bind<IUserRepository>(TYPES.UserRepository).toConstantValue(mocks.mockUserRepository);
  container
    .bind<IServerRepository>(TYPES.ServerRepository)
    .toConstantValue(mocks.mockServerRepository);
  container
    .bind<IServerMemberRepository>(TYPES.ServerMemberRepository)
    .toConstantValue(mocks.mockServerMemberRepository);
  container
    .bind<IDetectionEventsRepository>(TYPES.DetectionEventsRepository)
    .toConstantValue(mocks.mockDetectionEventsRepository);

  return container;
}

/**
 * Creates a container with real implementations but mock dependencies
 * This is useful for testing a specific service with mocked dependencies
 *
 * @param serviceIdentifier The symbol for the service to test
 * @param serviceImplementation The concrete implementation of the service
 * @param customMocks Optional custom mocks to override the default ones
 * @returns Container configured for testing the specified service
 */
export function createServiceTestContainer<T>(
  serviceIdentifier: symbol,
  serviceImplementation: new (...args: any[]) => T,
  customMocks?: Partial<ReturnType<typeof createMocks>>
): Container {
  const container = createTestContainer(customMocks);

  // Rebind the service to use the real implementation
  container.unbind(serviceIdentifier);
  container.bind<T>(serviceIdentifier).to(serviceImplementation);

  return container;
}
