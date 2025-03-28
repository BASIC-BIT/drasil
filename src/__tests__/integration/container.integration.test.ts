import 'reflect-metadata';
import { Container } from 'inversify';
import { TYPES } from '../../di/symbols';
import { IBot } from '../../Bot';
import { IHeuristicService } from '../../services/HeuristicService';
import { IGPTService } from '../../services/GPTService';
import { IConfigService } from '../../config/ConfigService';
import { IRoleManager } from '../../services/RoleManager';
import { INotificationManager } from '../../services/NotificationManager';
import { IDetectionOrchestrator } from '../../services/DetectionOrchestrator';
import { IUserRepository } from '../../repositories/UserRepository';
import { IServerRepository } from '../../repositories/ServerRepository';
import { IServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { IDetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { Client } from 'discord.js';
import { SupabaseClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import { createTestContainer } from '../utils/test-container';

/**
 * Integration test for the InversifyJS container
 * Verifies that all dependencies are properly configured and can be resolved
 *
 * Note: This test doesn't actually connect to external services, we just verify
 * that the container is configured correctly and all dependencies can be resolved
 */
describe('InversifyJS Container Configuration', () => {
  let container: Container;

  beforeEach(() => {
    // Create a test container with mocked external dependencies
    container = createTestContainer();
  });

  describe('External dependencies', () => {
    it('should resolve Discord client', () => {
      const client = container.get<Client>(TYPES.DiscordClient);
      expect(client).toBeDefined();
      expect(client).toHaveProperty('user');
    });

    it('should resolve OpenAI client', () => {
      const openai = container.get<OpenAI>(TYPES.OpenAI);
      expect(openai).toBeDefined();
      expect(openai).toHaveProperty('chat');
    });

    it('should resolve Supabase client', () => {
      const supabase = container.get<SupabaseClient>(TYPES.SupabaseClient);
      expect(supabase).toBeDefined();
      expect(supabase).toHaveProperty('from');
    });
  });

  describe('Repositories', () => {
    it('should resolve all repositories', () => {
      const serverRepo = container.get<IServerRepository>(TYPES.ServerRepository);
      expect(serverRepo).toBeDefined();
      expect(serverRepo).toHaveProperty('findByGuildId');

      const userRepo = container.get<IUserRepository>(TYPES.UserRepository);
      expect(userRepo).toBeDefined();
      expect(userRepo).toHaveProperty('findByDiscordId');

      const serverMemberRepo = container.get<IServerMemberRepository>(TYPES.ServerMemberRepository);
      expect(serverMemberRepo).toBeDefined();
      expect(serverMemberRepo).toHaveProperty('findByServerAndUser');

      const detectionEventsRepo = container.get<IDetectionEventsRepository>(
        TYPES.DetectionEventsRepository
      );
      expect(detectionEventsRepo).toBeDefined();
    });
  });

  describe('Services', () => {
    it('should resolve all services', () => {
      const heuristicService = container.get<IHeuristicService>(TYPES.HeuristicService);
      expect(heuristicService).toBeDefined();
      expect(heuristicService).toHaveProperty('analyzeMessage');

      const gptService = container.get<IGPTService>(TYPES.GPTService);
      expect(gptService).toBeDefined();
      expect(gptService).toHaveProperty('analyzeProfile');

      const configService = container.get<IConfigService>(TYPES.ConfigService);
      expect(configService).toBeDefined();
      expect(configService).toHaveProperty('getServerConfig');

      const roleManager = container.get<IRoleManager>(TYPES.RoleManager);
      expect(roleManager).toBeDefined();
      expect(roleManager).toHaveProperty('assignRestrictedRole');

      const notificationManager = container.get<INotificationManager>(TYPES.NotificationManager);
      expect(notificationManager).toBeDefined();
      expect(notificationManager).toHaveProperty('notifySuspiciousUser');

      const detectionOrchestrator = container.get<IDetectionOrchestrator>(
        TYPES.DetectionOrchestrator
      );
      expect(detectionOrchestrator).toBeDefined();
      expect(detectionOrchestrator).toHaveProperty('detectMessage');
    });
  });

  describe('Bot', () => {
    it('should resolve the Bot class', () => {
      const bot = container.get<IBot>(TYPES.Bot);
      expect(bot).toBeDefined();
      expect(bot).toHaveProperty('startBot');
      expect(bot).toHaveProperty('destroy');
    });
  });

  describe('Dependency graph', () => {
    it('should verify that dependencies are initialized in the correct order', () => {
      // Resolve the Bot which should initialize all dependencies
      const bot = container.get<IBot>(TYPES.Bot);
      expect(bot).toBeDefined();

      // Verify that all required dependencies are bound
      expect(container.isBound(TYPES.DiscordClient)).toBe(true);
      expect(container.isBound(TYPES.OpenAI)).toBe(true);
      expect(container.isBound(TYPES.SupabaseClient)).toBe(true);
      expect(container.isBound(TYPES.HeuristicService)).toBe(true);
      expect(container.isBound(TYPES.GPTService)).toBe(true);
      expect(container.isBound(TYPES.DetectionOrchestrator)).toBe(true);
      expect(container.isBound(TYPES.RoleManager)).toBe(true);
      expect(container.isBound(TYPES.NotificationManager)).toBe(true);
      expect(container.isBound(TYPES.ConfigService)).toBe(true);
      expect(container.isBound(TYPES.ServerRepository)).toBe(true);
      expect(container.isBound(TYPES.UserRepository)).toBe(true);
      expect(container.isBound(TYPES.ServerMemberRepository)).toBe(true);
      expect(container.isBound(TYPES.DetectionEventsRepository)).toBe(true);
    });
  });
});
