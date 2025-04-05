// symbols.ts - Constants used for DI bindings

/**
 * Symbols for dependency injection
 * These are used as identifiers for binding and resolving dependencies
 */
export const TYPES = {
  // Core classes
  Bot: Symbol.for('Bot'),

  // Services
  HeuristicService: Symbol.for('HeuristicService'),
  GPTService: Symbol.for('GPTService'),
  DetectionOrchestrator: Symbol.for('DetectionOrchestrator'),
  RoleManager: Symbol.for('RoleManager'),
  NotificationManager: Symbol.for('NotificationManager'),
  ConfigService: Symbol.for('ConfigService'),
  UserService: Symbol.for('UserService'),
  SecurityActionService: Symbol.for('SecurityActionService'),
  UserModerationService: Symbol.for('UserModerationService'),

  // Repositories
  BaseRepository: Symbol.for('BaseRepository'),
  SupabaseRepository: Symbol.for('SupabaseRepository'),
  ServerRepository: Symbol.for('ServerRepository'),
  UserRepository: Symbol.for('UserRepository'),
  ServerMemberRepository: Symbol.for('ServerMemberRepository'),
  PrismaClient: Symbol.for('PrismaClient'),
  DetectionEventsRepository: Symbol.for('DetectionEventsRepository'),

  // External dependencies
  DiscordClient: Symbol.for('DiscordClient'),
  OpenAI: Symbol.for('OpenAI'),
  SupabaseClient: Symbol.for('SupabaseClient'),

  // Configuration
  GlobalConfig: Symbol.for('GlobalConfig'),

  // Discord modules
  VerificationReopenSubscriber: Symbol.for('VerificationReopenSubscriber'),
  CommandHandler: Symbol.for('CommandHandler'),
  EventHandler: Symbol.for('EventHandler'),
  InteractionHandler: Symbol.for('InteractionHandler'),

  ThreadManager: Symbol.for('ThreadManager'),

  // New repositories
  VerificationEventRepository: Symbol.for('VerificationEventRepository'),
  AdminActionRepository: Symbol.for('AdminActionRepository'),

  AdminActionService: Symbol.for('AdminActionService'),
  EventBus: Symbol.for('EventBus'),

  // Subscribers
  RestrictionSubscriber: Symbol.for('RestrictionSubscriber'),
  NotificationSubscriber: Symbol.for('NotificationSubscriber'),
  RoleUpdateSubscriber: Symbol.for('RoleUpdateSubscriber'),
  ActionLogSubscriber: Symbol.for('ActionLogSubscriber'),
  ServerMemberStatusSubscriber: Symbol.for('ServerMemberStatusSubscriber'),
  DetectionResultHandlerSubscriber: Symbol.for('DetectionResultHandlerSubscriber'),
};
