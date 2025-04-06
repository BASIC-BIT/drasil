import 'reflect-metadata';
import { Container } from 'inversify';
import { Client, GatewayIntentBits } from 'discord.js';
import { OpenAI } from 'openai';
// import { SupabaseClient, createClient } from '@supabase/supabase-js'; // Remove Supabase client
import { PrismaClient } from '@prisma/client'; // Import Prisma client

import { TYPES } from './symbols';

// Import services and repositories
import { HeuristicService, IHeuristicService } from '../services/HeuristicService';
import { GPTService, IGPTService } from '../services/GPTService';
import { RoleManager, IRoleManager } from '../services/RoleManager';
import { NotificationManager, INotificationManager } from '../services/NotificationManager';
import { ServerRepository, IServerRepository } from '../repositories/ServerRepository';
import { UserRepository, IUserRepository } from '../repositories/UserRepository';
import {
  ServerMemberRepository,
  IServerMemberRepository,
} from '../repositories/ServerMemberRepository';
import {
  DetectionEventsRepository,
  IDetectionEventsRepository,
} from '../repositories/DetectionEventsRepository';
import { DetectionOrchestrator, IDetectionOrchestrator } from '../services/DetectionOrchestrator';
import { ConfigService, IConfigService } from '../config/ConfigService';
import { SecurityActionService, ISecurityActionService } from '../services/SecurityActionService';
import { UserModerationService, IUserModerationService } from '../services/UserModerationService';
import { Bot, IBot } from '../Bot';
import {
  IVerificationEventRepository,
  VerificationEventRepository,
} from '../repositories/VerificationEventRepository';
import {
  IAdminActionRepository,
  AdminActionRepository,
} from '../repositories/AdminActionRepository';
import { IAdminActionService, AdminActionService } from '../services/AdminActionService';
import { InteractionHandler, IInteractionHandler } from '../controllers/InteractionHandler';
import { CommandHandler, ICommandHandler } from '../controllers/CommandHandler';
import { IEventHandler, EventHandler } from '../controllers/EventHandler';
import { ThreadManager, IThreadManager } from '../services/ThreadManager';
import { EventBus, IEventBus } from '../events/EventBus'; // Moved import
import { RestrictionSubscriber } from '../events/subscribers/RestrictionSubscriber'; // Import Subscriber
import { NotificationSubscriber } from '../events/subscribers/NotificationSubscriber'; // Import Subscriber
import { RoleUpdateSubscriber } from '../events/subscribers/RoleUpdateSubscriber'; // Import Subscriber
import { ActionLogSubscriber } from '../events/subscribers/ActionLogSubscriber'; // Import Subscriber
import { ServerMemberStatusSubscriber } from '../events/subscribers/ServerMemberStatusSubscriber'; // Import Subscriber
import { VerificationReopenSubscriber } from '../events/subscribers/VerificationReopenSubscriber'; // Import new subscriber
import { DetectionResultHandlerSubscriber } from '../events/subscribers/DetectionResultHandlerSubscriber'; // Import new subscriber
import {
  ISubscriberInitializer,
  SubscriberInitializer,
} from '../initializers/SubscriberInitializer'; // Import Initializer
// Initialize container
const container = new Container();

/**
 * Configure the InversifyJS container with all dependencies
 */
export function configureContainer(): Container {
  // Configure external dependencies
  configureExternalDependencies(container);

  // Configure repositories
  configureRepositories(container);

  // Configure services
  configureServices(container);

  return container;
}

/**
 * Configure external dependencies like Discord, OpenAI, and Supabase clients
 */
function configureExternalDependencies(container: Container): void {
  // Discord client
  container.bind<Client>(TYPES.DiscordClient).toConstantValue(
    new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
    })
  );

  // OpenAI client
  container.bind<OpenAI>(TYPES.OpenAI).toConstantValue(
    new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    })
  );

  // Prisma Client
  // Instantiate Prisma Client (typically a singleton)
  const prismaClient = new PrismaClient();
  container.bind<PrismaClient>(TYPES.PrismaClient).toConstantValue(prismaClient);

  // Removed Supabase client binding
}

/**
 * Configure repository bindings
 */
function configureRepositories(container: Container): void {
  // Repository bindings
  container.bind<IServerRepository>(TYPES.ServerRepository).to(ServerRepository).inSingletonScope();

  container.bind<IUserRepository>(TYPES.UserRepository).to(UserRepository).inSingletonScope();

  container
    .bind<IServerMemberRepository>(TYPES.ServerMemberRepository)
    .to(ServerMemberRepository)
    .inSingletonScope();

  container
    .bind<IDetectionEventsRepository>(TYPES.DetectionEventsRepository)
    .to(DetectionEventsRepository)
    .inSingletonScope();

  // New repositories
  container
    .bind<IVerificationEventRepository>(TYPES.VerificationEventRepository)
    .to(VerificationEventRepository)
    .inSingletonScope();
  container
    .bind<IAdminActionRepository>(TYPES.AdminActionRepository)
    .to(AdminActionRepository)
    .inSingletonScope();

  // Add more repository bindings as they're refactored
}

/**
 * Configure service bindings
 */
function configureServices(container: Container): void {
  // Bind services to their implementations
  container.bind<IHeuristicService>(TYPES.HeuristicService).to(HeuristicService).inSingletonScope();

  container.bind<IGPTService>(TYPES.GPTService).to(GPTService).inSingletonScope();

  container.bind<IRoleManager>(TYPES.RoleManager).to(RoleManager).inSingletonScope();

  container
    .bind<INotificationManager>(TYPES.NotificationManager)
    .to(NotificationManager)
    .inSingletonScope();

  container.bind<IDetectionOrchestrator>(TYPES.DetectionOrchestrator).to(DetectionOrchestrator);
  container.bind<IConfigService>(TYPES.ConfigService).to(ConfigService);

  // Add SecurityActionService binding
  container
    .bind<ISecurityActionService>(TYPES.SecurityActionService)
    .to(SecurityActionService)
    .inSingletonScope();

  // Add UserModerationService binding
  container
    .bind<IUserModerationService>(TYPES.UserModerationService)
    .to(UserModerationService)
    .inSingletonScope();

  // Add Bot binding
  container.bind<IBot>(TYPES.Bot).to(Bot).inSingletonScope();

  // Add CommandHandler binding
  container.bind<ICommandHandler>(TYPES.CommandHandler).to(CommandHandler).inSingletonScope();

  // Add InteractionHandler binding
  container
    .bind<IInteractionHandler>(TYPES.InteractionHandler)
    .to(InteractionHandler)
    .inSingletonScope();

  // Add EventHandler binding
  container.bind<IEventHandler>(TYPES.EventHandler).to(EventHandler).inSingletonScope();

  container
    .bind<IAdminActionService>(TYPES.AdminActionService)
    .to(AdminActionService)
    .inSingletonScope();

  container.bind<IThreadManager>(TYPES.ThreadManager).to(ThreadManager).inSingletonScope();

  // Event Bus
  container.bind<IEventBus>(TYPES.EventBus).to(EventBus).inSingletonScope();

  // Subscribers (bind them so they can be injected and instantiated)
  container
    .bind<RestrictionSubscriber>(TYPES.RestrictionSubscriber)
    .to(RestrictionSubscriber)
    .inSingletonScope();
  container
    .bind<NotificationSubscriber>(TYPES.NotificationSubscriber)
    .to(NotificationSubscriber)
    .inSingletonScope();
  container
    .bind<RoleUpdateSubscriber>(TYPES.RoleUpdateSubscriber)
    .to(RoleUpdateSubscriber)
    .inSingletonScope();
  container
    .bind<ActionLogSubscriber>(TYPES.ActionLogSubscriber)
    .to(ActionLogSubscriber)
    .inSingletonScope();
  container
    .bind<ServerMemberStatusSubscriber>(TYPES.ServerMemberStatusSubscriber)
    .to(ServerMemberStatusSubscriber)
    .inSingletonScope();
  container
    .bind<VerificationReopenSubscriber>(TYPES.VerificationReopenSubscriber)
    .to(VerificationReopenSubscriber)
    .inSingletonScope();
  container
    .bind<DetectionResultHandlerSubscriber>(TYPES.DetectionResultHandlerSubscriber)
    .to(DetectionResultHandlerSubscriber)
    .inSingletonScope();

  // Initializers
  container
    .bind<ISubscriberInitializer>(TYPES.SubscriberInitializer)
    .to(SubscriberInitializer)
    .inSingletonScope();
}

export { container };
