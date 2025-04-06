import { GuildMember, User, Client } from 'discord.js'; // Added Client
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { INotificationManager } from './NotificationManager';
import { IRoleManager } from './RoleManager';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { VerificationStatus } from '../repositories/types'; // Removed AdminActionType
import { IAdminActionService } from './AdminActionService';
import { IEventBus } from '../events/EventBus'; // Added EventBus import
import {
  EventNames,
  AdminVerifyUserRequestedPayload, // Added
  AdminBanUserRequestedPayload, // Added
} from '../events/events'; // Added EventNames import

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
  private notificationManager: INotificationManager; // Keep for now, might be replaced by events later
  private roleManager: IRoleManager; // Keep for now, might be replaced by events later
  private verificationEventRepository: IVerificationEventRepository;
  private adminActionService: IAdminActionService; // Keep for now, might be replaced by events later
  private eventBus: IEventBus; // Added EventBus
  private client: Client; // Added Client

  constructor(
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.RoleManager) roleManager: IRoleManager,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.AdminActionService) adminActionService: IAdminActionService,
    @inject(TYPES.EventBus) eventBus: IEventBus, // Inject EventBus
    @inject(TYPES.DiscordClient) client: Client // Inject Client
  ) {
    this.serverMemberRepository = serverMemberRepository;
    this.notificationManager = notificationManager;
    this.roleManager = roleManager;
    this.verificationEventRepository = verificationEventRepository;
    this.adminActionService = adminActionService;
    this.eventBus = eventBus; // Assign EventBus
    this.client = client; // Assign Client
    this.subscribe(); // Call subscribe method
  }

  /**
   * Subscribes to relevant events on the EventBus
   */
  private subscribe(): void {
    this.eventBus.subscribe(
      EventNames.AdminVerifyUserRequested,
      this.handleAdminVerifyRequest.bind(this)
    );
    this.eventBus.subscribe(
      EventNames.AdminBanUserRequested,
      this.handleAdminBanRequest.bind(this)
    );
  }

  /**
   * Restricts a user by assigning the restricted role and updating their verification status
   * @param member The guild member to restrict
   * @returns Promise resolving to true if successful, false if the restriction failed
   */
  public async restrictUser(member: GuildMember): Promise<boolean> {
    try {
      const verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
        member.id,
        member.guild.id
      );

      if (!verificationEvent) {
        // If no active event, we might still need to restrict based on other logic,
        // but for now, let's assume restriction happens only with an active event.
        // Alternatively, create a new PENDING event here? Needs clarification.
        console.warn(
          `RestrictUser called for ${member.user.tag} but no active verification event found.`
        );
        // Let's try assigning the role anyway, assuming the intent is restriction.
        // return false;
      } else {
        // Update existing event status if needed (e.g., if it was reopened)
        if (verificationEvent.status !== VerificationStatus.PENDING) {
          verificationEvent.status = VerificationStatus.PENDING;
          await this.verificationEventRepository.update(verificationEvent.id, verificationEvent);
        }
      }

      // Assign the role using RoleManager
      const roleAssigned = await this.roleManager.assignRestrictedRole(member);
      if (!roleAssigned) {
        console.error(`Failed to assign restricted role to ${member.user.tag}`);
        return false; // Fail if role assignment fails
      }

      // Update server member record
      await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
        is_restricted: true,
        verification_status: VerificationStatus.PENDING, // Ensure status matches
        last_status_change: new Date(),
      });

      console.log(`Successfully restricted user ${member.user.tag}`);
      return true;
    } catch (error) {
      console.error(`Failed to restrict user ${member.user.tag}:`, error);
      return false;
    }
  }

  /**
   * (Now primarily internal - triggered by AdminVerifyUserRequested event)
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
        throw new Error('No active verification event found to verify');
      }

      // Set status and resolution details
      verificationEvent.status = VerificationStatus.VERIFIED;
      verificationEvent.resolved_by = moderator.id;
      verificationEvent.resolved_at = new Date();
      const updatedEvent = await this.verificationEventRepository.update(
        verificationEvent.id,
        verificationEvent
      );

      if (!updatedEvent) {
        throw new Error(
          `Failed to update verification event ${verificationEvent.id} status to VERIFIED.`
        );
      }

      // Publish UserVerified event instead of direct calls
      this.eventBus.publish(EventNames.UserVerified, {
        userId: member.id,
        serverId: member.guild.id,
        moderatorId: moderator.id,
        verificationEventId: verificationEvent.id,
      });

      // Side effects (role removal, status update, logging) are now handled by subscribers listening to UserVerified event.

      console.log(
        `User ${member.user.tag} verification process completed, UserVerified event published.`
      );
      return true; // Verification process completed successfully
    } catch (error) {
      console.error(`Failed to verify user ${member.user.tag}:`, error);
      return false;
    }
  }

  /**
   * (Now primarily internal - triggered by AdminBanUserRequested event)
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

      // Allow banning even if no active verification event exists
      // if (!verificationEvent) {
      //   throw new Error('No active verification event found to ban');
      // }

      // Update verification event status if it exists
      if (verificationEvent) {
        verificationEvent.status = VerificationStatus.BANNED;
        verificationEvent.resolved_by = moderator.id;
        verificationEvent.resolved_at = new Date();
        const updatedEvent = await this.verificationEventRepository.update(
          verificationEvent.id,
          verificationEvent
        );
        if (!updatedEvent) {
          console.warn(
            `Failed to update verification event ${verificationEvent.id} status to BANNED, but proceeding with ban.`
          );
        }
      }

      // Perform the ban
      await member.ban({ reason });
      console.log(`Banned user ${member.user.tag}. Reason: ${reason}`);

      // Update server member status
      await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
        verification_status: VerificationStatus.BANNED,
        is_restricted: true, // Keep restricted flag? Or remove member record? Needs clarification. Let's keep restricted for now.
        last_status_change: new Date(),
      });

      // Publish UserBanned event
      this.eventBus.publish(EventNames.UserBanned, {
        userId: member.id,
        serverId: member.guild.id,
        moderatorId: moderator.id,
        reason: reason,
        verificationEventId: verificationEvent?.id || 'N/A', // Pass ID if event existed
      });

      // Side effects (status update, logging) are now handled by subscribers listening to UserBanned event.

      return true; // Ban succeeded
    } catch (error) {
      console.error(`Failed to ban user ${member.user.tag}:`, error);
      return false;
    }
  }

  // --- Event Handlers ---

  /**
   * Handles the request to verify a user.
   */
  private async handleAdminVerifyRequest(payload: AdminVerifyUserRequestedPayload): Promise<void> {
    console.log(
      `UserModerationService: Handling ${EventNames.AdminVerifyUserRequested} for user ${payload.targetUserId}`
    );
    try {
      const guild = await this.client.guilds.fetch(payload.serverId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.
      const member = await guild.members.fetch(payload.targetUserId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.
      const moderator = await this.client.users.fetch(payload.adminId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.

      // Call the internal verification logic
      await this.verifyUser(member, moderator);

      // TODO: Optionally reply to interaction if payload.interactionId exists?
      // This might be better handled by a dedicated InteractionReplySubscriber
    } catch (error) {
      console.error(
        `UserModerationService: Error handling ${EventNames.AdminVerifyUserRequested} for user ${payload.targetUserId}:`,
        error
      );
      // TODO: Optionally reply to interaction with error?
    }
  }

  /**
   * Handles the request to ban a user.
   */
  private async handleAdminBanRequest(payload: AdminBanUserRequestedPayload): Promise<void> {
    console.log(
      `UserModerationService: Handling ${EventNames.AdminBanUserRequested} for user ${payload.targetUserId}`
    );
    try {
      const guild = await this.client.guilds.fetch(payload.serverId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.
      const member = await guild.members.fetch(payload.targetUserId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.
      const moderator = await this.client.users.fetch(payload.adminId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.

      // Call the internal ban logic
      await this.banUser(member, payload.reason, moderator);

      // TODO: Optionally reply to interaction if payload.interactionId exists?
    } catch (error) {
      console.error(
        `UserModerationService: Error handling ${EventNames.AdminBanUserRequested} for user ${payload.targetUserId}:`,
        error
      );
      // TODO: Optionally reply to interaction with error?
    }
  }
}
