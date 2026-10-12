import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('Setup report-channel persistence (integration)', () => {
  it('keeps the actual message parent when the configured destination changes', async () => {
    const source = ts.createSourceFile(
      'setupDataAdapter.ts',
      readFileSync(resolve(__dirname, '../../../apps/web/lib/setupDataAdapter.ts'), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const queries: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isNoSubstitutionTemplateLiteral(node) && node.text.includes('insert into servers')) {
        queries.push(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(queries).toHaveLength(1);

    await getPrismaClient().$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe('SET LOCAL search_path = pg_temp');
      await transaction.$executeRawUnsafe(`CREATE TEMP TABLE servers (
        guild_id text primary key, case_role_id text, admin_channel_id text,
        verification_channel_id text, admin_notification_role_id text,
        settings jsonb, updated_by text, updated_at timestamptz
      ) ON COMMIT DROP`);
      for (const parent of [undefined, null, 'B']) {
        const guildId = `report-parent-${String(parent)}`;
        await transaction.$executeRawUnsafe(
          'INSERT INTO servers (guild_id, settings) VALUES ($1, $2::jsonb)',
          guildId,
          JSON.stringify({
            report_instructions_channel_id: 'A',
            report_instructions_message_id: '100',
            report_instructions_message_channel_id: parent,
          })
        );
        const result = await transaction.$queryRawUnsafe<{ settings: Record<string, unknown> }[]>(
          queries[0],
          guildId,
          null,
          null,
          null,
          null,
          JSON.stringify({ report_instructions_channel_id: 'C' }),
          'operator'
        );
        expect(result[0]?.settings).toMatchObject({
          report_instructions_channel_id: 'C',
          report_instructions_message_channel_id: parent ?? 'A',
          report_instructions_message_id: '100',
        });
      }
    });
  });
});
