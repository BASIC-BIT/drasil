import { injectable, inject } from 'inversify';
import {
  Client,
  Guild,
  GuildMember,
  Message,
  TextChannel,
  ThreadChannel,
  ThreadAutoArchiveDuration,
  ChannelType,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { VerificationStatus, VerificationEvent } from '../repositories/types';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { IUserRepository } from '../repositories/UserRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import {
  enforceDiscordMessageLimit,
  renderVerificationPromptTemplate,
  resolveVerificationPromptTemplate,
  VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY,
} from '../utils/verificationPromptTemplate';
import { DetectionResult } from './DetectionOrchestrator';
import { getCaseResponderSettings } from '../utils/caseResponderSettings';

export const VERIFICATION_THREAD_TYPE_METADATA_KEY = 'thread_type';
export const VERIFICATION_THREAD_TYPE = 'verification';
export const REPORT_REVIEW_THREAD_TYPE = 'report_review';
export const PRIVATE_EVIDENCE_THREAD_TYPE = 'private_evidence';
export const REPORT_INTAKE_THREAD_NAME_PREFIX = 'Report intake:';
export const CASE_STAFF_ROUTING_METADATA_KEY = 'case_staff_routing';
const FLAGGED_USER_THREAD_ADD_RETRY_DELAYS_MS = [750, 1500, 3000] as const;
const INITIAL_VERIFICATION_PROMPT_SCAN_LIMIT = 100;

export interface VerificationThreadRepairResult {
  threadId: string | null;
  threadCreated: boolean;
  userAdded: boolean;
  promptSent: boolean;
  promptAlreadyPresent: boolean;
}

/**
 * Interface for NotificationManager service
 */
export interface IThreadManager {
  /**
   * Creates a thread for a suspicious user in the verification channel
   * @param member The suspicious guild member
   * @returns Promise resolving to the created thread or null if creation failed
   */
  createVerificationThread(
    member: GuildMember,
    verificationEvent: VerificationEvent
  ): Promise<ThreadChannel | null>;

  repairVerificationThread(
    member: GuildMember,
    verificationEvent: VerificationEvent
  ): Promise<VerificationThreadRepairResult>;

  createReportReviewThread(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<ThreadChannel | null>;

  createPrivateEvidenceThread(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<ThreadChannel | null>;

  createReportIntakeThread(
    channel: TextChannel,
    reporter: GuildMember
  ): Promise<ThreadChannel | null>;

  activateReportIntakeThread(thread: ThreadChannel, reporter: GuildMember): Promise<boolean>;

  /**
   * Resolve a verification thread
   * @param verificationEvent The verification event
   * @param resolution The resolution of the thread (verified, banned, ignored)
   * @param resolvedBy The Discord ID of the user who resolved the thread
   * @returns Whether the thread was successfully resolved
   */
  resolveVerificationThread(
    verificationEvent: VerificationEvent,
    resolution: VerificationStatus,
    resolvedBy: string
  ): Promise<boolean>;

  /**
   * Reopens a verification thread
   * @param verificationEvent The verification event
   * @returns Whether the thread was successfully reopened
   */
  reopenVerificationThread(verificationEvent: VerificationEvent): Promise<boolean>;
}

/**
 * Service for managing threads
 * It is NOT intended to perform any action secondary actions
 * STRICTLY only for calling the discord client to manage threads
 */
@injectable()
export class ThreadManager implements IThreadManager {
  private client: Client;
  private configService: IConfigService;
  private verificationEventRepository: IVerificationEventRepository;
  private userRepository: IUserRepository;
  private serverRepository: IServerRepository;
  private serverMemberRepository: IServerMemberRepository;

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.UserRepository) userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) serverRepository: IServerRepository,
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository
  ) {
    this.client = client;
    this.configService = configService;
    this.verificationEventRepository = verificationEventRepository;
    this.userRepository = userRepository;
    this.serverRepository = serverRepository;
    this.serverMemberRepository = serverMemberRepository;
  }

  private async getInitialVerificationPrompt(member: GuildMember): Promise<string> {
    const userMention = `<@${member.id}>`;

    try {
      const serverConfig = await this.configService.getServerConfig(member.guild.id);
      const template = resolveVerificationPromptTemplate(
        serverConfig.settings[VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY]
      );

      return renderVerificationPromptTemplate(template, {
        userMention,
        serverName: member.guild.name,
      });
    } catch (error) {
      console.warn(
        `Failed to load verification prompt template for guild ${member.guild.id}; using default:`,
        error
      );
      return renderVerificationPromptTemplate(resolveVerificationPromptTemplate(undefined), {
        userMention,
        serverName: member.guild.name,
      });
    }
  }

  private buildReportReviewThreadMessage(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): string {
    const reasonLines = detectionResult.reasons.length
      ? detectionResult.reasons.map((reason) => `- ${reason}`)
      : ['- No reason provided.'];
    const contentLines = [
      `Review-only report opened for ${member.user.tag} (${member.id}).`,
      'No automatic restriction was applied. Do not add the reported user unless moderators decide to engage them.',
      '',
      'Report details:',
      ...reasonLines,
    ];

    if (detectionResult.triggerContent) {
      contentLines.push('', `Context: ${detectionResult.triggerContent}`);
    }
    if (sourceMessage?.url) {
      contentLines.push(`Source message: ${sourceMessage.url}`);
    }

    return enforceDiscordMessageLimit(contentLines.join('\n'));
  }

  private buildPrivateEvidenceThreadMessage(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): string {
    const reasonLines = detectionResult.reasons.length
      ? detectionResult.reasons.map((reason) => `- ${reason}`)
      : ['- No reason provided.'];
    const links = [
      verificationEvent.thread_id
        ? `User-facing case thread: https://discord.com/channels/${member.guild.id}/${verificationEvent.thread_id}`
        : null,
      sourceMessage?.url ? `Source message: ${sourceMessage.url}` : null,
    ].filter((line): line is string => Boolean(line));

    return enforceDiscordMessageLimit(
      [
        `Private evidence workspace for ${member.user.tag} (${member.id}).`,
        'Admin-only discussion and evidence can be added here. Do not add the user under review to this thread.',
        '',
        `Case ID: ${verificationEvent.id}`,
        ...links,
        '',
        'Case details:',
        ...reasonLines,
        detectionResult.triggerContent ? `Context: ${detectionResult.triggerContent}` : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n')
    );
  }

  private buildReportIntakeThreadMessage(reporter: GuildMember): string {
    return enforceDiscordMessageLimit(
      [
        `Thanks <@${reporter.id}>. Please put the report context in this private thread.`,
        '',
        'Useful context includes:',
        '- Who or what you are reporting, if you know it',
        '- Message links, screenshots, usernames, user IDs, or mentions',
        '- What happened and why it looked suspicious',
        '',
        'If you opened this by mistake, send `close report`.',
        '',
        'Moderators can ask follow-up questions here. Do not add the reported user to this thread.',
      ].join('\n')
    );
  }

  private async storeThreadId(
    verificationEvent: VerificationEvent,
    threadId: string,
    threadType: typeof VERIFICATION_THREAD_TYPE | typeof REPORT_REVIEW_THREAD_TYPE,
    extraMetadata: Record<string, unknown> = {}
  ): Promise<void> {
    const metadata =
      verificationEvent.metadata &&
      typeof verificationEvent.metadata === 'object' &&
      !Array.isArray(verificationEvent.metadata)
        ? { ...verificationEvent.metadata }
        : {};

    verificationEvent.thread_id = threadId;
    verificationEvent.metadata = {
      ...metadata,
      [VERIFICATION_THREAD_TYPE_METADATA_KEY]: threadType,
      ...extraMetadata,
    };
    await this.verificationEventRepository.update(verificationEvent.id, verificationEvent);
  }

  private async storePrivateEvidenceThreadId(
    verificationEvent: VerificationEvent,
    threadId: string
  ): Promise<void> {
    verificationEvent.private_evidence_thread_id = threadId;
    await this.verificationEventRepository.update(verificationEvent.id, {
      private_evidence_thread_id: threadId,
    });
  }

  private async addCaseResponderMembers(
    guild: Guild,
    thread: ThreadChannel,
    excludedUserIds: readonly string[]
  ): Promise<{ addedUserIds: string[]; warnings: string[] }> {
    const warnings: string[] = [];
    const addedUserIds = new Set<string>();
    const excluded = new Set(excludedUserIds);
    const serverConfig = await this.configService.getServerConfig(guild.id).catch((error) => {
      warnings.push('Could not load case responder settings; staff member auto-add skipped.');
      console.warn(
        `Failed to load case responder settings for guild ${guild.id}; skipping staff routing:`,
        error
      );
      return null;
    });

    if (!serverConfig) {
      return { addedUserIds: [], warnings };
    }

    const settings = getCaseResponderSettings(serverConfig.settings);

    if (settings.routingMode !== 'ping_and_add_members' || settings.roleIds.length === 0) {
      return { addedUserIds: [], warnings };
    }

    for (const roleId of settings.roleIds) {
      const role = await guild.roles.fetch(roleId).catch((error) => {
        warnings.push(`Could not fetch responder role ${roleId}.`);
        console.warn(`Failed to fetch case responder role ${roleId} in guild ${guild.id}:`, error);
        return null;
      });
      if (!role) {
        continue;
      }

      const roleMemberIds = [...role.members.values()]
        .map((roleMember) => roleMember.id)
        .filter((userId) => !excluded.has(userId));

      if (roleMemberIds.length > settings.threadMemberCap) {
        warnings.push(
          `Responder role ${roleId} has ${roleMemberIds.length} cached members, above cap ${settings.threadMemberCap}; ping-only fallback used for that role.`
        );
        continue;
      }

      for (const userId of roleMemberIds) {
        if (addedUserIds.has(userId)) {
          continue;
        }

        try {
          await thread.members.add(userId);
          addedUserIds.add(userId);
        } catch (error) {
          warnings.push(`Could not add responder member ${userId} from role ${roleId}.`);
          console.warn(
            `Failed to add case responder member ${userId} to thread ${thread.id}:`,
            error
          );
        }
      }
    }

    return { addedUserIds: [...addedUserIds], warnings };
  }

  private buildCaseStaffRoutingMetadata(routingResult: {
    addedUserIds: string[];
    warnings: string[];
  }): Record<string, unknown> {
    if (routingResult.addedUserIds.length === 0 && routingResult.warnings.length === 0) {
      return {};
    }

    return {
      [CASE_STAFF_ROUTING_METADATA_KEY]: {
        addedUserIds: routingResult.addedUserIds,
        warnings: routingResult.warnings,
        at: new Date().toISOString(),
      },
    };
  }

  private buildThreadSetupError(stage: string, error: unknown): Error {
    const message = error instanceof Error && error.message ? error.message : String(error);
    return new Error(`Failed to ${stage}: ${message || 'Unknown error'}`);
  }

  private async wait(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  private async refreshMember(member: GuildMember): Promise<void> {
    const fetchMember = (member as { fetch?: (force?: boolean) => Promise<GuildMember> }).fetch;
    if (!fetchMember) {
      return;
    }

    await fetchMember.call(member, true).catch((error) => {
      console.warn(`Failed to refresh member ${member.id} before thread add retry:`, error);
    });
  }

  private async addFlaggedUserToVerificationThread(
    member: GuildMember,
    thread: ThreadChannel
  ): Promise<void> {
    let lastError: unknown;

    try {
      await thread.members.add(member.id);
      return;
    } catch (error) {
      lastError = error;
    }

    for (const retryDelay of FLAGGED_USER_THREAD_ADD_RETRY_DELAYS_MS) {
      console.warn(
        `Failed to add ${member.id} to verification thread ${thread.id}; retrying in ${retryDelay}ms:`,
        lastError
      );
      await this.wait(retryDelay);
      await this.refreshMember(member);

      try {
        await thread.members.add(member.id);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  private async fetchStoredThread(
    verificationEvent: VerificationEvent
  ): Promise<ThreadChannel | null> {
    if (!verificationEvent.thread_id) {
      return null;
    }

    const parentChannels: TextChannel[] = [];
    const verificationChannel = await this.configService.getVerificationChannel(
      verificationEvent.server_id
    );
    if (verificationChannel) {
      parentChannels.push(verificationChannel);
    }

    const adminChannel = await this.configService.getAdminChannel(verificationEvent.server_id);
    if (adminChannel && !parentChannels.some((channel) => channel.id === adminChannel.id)) {
      parentChannels.push(adminChannel);
    }

    for (const parentChannel of parentChannels) {
      const thread = await parentChannel.threads
        .fetch(verificationEvent.thread_id)
        .catch(() => null);
      if (thread?.isThread()) {
        return thread;
      }
    }

    const fetchChannel = (
      this.client.channels as { fetch?: (id: string) => Promise<unknown> } | undefined
    )?.fetch;
    const fetchedChannel = fetchChannel
      ? await fetchChannel.call(this.client.channels, verificationEvent.thread_id).catch(() => null)
      : null;
    if (!fetchedChannel) {
      return null;
    }

    const maybeThread = fetchedChannel as ThreadChannel;
    return maybeThread.isThread() ? maybeThread : null;
  }

  private async fetchThreadById(threadId: string): Promise<ThreadChannel | null> {
    const fetchChannel = (
      this.client.channels as { fetch?: (id: string) => Promise<unknown> } | undefined
    )?.fetch;
    const fetchedChannel = fetchChannel
      ? await fetchChannel.call(this.client.channels, threadId).catch(() => null)
      : null;
    if (!fetchedChannel) {
      return null;
    }

    const maybeThread = fetchedChannel as ThreadChannel;
    return maybeThread.isThread() ? maybeThread : null;
  }

  private async sendInitialVerificationPrompt(
    member: GuildMember,
    thread: ThreadChannel
  ): Promise<void> {
    const rawInitialPrompt = await this.getInitialVerificationPrompt(member);
    const initialPrompt = enforceDiscordMessageLimit(rawInitialPrompt);
    if (initialPrompt.length < rawInitialPrompt.length) {
      console.warn(
        `Verification prompt exceeded Discord content limit for guild ${member.guild.id}; truncated before sending.`
      );
    }

    await thread.send({
      content: initialPrompt,
      allowedMentions: {
        parse: [],
        users: [member.id],
        roles: [],
        repliedUser: false,
      },
    });
  }

  private async hasInitialVerificationPrompt(
    member: GuildMember,
    thread: ThreadChannel
  ): Promise<boolean> {
    const messages = await thread.messages.fetch({ limit: INITIAL_VERIFICATION_PROMPT_SCAN_LIMIT });
    const botUserId = this.client.user?.id;

    return [...messages.values()].some((message) => {
      const isFromBot =
        (botUserId && message.author.id === botUserId) || (!botUserId && message.author.bot);
      return isFromBot && message.content.includes(`<@${member.id}>`);
    });
  }

  /**
   * Creates a thread for a suspicious user in the verification channel
   * @param member The suspicious guild member
   * @returns Promise resolving to the created thread or null if creation failed
   */
  public async createVerificationThread(
    member: GuildMember,
    verificationEvent: VerificationEvent
  ): Promise<ThreadChannel | null> {
    // Try verification channel first, fall back to admin channel if not configured
    const channel =
      (await this.configService.getVerificationChannel(member.guild.id)) ||
      (await this.configService.getAdminChannel(member.guild.id));

    if (!channel) {
      console.error('No verification or admin channel ID configured');
      return null;
    }

    let setupStage = 'prepare verification thread records';
    let threadWasCreated = false;

    try {
      // Ensure the server exists
      await this.serverRepository.getOrCreateServer(member.guild.id);

      // Ensure the user exists
      await this.userRepository.getOrCreateUser(member.id, member.user.username);

      // Ensure the server member exists
      await this.serverMemberRepository.getOrCreateMember(
        member.guild.id,
        member.id,
        member.joinedAt ?? undefined // Pass Date object or undefined
      );

      // Create a thread for verification
      setupStage = 'create verification thread';
      const threadName = `Verification: ${member.user.username}`;
      const thread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Verification thread for suspicious user: ${member.user.tag}`,
        type: ChannelType.PrivateThread,
      });
      threadWasCreated = true;

      // Persist the Discord thread before follow-up operations so partial setup
      // failures do not orphan a thread that was already created.
      setupStage = 'store verification thread id';
      await this.storeThreadId(verificationEvent, thread.id, VERIFICATION_THREAD_TYPE);

      // Add the member to the private thread so they can see it
      setupStage = 'add flagged user to verification thread';
      await this.addFlaggedUserToVerificationThread(member, thread);

      // Lock invites after the flagged user has been added.
      // Some server permission setups allow creating private threads but not managing them;
      // setting `invitable: false` at creation time can prevent adding the user.
      try {
        await thread.setInvitable(false, 'Prevent members from inviting others to verification');
      } catch (error) {
        console.warn(
          `Failed to set invitable=false for verification thread ${thread.id} (continuing):`,
          error
        );
      }

      setupStage = 'route case responders to verification thread';
      const routingResult = await this.addCaseResponderMembers(member.guild, thread, [member.id]);

      await this.storeThreadId(
        verificationEvent,
        thread.id,
        VERIFICATION_THREAD_TYPE,
        this.buildCaseStaffRoutingMetadata(routingResult)
      );

      // Send an initial message to the thread
      setupStage = 'send initial verification prompt';
      await this.sendInitialVerificationPrompt(member, thread);

      return thread;
    } catch (error) {
      console.error('Failed to create verification thread:', error);
      if (threadWasCreated) {
        throw this.buildThreadSetupError(setupStage, error);
      }
      return null;
    }
  }

  public async repairVerificationThread(
    member: GuildMember,
    verificationEvent: VerificationEvent
  ): Promise<VerificationThreadRepairResult> {
    if (!verificationEvent.thread_id) {
      const createdThread = await this.createVerificationThread(member, verificationEvent);
      return {
        threadId: createdThread?.id ?? null,
        threadCreated: Boolean(createdThread),
        userAdded: Boolean(createdThread),
        promptSent: Boolean(createdThread),
        promptAlreadyPresent: false,
      };
    }

    const thread = await this.fetchStoredThread(verificationEvent);
    if (!thread) {
      throw new Error(`Stored verification thread ${verificationEvent.thread_id} was not found.`);
    }

    if (thread.archived) {
      await thread.setArchived(false, 'Repair active verification case');
    }
    if (thread.locked) {
      await thread.setLocked(false, 'Repair active verification case');
    }

    await this.addFlaggedUserToVerificationThread(member, thread);
    const promptAlreadyPresent = await this.hasInitialVerificationPrompt(member, thread);
    if (!promptAlreadyPresent) {
      await this.sendInitialVerificationPrompt(member, thread);
    }

    return {
      threadId: thread.id,
      threadCreated: false,
      userAdded: true,
      promptSent: !promptAlreadyPresent,
      promptAlreadyPresent,
    };
  }

  public async createReportReviewThread(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<ThreadChannel | null> {
    const channel =
      (await this.configService.getVerificationChannel(member.guild.id)) ||
      (await this.configService.getAdminChannel(member.guild.id));

    if (!channel) {
      console.error('No verification or admin channel ID configured');
      return null;
    }

    let setupStage = 'prepare report review thread records';
    let threadWasCreated = false;

    try {
      await this.serverRepository.getOrCreateServer(member.guild.id);
      await this.userRepository.getOrCreateUser(member.id, member.user.username);
      await this.serverMemberRepository.getOrCreateMember(
        member.guild.id,
        member.id,
        member.joinedAt ?? undefined
      );

      setupStage = 'create report review thread';
      const thread = await channel.threads.create({
        name: `Report review: ${member.user.username}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Review-only report thread for user: ${member.user.tag}`,
        type: ChannelType.PrivateThread,
      });
      threadWasCreated = true;

      // Persist the Discord thread before follow-up operations so partial setup
      // failures do not orphan a thread that was already created.
      setupStage = 'store report review thread id';
      await this.storeThreadId(verificationEvent, thread.id, REPORT_REVIEW_THREAD_TYPE);
      await this.storePrivateEvidenceThreadId(verificationEvent, thread.id);

      try {
        await thread.setInvitable(false, 'Keep report review thread moderator-only');
      } catch (error) {
        console.warn(
          `Failed to set invitable=false for report review thread ${thread.id} (continuing):`,
          error
        );
      }

      setupStage = 'route case responders to report review thread';
      const routingResult = await this.addCaseResponderMembers(member.guild, thread, [member.id]);

      await this.storeThreadId(
        verificationEvent,
        thread.id,
        REPORT_REVIEW_THREAD_TYPE,
        this.buildCaseStaffRoutingMetadata(routingResult)
      );

      setupStage = 'send report review thread prompt';
      await thread.send({
        content: this.buildReportReviewThreadMessage(member, detectionResult, sourceMessage),
        allowedMentions: {
          parse: [],
          users: [],
          roles: [],
          repliedUser: false,
        },
      });

      return thread;
    } catch (error) {
      console.error('Failed to create report review thread:', error);
      if (threadWasCreated) {
        throw this.buildThreadSetupError(setupStage, error);
      }
      return null;
    }
  }

  public async createPrivateEvidenceThread(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<ThreadChannel | null> {
    if (verificationEvent.private_evidence_thread_id) {
      const existing = await this.fetchThreadById(verificationEvent.private_evidence_thread_id);
      if (existing) {
        return existing;
      }
    }

    const channel =
      (await this.configService.getVerificationChannel(member.guild.id)) ||
      (await this.configService.getAdminChannel(member.guild.id));

    if (!channel) {
      console.error('No verification or admin channel ID configured');
      return null;
    }

    let setupStage = 'prepare private evidence thread records';
    let threadWasCreated = false;

    try {
      await this.serverRepository.getOrCreateServer(member.guild.id);
      await this.userRepository.getOrCreateUser(member.id, member.user.username);
      await this.serverMemberRepository.getOrCreateMember(
        member.guild.id,
        member.id,
        member.joinedAt ?? undefined
      );

      setupStage = 'create private evidence thread';
      const thread = await channel.threads.create({
        name: `Evidence: ${member.user.username}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Private evidence thread for user: ${member.user.tag}`,
        type: ChannelType.PrivateThread,
      });
      threadWasCreated = true;

      setupStage = 'store private evidence thread id';
      await this.storePrivateEvidenceThreadId(verificationEvent, thread.id);

      try {
        await thread.setInvitable(false, 'Keep private evidence thread moderator-only');
      } catch (error) {
        console.warn(
          `Failed to set invitable=false for private evidence thread ${thread.id} (continuing):`,
          error
        );
      }

      setupStage = 'route case responders to private evidence thread';
      await this.addCaseResponderMembers(member.guild, thread, [member.id]);

      setupStage = 'send private evidence thread prompt';
      await thread.send({
        content: this.buildPrivateEvidenceThreadMessage(
          member,
          verificationEvent,
          detectionResult,
          sourceMessage
        ),
        allowedMentions: {
          parse: [],
          users: [],
          roles: [],
          repliedUser: false,
        },
      });

      return thread;
    } catch (error) {
      console.error('Failed to create private evidence thread:', error);
      if (threadWasCreated) {
        throw this.buildThreadSetupError(setupStage, error);
      }
      return null;
    }
  }

  public async createReportIntakeThread(
    channel: TextChannel,
    reporter: GuildMember
  ): Promise<ThreadChannel | null> {
    try {
      const thread = await channel.threads.create({
        name: `${REPORT_INTAKE_THREAD_NAME_PREFIX} ${reporter.user.username}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `User-facing report intake thread opened by: ${reporter.user.tag}`,
        type: ChannelType.PrivateThread,
      });

      try {
        await thread.setInvitable(false, 'Keep report intake thread private');
      } catch (error) {
        console.warn(
          `Failed to set invitable=false for report intake thread ${thread.id} (continuing):`,
          error
        );
      }

      return thread;
    } catch (error) {
      console.error('Failed to create report intake thread:', error);
      return null;
    }
  }

  public async activateReportIntakeThread(
    thread: ThreadChannel,
    reporter: GuildMember
  ): Promise<boolean> {
    try {
      await thread.members.add(reporter.id);

      await this.addCaseResponderMembers(reporter.guild, thread, [reporter.id]);

      await thread.send({
        content: this.buildReportIntakeThreadMessage(reporter),
        allowedMentions: {
          parse: [],
          users: [reporter.id],
          roles: [],
          repliedUser: false,
        },
      });

      return true;
    } catch (error) {
      console.error(`Failed to activate report intake thread ${thread.id}:`, error);
      return false;
    }
  }

  /**
   * Look up a thread on the discord client close it, and lock it
   * @param threadId The Discord thread ID
   * @param resolution The resolution of the thread (verified, banned, ignored)
   * @returns Whether the thread was successfully resolved
   */
  async resolveVerificationThread(
    verificationEvent: VerificationEvent,
    resolution: VerificationStatus
  ): Promise<boolean> {
    try {
      if (!verificationEvent.thread_id) {
        // No thread but that's okay
        return false;
      }

      const verificationChannel = await this.configService.getVerificationChannel(
        verificationEvent.server_id
      );
      if (!verificationChannel) {
        throw new Error('No verification channel ID configured');
      }

      const thread = await verificationChannel.threads.fetch(verificationEvent.thread_id);

      if (!thread || !thread.isThread()) {
        // No thread but that's okay
        return false;
      }

      if (resolution === VerificationStatus.VERIFIED) {
        await thread.send({
          content: `This thread has been resolved. If you have any questions, please contact a moderator.`,
        });
      } else if (resolution === VerificationStatus.BANNED) {
        await thread.send({
          content: `This thread has been rejected. If you have any questions, please contact a moderator.`,
        });
      }

      await thread.setArchived(true);
      await thread.setLocked(true);

      return true;
    } catch (error) {
      console.error('Failed to resolve verification thread:', error);
      return false;
    }
  }

  /**
   * Reopens a verification thread
   * @param serverId The Discord server ID
   * @param threadId The Discord thread ID
   * @returns Whether the thread was successfully reopened
   */
  async reopenVerificationThread(verificationEvent: VerificationEvent): Promise<boolean> {
    try {
      if (!verificationEvent.thread_id) {
        // No thread but that's okay
        return false;
      }

      const channel = await this.configService.getVerificationChannel(verificationEvent.server_id);

      if (!channel) {
        throw new Error('No verification channel ID configured');
      }

      const thread = await channel.threads.fetch(verificationEvent.thread_id);
      if (!thread || !thread.isThread()) {
        // No thread but that's okay
        return false;
      }

      await thread.setArchived(false);
      await thread.setLocked(false);

      return true;
    } catch (error) {
      console.error('Failed to reopen verification thread:', error);
      return false;
    }
  }
}
