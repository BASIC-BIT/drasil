import { readCasePolicy } from '../cases/policy';
import type { CaseResolutionDependencies } from '../cases/delegation';
import type { DelegationQueryClient } from './delegation';
/** Read-only case state shared by website and bot approval. Visibility remains a runtime port. */
export function createCaseResolutionResources(
  database: DelegationQueryClient,
  guildId: string,
  selectedMessage: CaseResolutionDependencies['selectedMessage']
): CaseResolutionDependencies {
  return {
    settings: {
      loadFresh: async (): Promise<ReturnType<typeof readCasePolicy>> => {
        const row = (
          await database.query<{ settings: unknown }>(
            'select settings from servers where guild_id=$1',
            [guildId]
          )
        ).rows[0];
        if (!row) throw new Error('Guild unavailable.');
        return readCasePolicy(row.settings);
      },
    },
    repository: {
      findById: async (id) =>
        (
          await database.query<{
            id: string;
            server_id: string;
            user_id: string;
            status: string;
            case_kind: string;
            attention_state: string;
            case_revision: number;
          }>(
            'select id,server_id,user_id,status,case_kind,attention_state,case_revision from verification_events where id=$1::uuid and server_id=$2',
            [id, guildId]
          )
        ).rows[0] ?? null,
      findActive: async (_guild, user) =>
        (
          await database.query<{ id: string; server_id: string; user_id: string; status: string }>(
            "select id,server_id,user_id,status from verification_events where server_id=$1 and user_id=$2 and status='pending' order by created_at desc limit 1",
            [guildId, user]
          )
        ).rows[0] ?? null,
      findDetection: async (id) =>
        (
          await database.query<{ server_id: string; user_id: string; reportId: string | null }>(
            `select server_id,user_id,metadata->>'reportIntakeId' as "reportId" from detection_events where id=$1::uuid and server_id=$2`,
            [id, guildId]
          )
        ).rows[0] ?? null,
    },
    selectedMessage,
  };
}
