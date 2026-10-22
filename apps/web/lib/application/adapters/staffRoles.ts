import { createSetupDataAdapter } from '../../setupDataAdapter';

/** Shared configured report/case responder roles for web actions and delegated reads. */
export function createWebStaffRoles(): {
  loadRoleIds(guildId: string): Promise<readonly string[]>;
} {
  return {
    async loadRoleIds(guildId) {
      return (
        (await createSetupDataAdapter().getServer(guildId))?.settings.case_responder_role_ids ?? []
      );
    },
  };
}
