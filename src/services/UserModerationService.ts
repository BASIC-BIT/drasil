import { GuildMember, User } from 'discord.js';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { INotificationManager } from './NotificationManager';
import { IRoleManager } from './RoleManager';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { AdminActionType, VerificationStatus } from '../repositories/types';
import { IAdminActionService } from './AdminActionService';

/**
 * Interface for the UserModerationService
 */
export interface IUserModerationService {
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
  private serverMemberRepository: IServerMemberRepository;
  private notificationManager: INotificationManager;
  private roleManager: IRoleManager;
  private verificationEventRepository: IVerificationEventRepository;
  private adminActionService: IAdminActionService;

  constructor(
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.RoleManager) roleManager: IRoleManager,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.AdminActionService) adminActionService: IAdminActionService
  ) {
    this.serverMemberRepository = serverMemberRepository;
    this.notificationManager = notificationManager;
    this.roleManager = roleManager;
    this.verificationEventRepository = verificationEventRepository;
    this.adminActionService = adminActionService;
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
        await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
          is_restricted: true,
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
      const verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
        member.id,
        member.guild.id
      );

      if (!verificationEvent) {
        throw new Error('No active verification event found');
      }

      await this.verificationEventRepository.update(verificationEvent.id, {
        status: VerificationStatus.VERIFIED,
      });

      await this.notificationManager.logActionToMessage(
        verificationEvent,
        AdminActionType.VERIFY,
        moderator
      );

      return true; // Verification process initiated successfully
    } catch (error) {
      console.error(`Failed to verify user ${member?.user?.tag} via command:`, error);
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
      const verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
        member.id,
        member.guild.id
      );

      if (!verificationEvent) {
        throw new Error('No active verification event found');
      }

      await this.verificationEventRepository.update(verificationEvent.id, {
        status: VerificationStatus.BANNED,
      });

      await member.ban({ reason });

      await this.notificationManager.logActionToMessage(
        verificationEvent,
        AdminActionType.BAN,
        moderator
      );

      return true; // Ban succeeded, even if logging/status updates had issues
    } catch (error) {
      console.error(`Failed to ban user ${member?.user?.tag} via command:`, error);
      return false;
    }
  }
}
