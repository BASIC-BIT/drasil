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
export const CASE_STAFF_ROUTING_METADATA_KEY = 'case_staff_routing';

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

  createReportReviewThread(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<ThreadChannel | null>;

  createReportIntakeThread(
    channel: TextChannel,
    reporter: GuildMember
  ): Promise<ThreadChannel | null>;

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
      const threadName = `Verification: ${member.user.username}`;
      const thread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Verification thread for suspicious user: ${member.user.tag}`,
        type: ChannelType.PrivateThread,
      });

      // Add the member to the private thread so they can see it
      await thread.members.add(member.id);

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

      const routingResult = await this.addCaseResponderMembers(member.guild, thread, [member.id]);

      const rawInitialPrompt = await this.getInitialVerificationPrompt(member);
      const initialPrompt = enforceDiscordMessageLimit(rawInitialPrompt);
      if (initialPrompt.length < rawInitialPrompt.length) {
        console.warn(
          `Verification prompt exceeded Discord content limit for guild ${member.guild.id}; truncated before sending.`
        );
      }

      // Send an initial message to the thread
      await thread.send({
        content: initialPrompt,
        allowedMentions: {
          parse: [],
          users: [member.id],
          roles: [],
          repliedUser: false,
        },
      });

      // Store thread in the database
      await this.storeThreadId(
        verificationEvent,
        thread.id,
        VERIFICATION_THREAD_TYPE,
        this.buildCaseStaffRoutingMetadata(routingResult)
      );

      return thread;
    } catch (error) {
      console.error('Failed to create verification thread:', error);
      return null;
    }
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

    try {
      await this.serverRepository.getOrCreateServer(member.guild.id);
      await this.userRepository.getOrCreateUser(member.id, member.user.username);
      await this.serverMemberRepository.getOrCreateMember(
        member.guild.id,
        member.id,
        member.joinedAt ?? undefined
      );

      const thread = await channel.threads.create({
        name: `Report review: ${member.user.username}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Review-only report thread for user: ${member.user.tag}`,
        type: ChannelType.PrivateThread,
      });

      try {
        await thread.setInvitable(false, 'Keep report review thread moderator-only');
      } catch (error) {
        console.warn(
          `Failed to set invitable=false for report review thread ${thread.id} (continuing):`,
          error
        );
      }

      const routingResult = await this.addCaseResponderMembers(member.guild, thread, [member.id]);

      await thread.send({
        content: this.buildReportReviewThreadMessage(member, detectionResult, sourceMessage),
        allowedMentions: {
          parse: [],
          users: [],
          roles: [],
          repliedUser: false,
        },
      });

      await this.storeThreadId(
        verificationEvent,
        thread.id,
        REPORT_REVIEW_THREAD_TYPE,
        this.buildCaseStaffRoutingMetadata(routingResult)
      );

      return thread;
    } catch (error) {
      console.error('Failed to create report review thread:', error);
      return null;
    }
  }

  public async createReportIntakeThread(
    channel: TextChannel,
    reporter: GuildMember
  ): Promise<ThreadChannel | null> {
    try {
      const thread = await channel.threads.create({
        name: `Report intake: ${reporter.user.username}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `User-facing report intake thread opened by: ${reporter.user.tag}`,
        type: ChannelType.PrivateThread,
      });

      await thread.members.add(reporter.id);

      try {
        await thread.setInvitable(false, 'Keep report intake thread private');
      } catch (error) {
        console.warn(
          `Failed to set invitable=false for report intake thread ${thread.id} (continuing):`,
          error
        );
      }

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

      return thread;
    } catch (error) {
      console.error('Failed to create report intake thread:', error);
      return null;
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
