import { GuildMember, Role } from 'discord.js';
import { RoleManager, IRoleManager } from '../../services/RoleManager';
import { IConfigService } from '../../config/ConfigService';
import { Server } from '../../repositories/types';
import { Container } from 'inversify';
import { TYPES } from '../../di/symbols';
import 'reflect-metadata';

jest.mock('discord.js');
jest.mock('../../config/ConfigService');

describe('RoleManager', () => {
  let roleManager: IRoleManager;
  let mockMember: jest.Mocked<GuildMember>;
  let mockConfigService: jest.Mocked<IConfigService>;
  let mockRole: Role;
  let container: Container;

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

    // Create mock ConfigService
    mockConfigService = {
      getServerConfig: jest.fn().mockResolvedValue({
        id: 'mock-server-id',
        guild_id: 'mock-guild-id',
        restricted_role_id: 'mock-role-id',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        settings: {},
      } as Server),
    } as unknown as jest.Mocked<IConfigService>;

    // Create container and bind dependencies
    container = new Container();
    container.bind<IConfigService>(TYPES.ConfigService).toConstantValue(mockConfigService);

    // Bind RoleManager with the correct constructor parameter order
    // RoleManager constructor expects ConfigService first, then restrictedRoleId (optional)
    container.bind<IRoleManager>(TYPES.RoleManager).toDynamicValue(() => {
      return new RoleManager(mockConfigService);
    });

    // Get roleManager from container
    roleManager = container.get<IRoleManager>(TYPES.RoleManager);
  });

  describe('assignRestrictedRole', () => {
    it('should assign the restricted role successfully', async () => {
      // First set the role ID
      roleManager.setRestrictedRoleId('mock-role-id');

      const result = await roleManager.assignRestrictedRole(mockMember);

      expect(result).toBe(true);
      expect(mockMember.roles.add).toHaveBeenCalledWith(mockRole);
    });

    it('should return false if the role ID is not configured', async () => {
      // Don't set the role ID
      const result = await roleManager.assignRestrictedRole(mockMember);

      expect(result).toBe(false);
      expect(mockMember.roles.add).not.toHaveBeenCalled();
    });

    it('should return false if the role addition fails', async () => {
      roleManager.setRestrictedRoleId('mock-role-id');
      (mockMember.roles.add as jest.Mock).mockRejectedValueOnce(new Error('Failed to add role'));

      const result = await roleManager.assignRestrictedRole(mockMember);

      expect(result).toBe(false);
      expect(mockMember.roles.add).toHaveBeenCalledWith(mockRole);
    });
  });

  describe('removeRestrictedRole', () => {
    it('should remove the restricted role successfully', async () => {
      roleManager.setRestrictedRoleId('mock-role-id');

      const result = await roleManager.removeRestrictedRole(mockMember);

      expect(result).toBe(true);
      expect(mockMember.roles.remove).toHaveBeenCalledWith(mockRole);
    });

    it('should return false if the role ID is not configured', async () => {
      // Don't set the role ID
      const result = await roleManager.removeRestrictedRole(mockMember);

      expect(result).toBe(false);
      expect(mockMember.roles.remove).not.toHaveBeenCalled();
    });

    it('should return false if the role removal fails', async () => {
      roleManager.setRestrictedRoleId('mock-role-id');
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

    it('should get the role ID from the database during initialization', async () => {
      // Mock the getServerConfig to return a server with a role ID
      mockConfigService.getServerConfig.mockResolvedValueOnce({
        id: 'db-server-id',
        guild_id: 'test-guild-id',
        restricted_role_id: 'db-role-id',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        settings: {},
      } as Server);

      // Initialize the role manager with a guild ID
      await roleManager.initialize('test-guild-id');

      // Verify the ConfigService was called with the correct guild ID
      expect(mockConfigService.getServerConfig).toHaveBeenCalledWith('test-guild-id');

      // Verify the role ID was set from the database
      expect(roleManager.getRestrictedRoleId()).toBe('db-role-id');
    });
  });
});
