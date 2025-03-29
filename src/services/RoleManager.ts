import { injectable, inject } from 'inversify';
import { GuildMember, Role } from 'discord.js';
import { TYPES } from '../di/symbols';
import { IConfigService } from '../config/ConfigService';

/**
 * Interface for the RoleManager
 */
export interface IRoleManager {
  /**
   * Initialize the service with server-specific configurations
   * @param serverId The Discord server ID
   */
  initialize(serverId: string): Promise<void>;

  /**
   * Sets the ID of the restricted role
   * @param roleId The Discord role ID for restricting users
   */
  setRestrictedRoleId(roleId: string): void;

  /**
   * Gets the current restricted role ID
   * @returns The current restricted role ID or undefined if not set
   */
  getRestrictedRoleId(): string | undefined;

  /**
   * Assigns the restricted role to a guild member
   * @param member The guild member to restrict
   * @returns Promise resolving to true if successful, false if the role couldn't be assigned
   */
  assignRestrictedRole(member: GuildMember): Promise<boolean>;

  /**
   * Removes the restricted role from a guild member
   * @param member The guild member to unrestrict
   * @returns Promise resolving to true if successful, false if the role couldn't be removed
   */
  removeRestrictedRole(member: GuildMember): Promise<boolean>;
}

/**
 * Service for managing Discord roles
 */
@injectable()
export class RoleManager implements IRoleManager {
  private restrictedRoleId?: string;
  private configService: IConfigService;

  constructor(@inject(TYPES.ConfigService) configService: IConfigService) {
    this.configService = configService;
  }

  /**
   * Initialize the service with server-specific configurations
   * @param serverId The Discord server ID
   */
  public async initialize(serverId: string): Promise<void> {
    const config = await this.configService.getServerConfig(serverId);
    if (config.restricted_role_id) {
      this.restrictedRoleId = config.restricted_role_id;
    }
  }

  /**
   * Sets the ID of the restricted role
   * @param roleId The Discord role ID for restricting users
   */
  public setRestrictedRoleId(roleId: string): void {
    this.restrictedRoleId = roleId;
  }

  /**
   * Gets the current restricted role ID
   * @returns The current restricted role ID or undefined if not set
   */
  public getRestrictedRoleId(): string | undefined {
    return this.restrictedRoleId;
  }

  /**
   * Helper function to find a role in a guild
   * @param member The guild member (used to access the guild)
   * @param roleId The role ID to find
   * @returns The found role or null
   */
  private async findRole(member: GuildMember, roleId: string): Promise<Role | null> {
    try {
      return await member.guild.roles.fetch(roleId);
    } catch (error) {
      console.error('Failed to fetch role:', error);
      return null;
    }
  }

  /**
   * Assigns the restricted role to a guild member
   * @param member The guild member to restrict
   * @returns Promise resolving to true if successful, false if the role couldn't be assigned
   */
  public async assignRestrictedRole(member: GuildMember): Promise<boolean> {
    if (!this.restrictedRoleId) {
      console.error('No restricted role ID configured');
      return false;
    }

    try {
      // Check if the role exists in the guild
      const restrictedRole = await this.findRole(member, this.restrictedRoleId);

      if (!restrictedRole) {
        console.error(`Restricted role with ID ${this.restrictedRoleId} not found in guild`);
        return false;
      }

      // Assign the role
      await member.roles.add(restrictedRole);
      return true;
    } catch (error) {
      console.error('Failed to assign restricted role:', error);
      return false;
    }
  }

  /**
   * Removes the restricted role from a guild member
   * @param member The guild member to unrestrict
   * @returns Promise resolving to true if successful, false if the role couldn't be removed
   */
  public async removeRestrictedRole(member: GuildMember): Promise<boolean> {
    if (!this.restrictedRoleId) {
      console.error('No restricted role ID configured');
      return false;
    }

    try {
      // Check if the role exists in the guild
      const restrictedRole = await this.findRole(member, this.restrictedRoleId);

      if (!restrictedRole) {
        console.error(`Restricted role with ID ${this.restrictedRoleId} not found in guild`);
        return false;
      }

      // Remove the role
      await member.roles.remove(restrictedRole);
      return true;
    } catch (error) {
      console.error('Failed to remove restricted role:', error);
      return false;
    }
  }
}
