import 'reflect-metadata';
import { Container } from 'inversify';
import { Client, GatewayIntentBits } from 'discord.js';
import OpenAI from 'openai';
import { createPrismaClient, PrismaClient } from '../db/prisma';

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
  IMessageContextRepository,
  MessageContextRepository,
} from '../repositories/MessageContextRepository';
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
import {
  IVerificationThreadAnalysisService,
  VerificationThreadAnalysisService,
} from '../services/VerificationThreadAnalysisService';
import {
  IProductAnalyticsService,
  ProductAnalyticsService,
} from '../services/ProductAnalyticsService';
import {
  ISetupDiagnosticsService,
  SetupDiagnosticsService,
} from '../services/SetupDiagnosticsService';
import {
  ICaseRoleLockdownService,
  CaseRoleLockdownService,
} from '../services/CaseRoleLockdownService';
import {
  IReportIntakeRepository,
  ReportIntakeRepository,
} from '../repositories/ReportIntakeRepository';
import {
  IModerationOutcomeRepository,
  ModerationOutcomeRepository,
} from '../repositories/ModerationOutcomeRepository';
import {
  IModerationQueueRepository,
  ModerationQueueRepository,
} from '../repositories/ModerationQueueRepository';
import {
  IIntegrityAuditRepository,
  IntegrityAuditRepository,
} from '../repositories/IntegrityAuditRepository';
import {
  IReportCandidateService,
  ReportCandidateService,
} from '../services/ReportCandidateService';
import { IReportIntakeService, ReportIntakeService } from '../services/ReportIntakeService';
import {
  CaseReviewReminderService,
  ICaseReviewReminderService,
} from '../services/CaseReviewReminderService';
import {
  IReportIntakeAgentService,
  ReportIntakeAgentService,
} from '../services/ReportIntakeAgentService';
import {
  IModerationOutcomeService,
  ModerationOutcomeService,
} from '../services/ModerationOutcomeService';
import {
  IModerationQueueService,
  ModerationQueueService,
} from '../services/ModerationQueueService';
import {
  IRoleQuarantineSnapshotRepository,
  RoleQuarantineSnapshotRepository,
} from '../repositories/RoleQuarantineSnapshotRepository';
import { IRoleQuarantineService, RoleQuarantineService } from '../services/RoleQuarantineService';
import { IIntegrityAuditService, IntegrityAuditService } from '../services/IntegrityAuditService';
import { IRoleGateService, RoleGateService } from '../services/RoleGateService';
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
 * Configure external dependencies like Discord and OpenAI clients
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
        GatewayIntentBits.GuildModeration,
      ],
    })
  );

  // OpenAI client
  container.bind<OpenAI>(TYPES.OpenAI).toConstantValue(
    new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    })
  );

  const prismaClient = createPrismaClient();
  container.bind<PrismaClient>(TYPES.PrismaClient).toConstantValue(prismaClient);

  // Supabase client removed; Prisma is used for persistence
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
    .bind<IMessageContextRepository>(TYPES.MessageContextRepository)
    .to(MessageContextRepository)
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
  container
    .bind<IReportIntakeRepository>(TYPES.ReportIntakeRepository)
    .to(ReportIntakeRepository)
    .inSingletonScope();
  container
    .bind<IModerationOutcomeRepository>(TYPES.ModerationOutcomeRepository)
    .to(ModerationOutcomeRepository)
    .inSingletonScope();
  container
    .bind<IModerationQueueRepository>(TYPES.ModerationQueueRepository)
    .to(ModerationQueueRepository)
    .inSingletonScope();
  container
    .bind<IRoleQuarantineSnapshotRepository>(TYPES.RoleQuarantineSnapshotRepository)
    .to(RoleQuarantineSnapshotRepository)
    .inSingletonScope();
  container
    .bind<IIntegrityAuditRepository>(TYPES.IntegrityAuditRepository)
    .to(IntegrityAuditRepository)
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
  container.bind<IConfigService>(TYPES.ConfigService).to(ConfigService).inSingletonScope();

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

  container
    .bind<IVerificationThreadAnalysisService>(TYPES.VerificationThreadAnalysisService)
    .to(VerificationThreadAnalysisService)
    .inSingletonScope();

  container
    .bind<IProductAnalyticsService>(TYPES.ProductAnalyticsService)
    .to(ProductAnalyticsService)
    .inSingletonScope();

  container
    .bind<ISetupDiagnosticsService>(TYPES.SetupDiagnosticsService)
    .to(SetupDiagnosticsService)
    .inSingletonScope();

  container
    .bind<ICaseRoleLockdownService>(TYPES.CaseRoleLockdownService)
    .to(CaseRoleLockdownService)
    .inSingletonScope();

  container
    .bind<IReportCandidateService>(TYPES.ReportCandidateService)
    .to(ReportCandidateService)
    .inSingletonScope();

  container
    .bind<IReportIntakeService>(TYPES.ReportIntakeService)
    .to(ReportIntakeService)
    .inSingletonScope();

  container
    .bind<IReportIntakeAgentService>(TYPES.ReportIntakeAgentService)
    .to(ReportIntakeAgentService)
    .inSingletonScope();

  container
    .bind<ICaseReviewReminderService>(TYPES.CaseReviewReminderService)
    .to(CaseReviewReminderService)
    .inSingletonScope();

  container
    .bind<IModerationOutcomeService>(TYPES.ModerationOutcomeService)
    .to(ModerationOutcomeService)
    .inSingletonScope();

  container
    .bind<IModerationQueueService>(TYPES.ModerationQueueService)
    .to(ModerationQueueService)
    .inSingletonScope();
  container
    .bind<IRoleQuarantineService>(TYPES.RoleQuarantineService)
    .to(RoleQuarantineService)
    .inSingletonScope();

  container
    .bind<IIntegrityAuditService>(TYPES.IntegrityAuditService)
    .to(IntegrityAuditService)
    .inSingletonScope();

  container.bind<IRoleGateService>(TYPES.RoleGateService).to(RoleGateService).inSingletonScope();
}

export { container };
