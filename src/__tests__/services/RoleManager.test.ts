import { GuildMember, Role } from 'discord.js';
import { RoleManager } from '../../services/RoleManager';

jest.mock('discord.js');

describe('RoleManager', () => {
  let roleManager: RoleManager;
  let mockMember: jest.Mocked<GuildMember>;
  let mockRole: Role;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create minimal mock role
    mockRole = { id: 'mock-role-id' } as Role;

    // Create minimal mock member with proper types for jest mocked functions
    mockMember = {
      roles: {
        add: jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<
          GuildMember['roles']['add']
        >,
        remove: jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<
          GuildMember['roles']['remove']
        >,
        cache: new Map(),
      },
      guild: {
        roles: {
          cache: new Map([[mockRole.id, mockRole]]),
          fetch: jest.fn().mockResolvedValue(mockRole) as jest.MockedFunction<() => Promise<Role>>,
        },
      },
    } as unknown as jest.Mocked<GuildMember>;

    roleManager = new RoleManager('mock-role-id');
  });

  describe('assignRestrictedRole', () => {
    it('should assign the restricted role successfully', async () => {
      const result = await roleManager.assignRestrictedRole(mockMember);

      expect(result).toBe(true);
      expect(mockMember.roles.add).toHaveBeenCalledWith(mockRole);
    });

    it('should return false if the role ID is not configured', async () => {
      roleManager = new RoleManager();

      const result = await roleManager.assignRestrictedRole(mockMember);

      expect(result).toBe(false);
      expect(mockMember.roles.add).not.toHaveBeenCalled();
    });

    it('should return false if the role addition fails', async () => {
      (mockMember.roles.add as jest.Mock).mockRejectedValueOnce(new Error('Failed to add role'));

      const result = await roleManager.assignRestrictedRole(mockMember);

      expect(result).toBe(false);
      expect(mockMember.roles.add).toHaveBeenCalledWith(mockRole);
    });
  });

  describe('removeRestrictedRole', () => {
    it('should remove the restricted role successfully', async () => {
      const result = await roleManager.removeRestrictedRole(mockMember);

      expect(result).toBe(true);
      expect(mockMember.roles.remove).toHaveBeenCalledWith(mockRole);
    });

    it('should return false if the role ID is not configured', async () => {
      roleManager = new RoleManager();

      const result = await roleManager.removeRestrictedRole(mockMember);

      expect(result).toBe(false);
      expect(mockMember.roles.remove).not.toHaveBeenCalled();
    });

    it('should return false if the role removal fails', async () => {
      (mockMember.roles.remove as jest.Mock).mockRejectedValueOnce(
        new Error('Failed to remove role')
      );

      const result = await roleManager.removeRestrictedRole(mockMember);

      expect(result).toBe(false);
      expect(mockMember.roles.remove).toHaveBeenCalledWith(mockRole);
    });
  });

  describe('setRestrictedRoleId', () => {
    it('should update the restricted role ID', async () => {
      const newRoleId = 'new-role-id';
      const newMockRole = { id: newRoleId } as Role;

      mockMember.guild.roles.cache.set(newRoleId, newMockRole);
      (mockMember.guild.roles.fetch as jest.Mock).mockResolvedValueOnce(newMockRole);

      roleManager.setRestrictedRoleId(newRoleId);

      const result = await roleManager.assignRestrictedRole(mockMember);
      expect(result).toBe(true);
      expect(mockMember.roles.add).toHaveBeenCalledWith(newMockRole);
    });
  });
});
