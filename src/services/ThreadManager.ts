import { injectable, inject } from 'inversify';
import {
  Client,
  GuildMember,
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
        invitable: false,
      });

      // Add the member to the private thread so they can see it
      await thread.members.add(member.id);

      // Send an initial message to the thread
      await thread.send({
        content: `# Verification for <@${member.id}>\n\nHello <@${member.id}>, your account has been automatically flagged for verification.\n\nTo help us verify your account, please answer these questions:\n\n1. How did you find our community?\n2. What interests you here?\n\nOnce you respond, a moderator will review your answers and grant you full access to the server if everything checks out.`,
      });

      // Store thread in the database
      verificationEvent.thread_id = thread.id;
      await this.verificationEventRepository.update(verificationEvent.id, verificationEvent);

      return thread;
    } catch (error) {
      console.error('Failed to create verification thread:', error);
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
