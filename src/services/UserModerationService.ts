import { GuildMember, User, TextChannel } from 'discord.js';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';
import { IConfigService } from '../config/ConfigService';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { INotificationManager } from './NotificationManager';
import { IRoleManager } from './RoleManager';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { IVerificationService } from './VerificationService';
import { VerificationEvent } from '../repositories/types';

/**
 * Interface for the UserModerationService
 */
export interface IUserModerationService {
  /**
   * Initialize the service with server-specific configurations
   * @param serverId The Discord server ID
   */
  initialize(serverId: string): Promise<void>;

  /**
   * Restricts a user by assigning the restricted role and updating their verification status
   * @param member The guild member to restrict
   * @returns Promise resolving to true if successful, false if the restriction failed
   */
  restrictUser(member: GuildMember): Promise<boolean>;

  /**
   * Removes the restricted role from a guild member and updates their verification status
   * @param member The guild member to verify (unrestrict)
   * @param moderator The user who performed the verification
   * @returns Promise resolving to true if successful, false if the role couldn't be removed
   */
  verifyUser(member: GuildMember, moderator: User): Promise<boolean>;

  /**
   * Bans a user from the guild
   * @param member The guild member to ban
   * @param reason The reason for the ban
   * @param moderator The user who performed the ban
   * @returns Promise resolving to true if successful, false if the user couldn't be banned
   */
  banUser(member: GuildMember, reason: string, moderator: User): Promise<boolean>;
}

/**
 * Service for managing user moderation actions like restricting, verifying, and banning users
 */
@injectable()
export class UserModerationService implements IUserModerationService {
  private configService: IConfigService;
  private serverMemberRepository: IServerMemberRepository;
  private notificationManager: INotificationManager;
  private roleManager: IRoleManager;
  private verificationEventRepository: IVerificationEventRepository;
  private verificationService: IVerificationService;

  constructor(
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.RoleManager) roleManager: IRoleManager,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.VerificationService) verificationService: IVerificationService
  ) {
    this.configService = configService;
    this.serverMemberRepository = serverMemberRepository;
    this.notificationManager = notificationManager;
    this.roleManager = roleManager;
    this.verificationEventRepository = verificationEventRepository;
    this.verificationService = verificationService;
  }

  /**
   * Initialize the service with server-specific configurations
   * @param serverId The Discord server ID
   */
  public async initialize(serverId: string): Promise<void> {
    const config = await this.configService.getServerConfig(serverId);
    if (config.restricted_role_id) {
      this.roleManager.setRestrictedRoleId(config.restricted_role_id);
    }
  }

  /**
   * Restricts a user by assigning the restricted role and updating their verification status
   * @param member The guild member to restrict
   * @returns Promise resolving to true if successful, false if the restriction failed
   */
  public async restrictUser(member: GuildMember): Promise<boolean> {
    try {
      // Assign the role using RoleManager
      const success = await this.roleManager.assignRestrictedRole(member);

      if (success) {
        // Update the member\'s restriction status in the DB
        // NOTE: Verification status is now handled by VerificationEvent creation
        await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
          is_restricted: true,
          // verification_status: VerificationStatus.PENDING, // Removed this line
        });
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to restrict user:', error);
      return false;
    }
  }

  /**
   * Removes the restricted role from a guild member and updates their verification status
   * @param member The guild member to verify (unrestrict)
   * @param moderator The user who performed the verification
   * @returns Promise resolving to true if successful, false if the role couldn't be removed
   */
  public async verifyUser(member: GuildMember, moderator: User): Promise<boolean> {
    try {
      // 1. Use VerificationService to handle status update, role removal, and action logging
      await this.verificationService.verifyUser(
        member,
        moderator.id,
        'Verified via UserModerationService command'
      );

      // 2. Find the most RECENT verification event (could be the one just verified or an older PENDING one if verify failed)
      // We search by user/server and take the latest, regardless of status initially.
      const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
        member.id,
        member.guild.id,
        { limit: 1 } // Get the most recent one
      );
      const latestVerificationEvent = verificationEvents.length > 0 ? verificationEvents[0] : null;

      // 3. Log action to the notification message if found
      if (latestVerificationEvent && latestVerificationEvent.notification_message_id) {
        const channel = await this.notificationManager.getAdminChannel();
        if (channel instanceof TextChannel) {
          try {
            const message = await channel.messages.fetch(
              latestVerificationEvent.notification_message_id
            );
            if (message) {
              let thread = undefined;
              if (latestVerificationEvent.thread_id) {
                const fetchedThread = await channel.threads
                  .fetch(latestVerificationEvent.thread_id)
                  .catch(() => undefined);
                if (fetchedThread && fetchedThread.isThread()) {
                  thread = fetchedThread;
                }
              }
              // Log to the specific message associated with this event
              await this.notificationManager.logActionToMessage(
                message,
                'verified the user (via command)',
                moderator,
                thread
              );
            } else {
              console.warn(
                `Could not find notification message ${latestVerificationEvent.notification_message_id} to log verification for ${member.user.tag}`
              );
            }
          } catch (error) {
            console.error(
              'Failed to fetch or update notification message for verification:',
              error
            );
          }
        } else {
          console.warn('Admin channel not found or not a text channel for logging verification.');
        }
      } else {
        console.warn(
          `Could not find verification event with notification message ID for user ${member.user.tag} during verification logging.`
        );
      }

      return true; // Verification process initiated successfully
    } catch (error) {
      console.error(`Failed to verify user ${member?.user?.tag} via command:`, error);
      // Check if the error is because there was no active verification
      if (error instanceof Error && error.message.includes('No active verification event found')) {
        console.log(
          `Attempted to verify ${member?.user?.tag} via command, but no active verification event was found.`
        );
        // Decide if this should return true or false. Let's return false as the state wasn't PENDING.
        return false;
      }
      return false;
    }
  }

  /**
   * Bans a user from the guild
   * @param member The guild member to ban
   * @param reason The reason for the ban
   * @param moderator The user who performed the ban
   * @returns Promise resolving to true if successful, false if the user couldn't be banned
   */
  public async banUser(member: GuildMember, reason: string, moderator: User): Promise<boolean> {
    try {
      // 1. Use VerificationService to handle status update (REJECTED), keep role, log action
      // We attempt this first, even if there's no active event, to log the intent if possible.
      let latestVerificationEvent: VerificationEvent | null = null;
      try {
        await this.verificationService.rejectUser(
          member,
          moderator.id,
          `Banned via UserModerationService command (Reason: ${reason})`
        );
        // If rejection was successful, find the event that was just updated (it should be the most recent)
        const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
          member.id,
          member.guild.id,
          { limit: 1 }
        );
        latestVerificationEvent = verificationEvents.length > 0 ? verificationEvents[0] : null;
      } catch (error) {
        console.warn(
          `Failed to update verification status to REJECTED for ${member.user.tag} during ban command:`,
          error
        );
        // Continue with ban even if status update fails, but try to find the latest event anyway for logging
        const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
          member.id,
          member.guild.id,
          { limit: 1 }
        );
        latestVerificationEvent = verificationEvents.length > 0 ? verificationEvents[0] : null;
      }

      // 2. Ban the member via Discord API (do this regardless of verification status update success)
      await member.ban({ reason });
      console.log(`Banned user ${member.user.tag} (Reason: ${reason})`);

      // 3. Log action to the notification message if found
      if (latestVerificationEvent && latestVerificationEvent.notification_message_id) {
        const channel = await this.notificationManager.getAdminChannel();
        if (channel instanceof TextChannel) {
          try {
            const message = await channel.messages.fetch(
              latestVerificationEvent.notification_message_id
            );
            if (message) {
              let thread = undefined;
              if (latestVerificationEvent.thread_id) {
                const fetchedThread = await channel.threads
                  .fetch(latestVerificationEvent.thread_id)
                  .catch(() => undefined);
                if (fetchedThread && fetchedThread.isThread()) {
                  thread = fetchedThread;
                }
              }
              await this.notificationManager.logActionToMessage(
                message,
                `banned the user (Reason: ${reason}) (via command)`,
                moderator,
                thread
              );
            } else {
              console.warn(
                `Could not find notification message ${latestVerificationEvent.notification_message_id} to log ban for ${member.user.tag}`
              );
            }
          } catch (error) {
            console.error('Failed to fetch or update notification message for ban:', error);
          }
        } else {
          console.warn('Admin channel not found or not a text channel for logging ban.');
        }
      } else {
        console.warn(
          `Could not find verification event with notification message ID for user ${member.user.tag} during ban logging.`
        );
      }

      return true; // Ban succeeded, even if logging/status updates had issues
    } catch (error) {
      console.error(`Failed to ban user ${member?.user?.tag} via command:`, error);
      return false;
    }
  }
}
