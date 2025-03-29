import { GuildMember, User } from 'discord.js';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';
import { IConfigService } from '../config/ConfigService';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { INotificationManager } from './NotificationManager';
import { IRoleManager } from './RoleManager';

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

  /**
   * Updates a user's verification status
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param status The new verification status
   * @param moderatorId The Discord ID of the moderator who changed the status
   * @returns Promise resolving to true if successful
   */
  updateVerificationStatus(
    serverId: string,
    userId: string,
    status: 'pending' | 'verified' | 'rejected',
    moderatorId: string
  ): Promise<boolean>;
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

  constructor(
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.RoleManager) roleManager: IRoleManager
  ) {
    this.configService = configService;
    this.serverMemberRepository = serverMemberRepository;
    this.notificationManager = notificationManager;
    this.roleManager = roleManager;
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
        // Update the member's verification status
        await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
          is_restricted: true,
          verification_status: 'pending'
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
      // Remove the role using RoleManager
      const success = await this.roleManager.removeRestrictedRole(member);

      if (success) {
        // Update verification status
        await this.updateVerificationStatus(
          member.guild.id,
          member.id,
          'verified',
          moderator.id
        );

        // Get the existing verification message ID
        const existingMember = await this.serverMemberRepository.findByServerAndUser(member.guild.id, member.id);
        const existingMessageId = existingMember?.verification_message_id;

        // If we have an existing message, update it
        if (existingMessageId) {
          const channel = await this.notificationManager.getAdminChannel();
          if (channel) {
            try {
              const message = await channel.messages.fetch(existingMessageId);
              if (message) {
                // Log the verification action to the message
                await this.notificationManager.logActionToMessage(
                  message,
                  'verified the user',
                  moderator
                );
              }
            } catch (error) {
              console.error('Failed to update notification message:', error);
            }
          }

          // Clear the verification message ID
          await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
            verification_message_id: undefined
          });
        }

        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to verify user:', error);
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
      await member.ban({ reason });

      // Update verification status
      await this.updateVerificationStatus(
        member.guild.id,
        member.id,
        'rejected',
        moderator.id
      );

      // Get the existing verification message ID
      const existingMember = await this.serverMemberRepository.findByServerAndUser(member.guild.id, member.id);
      const existingMessageId = existingMember?.verification_message_id;

      // If we have an existing message, update it
      if (existingMessageId) {
        const channel = await this.notificationManager.getAdminChannel();
        if (channel) {
          try {
            const message = await channel.messages.fetch(existingMessageId);
            if (message) {
              // Log the ban action to the message
              await this.notificationManager.logActionToMessage(
                message,
                'banned the user',
                moderator
              );
            }
          } catch (error) {
            console.error('Failed to update notification message:', error);
          }
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to ban user:', error);
      return false;
    }
  }

  /**
   * Updates a user's verification status
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param status The new verification status
   * @param moderatorId The Discord ID of the moderator who changed the status
   * @returns Promise resolving to true if successful
   */
  public async updateVerificationStatus(
    serverId: string,
    userId: string,
    status: 'pending' | 'verified' | 'rejected',
    moderatorId: string
  ): Promise<boolean> {
    try {
      const result = await this.serverMemberRepository.updateVerificationStatus(
        serverId,
        userId,
        status,
        moderatorId
      );
      return !!result;
    } catch (error) {
      console.error('Failed to update verification status:', error);
      return false;
    }
  }
} 