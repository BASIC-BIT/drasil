import { injectable, inject } from 'inversify';
import { GuildMember } from 'discord.js';
import { TYPES } from '../di/symbols';
import { IConfigService } from '../config/ConfigService';

/**
 * Interface for the RoleManager
 */
export interface IRoleManager {
  /**
   * Assigns the case role to a guild member
   * @param member The guild member receiving the case role
   * @returns Promise resolving to true if successful, false if the role couldn't be assigned
   */
  assignCaseRole(member: GuildMember): Promise<boolean>;

  /**
   * Removes the case role from a guild member
   * @param member The guild member losing the case role
   * @returns Promise resolving to true if successful, false if the role couldn't be removed
   */
  removeCaseRole(member: GuildMember): Promise<boolean>;
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
   * Assigns the case role to a guild member
   * @param member The guild member receiving the case role
   * @returns Promise resolving to true if successful, false if the role couldn't be assigned
   */
  public async assignCaseRole(member: GuildMember): Promise<boolean> {
    const caseRole = await this.configService.getCaseRole(member.guild.id);
    if (!caseRole) {
      console.error('No case role ID configured');
      return false;
    }

    await member.roles.add(caseRole);

    return true;
  }

  /**
   * Removes the case role from a guild member
   * @param member The guild member losing the case role
   * @returns Promise resolving to true if successful, false if the role couldn't be removed
   */
  public async removeCaseRole(member: GuildMember): Promise<boolean> {
    const caseRole = await this.configService.getCaseRole(member.guild.id);
    if (!caseRole) {
      console.error('No case role ID configured');
      return false;
    }

    await member.roles.remove(caseRole);

    return true;
  }
}
