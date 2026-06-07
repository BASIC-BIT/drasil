export const DISCORD_PERMISSIONS = {
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  ViewAuditLog: 1n << 7n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  EmbedLinks: 1n << 14n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n,
  ManageRoles: 1n << 28n,
  ManageThreads: 1n << 34n,
  CreatePrivateThreads: 1n << 35n,
  SendMessagesInThreads: 1n << 38n,
} as const;

const ALL_PERMISSIONS = (1n << 60n) - 1n;
const DECIMAL_PERMISSIONS_PATTERN = /^\d+$/;

export function parsePermissions(value: string | number | bigint | null | undefined): bigint {
  if (value === null || value === undefined) {
    return 0n;
  }
  if (typeof value === 'bigint') {
    return value >= 0n ? value : 0n;
  }
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : 0n;
  }
  const normalized = value.trim();
  if (!DECIMAL_PERMISSIONS_PATTERN.test(normalized)) {
    return 0n;
  }
  return BigInt(normalized);
}

export function hasPermission(permissions: bigint, permission: bigint): boolean {
  if ((permissions & DISCORD_PERMISSIONS.Administrator) === DISCORD_PERMISSIONS.Administrator) {
    return true;
  }
  return (permissions & permission) === permission;
}

export function canManageGuild(permissions: string | null | undefined, owner: boolean): boolean {
  const parsed = parsePermissions(permissions);
  return (
    owner ||
    hasPermission(parsed, DISCORD_PERMISSIONS.Administrator) ||
    hasPermission(parsed, DISCORD_PERMISSIONS.ManageGuild)
  );
}

export interface PermissionOverwriteLike {
  readonly id: string;
  readonly type: number;
  readonly allow: string;
  readonly deny: string;
}

export interface RolePermissionLike {
  readonly id: string;
  readonly permissions: string;
}

function applyOverwrite(base: bigint, overwrite: PermissionOverwriteLike): bigint {
  return (base & ~parsePermissions(overwrite.deny)) | parsePermissions(overwrite.allow);
}

export function computeGuildPermissions(args: {
  guildId: string;
  roles: readonly RolePermissionLike[];
  memberRoleIds: readonly string[];
}): bigint {
  const everyoneRole = args.roles.find((role) => role.id === args.guildId);
  let permissions = parsePermissions(everyoneRole?.permissions);

  for (const roleId of args.memberRoleIds) {
    const role = args.roles.find((item) => item.id === roleId);
    if (role) {
      permissions |= parsePermissions(role.permissions);
    }
  }

  return hasPermission(permissions, DISCORD_PERMISSIONS.Administrator)
    ? ALL_PERMISSIONS
    : permissions;
}

export function computeChannelPermissions(args: {
  guildId: string;
  userId: string;
  guildPermissions: bigint;
  memberRoleIds: readonly string[];
  overwrites: readonly PermissionOverwriteLike[];
}): bigint {
  if (hasPermission(args.guildPermissions, DISCORD_PERMISSIONS.Administrator)) {
    return ALL_PERMISSIONS;
  }

  let permissions = args.guildPermissions;
  const everyone = args.overwrites.find(
    (overwrite) => overwrite.id === args.guildId && overwrite.type === 0
  );
  if (everyone) {
    permissions = applyOverwrite(permissions, everyone);
  }

  let allow = 0n;
  let deny = 0n;
  for (const overwrite of args.overwrites) {
    if (overwrite.type !== 0 || !args.memberRoleIds.includes(overwrite.id)) {
      continue;
    }
    allow |= parsePermissions(overwrite.allow);
    deny |= parsePermissions(overwrite.deny);
  }
  permissions = (permissions & ~deny) | allow;

  const member = args.overwrites.find(
    (overwrite) => overwrite.id === args.userId && overwrite.type === 1
  );
  if (member) {
    permissions = applyOverwrite(permissions, member);
  }

  return permissions;
}
