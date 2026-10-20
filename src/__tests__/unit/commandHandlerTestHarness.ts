import type { AuthorityPort } from '@drasil/application';
import { buildCaseApplication } from './caseApplicationTestHarness';
import { CommandHandler } from '../../controllers/CommandHandler';

export function restoreUserInstallReportingEnvAfterEach(): void {
  const originalUserInstallReportingEnabled = process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED;

  afterEach(() => {
    if (originalUserInstallReportingEnabled === undefined) {
      delete process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED;
    } else {
      process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED = originalUserInstallReportingEnabled;
    }
  });
}

export type HandlerOverrides = Partial<{
  prepareReportBanReview: jest.Mock;
  reviewUncertainReportBan: jest.Mock;
  banUser: jest.Mock;
  banUserById: jest.Mock;
  updateSetupConfiguration: jest.Mock;
  updateServerConfig: jest.Mock;
  updateServerSettings: jest.Mock;
  getCachedServerConfig: jest.Mock;
  getServerConfig: jest.Mock;
  getHeuristicSettings: jest.Mock;
  updateHeuristicSettings: jest.Mock;
  resetHeuristicSettings: jest.Mock;
  handleUserReport: jest.Mock;
  handleMessageReport: jest.Mock;
  openAdminCase: jest.Mock;
  refreshCaseNotification: jest.Mock;
  repairActiveCase: jest.Mock;
  intakeRoleMembers: jest.Mock;
  setupVerificationChannel: jest.Mock;
  setupDiagnosticsService: any | null;
  validateGuildSetup: jest.Mock;
  validateSetupCandidate: jest.Mock;
  excludeDetectionFromAccounting: jest.Mock;
  restoreDetectionAccounting: jest.Mock;
  caseRoleLockdownService: any;
  moderationQueueService: any;
  integrityAuditService: any;
  client: any;
  caseAuthority: AuthorityPort;
}>;

export const buildHandler = (overrides: HandlerOverrides = {}) => {
  const userModerationService = {
    banUser: overrides.banUser ?? jest.fn().mockResolvedValue(true),
    banUserById: overrides.banUserById ?? jest.fn().mockResolvedValue(true),
  } as any;

  const updateSetupConfiguration =
    overrides.updateSetupConfiguration ??
    overrides.updateServerConfig ??
    jest.fn().mockResolvedValue({});
  const configService = {
    updateSetupConfiguration,
    updateServerConfig: overrides.updateServerConfig ?? jest.fn().mockResolvedValue({}),
    updateServerSettings: overrides.updateServerSettings ?? jest.fn().mockResolvedValue({}),
    getCachedServerConfig: overrides.getCachedServerConfig ?? jest.fn().mockReturnValue(null),
    getServerConfig:
      overrides.getServerConfig ??
      jest.fn().mockResolvedValue({
        settings: {},
      }),
    getHeuristicSettings:
      overrides.getHeuristicSettings ??
      jest.fn().mockResolvedValue({
        messageThreshold: 5,
        timeWindowMs: 10_000,
        suspiciousKeywords: ['free nitro'],
      }),
    updateHeuristicSettings:
      overrides.updateHeuristicSettings ??
      jest.fn().mockResolvedValue({
        messageThreshold: 5,
        timeWindowMs: 10_000,
        suspiciousKeywords: ['free nitro'],
      }),
    resetHeuristicSettings:
      overrides.resetHeuristicSettings ??
      jest.fn().mockResolvedValue({
        messageThreshold: 5,
        timeWindowMs: 10_000,
        suspiciousKeywords: ['free nitro'],
      }),
  } as any;

  const securityActionService = {
    prepareReportBanReview:
      overrides.prepareReportBanReview ??
      jest.fn().mockResolvedValue({
        operationId: 'operation-1',
        attemptToken: 'attempt-1',
        updatedAt: new Date(),
        targetUserId: 'target',
      }),
    reviewUncertainReportBan:
      overrides.reviewUncertainReportBan ?? jest.fn().mockResolvedValue(undefined),
    handleUserReport: overrides.handleUserReport ?? jest.fn().mockResolvedValue(true),
    handleMessageReport: overrides.handleMessageReport ?? jest.fn().mockResolvedValue(true),
    openAdminCase:
      overrides.openAdminCase ??
      jest.fn().mockResolvedValue({
        opened: true,
        caseRoleAttempted: false,
        caseRoleActive: false,
      }),
    refreshCaseNotification:
      overrides.refreshCaseNotification ??
      jest.fn().mockResolvedValue({
        refreshed: true,
        message: 'Refreshed pending case notification for test-user#0001.',
        verificationEventId: 'ver-1',
        status: 'pending',
        notificationChannelId: 'channel-1',
        notificationMessageId: 'message-1',
      }),
    repairActiveCase:
      overrides.repairActiveCase ??
      jest.fn().mockResolvedValue({
        repaired: true,
        message: 'Repaired active verification case for test-user#0001.',
        verificationEventId: 'ver-1',
        threadId: 'thread-1',
        threadCreated: false,
        userAdded: true,
        promptSent: true,
        promptAlreadyPresent: false,
      }),
    intakeRoleMembers:
      overrides.intakeRoleMembers ??
      jest.fn().mockResolvedValue({
        batchId: 'role-intake-1',
        roleId: 'role-1',
        roleName: 'restricted',
        action: 'open_case',
        execute: false,
        totalMembers: 2,
        eligibleMembers: 1,
        processed: 1,
        opened: 0,
        skippedBots: 1,
        skippedActiveCases: 0,
        skippedOverLimit: 0,
        failed: 0,
        failures: [],
      }),
    excludeDetectionFromAccounting:
      overrides.excludeDetectionFromAccounting ?? jest.fn().mockResolvedValue({ id: 'det-1' }),
    restoreDetectionAccounting:
      overrides.restoreDetectionAccounting ?? jest.fn().mockResolvedValue({ id: 'det-1' }),
  } as any;

  const notificationManager = {
    setupVerificationChannel:
      overrides.setupVerificationChannel ??
      jest.fn().mockImplementation(async (...args: unknown[]) => args[4] ?? 'created-channel-1'),
  } as any;
  const setupDiagnosticsService =
    overrides.setupDiagnosticsService === null
      ? undefined
      : ({
          validateGuildSetup:
            overrides.validateGuildSetup ??
            jest.fn().mockResolvedValue({
              guildId: 'guild-1',
              checkedAt: new Date('2026-01-01T00:00:00.000Z'),
              issues: [],
              errorCount: 0,
              warningCount: 0,
            }),
          validateSetupCandidate:
            overrides.validateSetupCandidate ??
            jest.fn().mockResolvedValue({
              guildId: 'guild-1',
              checkedAt: new Date('2026-01-01T00:00:00.000Z'),
              issues: [],
              errorCount: 0,
              warningCount: 0,
            }),
        } as any);
  const client =
    overrides.client ??
    ({
      user: { id: 'client-1' },
    } as any);

  const caseRepository = {
    findActiveByUserAndServer: jest.fn(async (userId: string) => ({
      id: 'ver-1',
      user_id: userId,
      server_id: 'guild-1',
      status: 'pending',
    })),
    findByUserAndServer: jest.fn(async (userId: string) => [
      { id: 'ver-1', user_id: userId, server_id: 'guild-1', status: 'pending' },
    ]),
    findById: jest.fn(async (id: string) => ({
      id,
      user_id: 'user-2',
      server_id: 'guild-1',
      status: 'pending',
    })),
  } as any;
  const application = buildCaseApplication(
    {
      client:
        overrides.client ??
        ({
          guilds: {
            fetch: jest.fn(async () => ({
              id: 'guild-1',
              members: {
                me: { permissions: { has: () => true } },
                fetchMe: jest.fn().mockResolvedValue({ permissions: { has: () => true } }),
                fetch: jest.fn(async (id: string) => ({ id })),
              },
            })),
          },
          users: {
            fetch: jest.fn(async (id: string) =>
              id.startsWith('user-') ? { id, tag: 'target#0001' } : { id }
            ),
          },
        } as any),
      configService,
      verificationEventRepository: caseRepository,
      detectionEventsRepository: { findById: jest.fn() } as any,
      securityActionService,
      userModerationService,
      roleGateService: null,
    },
    overrides.caseAuthority
  );

  return {
    handler: new CommandHandler(
      client,
      {} as any,
      notificationManager,
      configService,
      userModerationService,
      securityActionService,
      undefined,
      setupDiagnosticsService,
      overrides.caseRoleLockdownService,
      overrides.moderationQueueService,
      overrides.integrityAuditService,
      undefined,
      application
    ),
    client,
    userModerationService,
    notificationManager,
    configService,
    securityActionService,
    setupDiagnosticsService,
    integrityAuditService: overrides.integrityAuditService,
  };
};
