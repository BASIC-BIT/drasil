import { GuildMember, Role } from 'discord.js';
import { injectable, inject } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';

/**
 * Interface for the RoleManager service
 */
export interface IRoleManager {
  /**
   * Initialize the role manager with guild-specific settings
   * @param guildId The Discord guild ID
   */
  initialize(guildId: string): Promise<void>;

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
   * @param member The guild member to verify (unrestrict)
   * @returns Promise resolving to true if successful, false if the role couldn't be removed
   */
  removeRestrictedRole(member: GuildMember): Promise<boolean>;
}

/**
 * Service for managing user roles, particularly for restricting suspicious users
 */
@injectable()
export class RoleManager implements IRoleManager {
  private restrictedRoleId?: string;
  private configService: IConfigService;

  constructor(@inject(TYPES.ConfigService) configService: IConfigService) {
    this.configService = configService;
  }

  public async initialize(guildId: string): Promise<void> {
    const config = await this.configService.getServerConfig(guildId);
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
   * @param member The guild member to verify (unrestrict)
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

  /**
   * Helper method to find a role in a guild by ID
   * @param member The guild member (used to access the guild)
   * @param roleId The role ID to look for
   * @returns The role object if found, undefined otherwise
   */
  private async findRole(member: GuildMember, roleId: string): Promise<Role | undefined> {
    const guild = member.guild;
    const role = guild.roles.cache.get(roleId);

    if (role) return role;

    // If not in cache, fetch from API
    try {
      const fetchedRole = await guild.roles.fetch(roleId);
      return fetchedRole || undefined;
    } catch (error) {
      console.error(`Failed to fetch role with ID ${roleId}:`, error);
      return undefined;
    }
  }
}
