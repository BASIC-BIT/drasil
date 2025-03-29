import 'reflect-metadata';
import { Container } from 'inversify';
import { Client, GatewayIntentBits } from 'discord.js';
import { OpenAI } from 'openai';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

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
import {
  VerificationThreadRepository,
  IVerificationThreadRepository,
} from '../repositories/VerificationThreadRepository';
import { DetectionOrchestrator, IDetectionOrchestrator } from '../services/DetectionOrchestrator';
import { ConfigService, IConfigService } from '../config/ConfigService';
import { UserService, IUserService } from '../services/UserService';
import { ServerService, IServerService } from '../services/ServerService';
import { SecurityActionService, ISecurityActionService } from '../services/SecurityActionService';
import { Bot, IBot } from '../Bot';

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

  // Supabase client
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_KEY || '';

  container.bind<SupabaseClient>(TYPES.SupabaseClient).toConstantValue(
    createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
      },
    })
  );
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

  container
    .bind<IVerificationThreadRepository>(TYPES.VerificationThreadRepository)
    .to(VerificationThreadRepository)
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

  // Add UserService binding
  container.bind(TYPES.UserService).to(UserService).inSingletonScope();

  // Add ServerService binding
  container.bind<IServerService>(TYPES.ServerService).to(ServerService).inSingletonScope();

  // Add SecurityActionService binding
  container.bind<ISecurityActionService>(TYPES.SecurityActionService)
    .to(SecurityActionService)
    .inSingletonScope();

  // Add Bot binding
  container.bind<IBot>(TYPES.Bot).to(Bot).inSingletonScope();

  // Add more service bindings as they're refactored
}

export { container };
