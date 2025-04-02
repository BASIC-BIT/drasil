import { injectable, inject } from 'inversify';
import { GuildMember } from 'discord.js';
import { TYPES } from '../di/symbols';
import { IConfigService } from '../config/ConfigService';

/**
 * Interface for the RoleManager
 */
export interface IRoleManager {
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
 * This service ONLY manages roles for users and nothing else
 */
@injectable()
export class RoleManager implements IRoleManager {
  private configService: IConfigService;

  constructor(@inject(TYPES.ConfigService) configService: IConfigService) {
    this.configService = configService;
  }

  /**
   * Assigns the restricted role to a guild member
   * @param member The guild member to restrict
   * @returns Promise resolving to true if successful, false if the role couldn't be assigned
   */
  public async assignRestrictedRole(member: GuildMember): Promise<boolean> {
    const restrictedRole = await this.configService.getRestrictedRole(member.guild.id);
    if (!restrictedRole) {
      console.error('No restricted role ID configured');
      return false;
    }

    await member.roles.add(restrictedRole);

    return true;
  }

  /**
   * Removes the restricted role from a guild member
   * @param member The guild member to unrestrict
   * @returns Promise resolving to true if successful, false if the role couldn't be removed
   */
  public async removeRestrictedRole(member: GuildMember): Promise<boolean> {
    const restrictedRole = await this.configService.getRestrictedRole(member.guild.id);
    if (!restrictedRole) {
      console.error('No restricted role ID configured');
      return false;
    }

    await member.roles.remove(restrictedRole);

    return true;
  }
}
