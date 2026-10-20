import { mock } from 'jest-mock-extended';
import { Client, type Guild, type GuildMember } from 'discord.js';
import {
  createBotReportActions,
  type BotReportDependencies,
} from '../../application/adapters/reports';
import type { IReportIntakeService } from '../../services/ReportIntakeService';
import type { IConfigService } from '../../config/ConfigService';
import type { ISecurityActionService } from '../../services/SecurityActionService';
import { ReportIntakeStatus, type ReportIntake } from '../../repositories/types';
const context = {
  guildId: 'guild',
  requestId: 'request',
  source: 'discord_interaction',
  actor: { kind: 'user' as const, userId: 'reporter' },
};
function fixture() {
  const client = new Client({ intents: [] });
  const intakes = mock<IReportIntakeService>();
  const config = mock<IConfigService>();
  const security = mock<ISecurityActionService>();
  const deps: BotReportDependencies = {
    client,
    reportIntakeService: intakes,
    configService: config,
    securityActionService: security,
    threadManager: mock<BotReportDependencies['threadManager']>(),
  };
  const intake: ReportIntake = {
    id: 'intake',
    server_id: 'guild',
    reporter_id: 'reporter',
    thread_id: 'thread',
    status: ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
    summary: null,
    confirmed_target_user_id: null,
    metadata: {
      last_confirmation_prompt_message_id: 'current',
      last_confirmation_prompt_candidate_ids: ['target'],
    },
    closed_at: null,
    created_at: null,
    updated_at: null,
  };
  intakes.findIntakeById.mockResolvedValue(intake);
  return { client, intakes, config, security, intake, actions: createBotReportActions(deps) };
}
it('fresh reporter facts are bound before queued submission', async () => {
  const f = fixture();
  const member = {
    id: 'other',
    permissions: { bitfield: 0n },
    roles: { cache: new Map() },
  } as unknown as GuildMember;
  const guild = {
    id: 'guild',
    roles: { fetch: jest.fn() },
    members: { fetch: jest.fn(async () => member) },
  } as unknown as Guild;
  const fetchGuild = jest.spyOn(f.client.guilds, 'fetch').mockResolvedValue(guild as never);
  const result = await f.actions.execute(context, {
    kind: 'submit_user_report',
    targetUserId: 'target',
    targetLabel: 'target',
    reason: null,
  });
  expect(result).toEqual({ kind: 'denied', code: 'binding_mismatch' });
  expect(fetchGuild).toHaveBeenCalledWith({ guild: 'guild', force: true });
  expect(guild.members.fetch).toHaveBeenCalledWith({ user: 'reporter', force: true });
  expect(f.security.handleUserReport).not.toHaveBeenCalled();
});
it('persisted current prompt rejects an untrusted candidate before any confirmation write', async () => {
  const f = fixture();
  expect(
    await f.actions.execute(context, {
      kind: 'confirm_intake_candidate',
      intakeId: 'intake',
      threadId: 'thread',
      promptMessageId: 'current',
      targetUserId: 'different',
    })
  ).toEqual({ kind: 'denied', code: 'confirmation_required' });
  expect(f.intakes.confirmCandidate).not.toHaveBeenCalled();
  expect(f.security.handleConfirmedReportIntake).not.toHaveBeenCalled();
});
it('a report ban claim prevents thread closure and domain writes', async () => {
  const f = fixture();
  f.intake.metadata = { report_ban_operation_id: 'operation' };
  const result = await f.actions.execute(context, {
    kind: 'close_report_intake',
    intakeId: 'intake',
  });
  expect(result).toMatchObject({ outcome: { status: 'busy' } });
  expect(f.intakes.closeIntakeForThread).not.toHaveBeenCalled();
});
it('loads current required-reason settings with fail-closed options at execution', async () => {
  const f = fixture();
  const member = {
    id: 'reporter',
    permissions: { bitfield: 0n },
    roles: { cache: new Map() },
  } as unknown as GuildMember;
  const guild = {
    id: 'guild',
    roles: { fetch: jest.fn() },
    members: { fetch: jest.fn(async () => member) },
  } as unknown as Guild;
  jest.spyOn(f.client.guilds, 'fetch').mockResolvedValue(guild as never);
  f.config.getServerConfig.mockResolvedValue({
    settings: { user_report_reason_required: true },
  } as never);
  expect(
    await f.actions.execute(context, {
      kind: 'submit_user_report',
      targetUserId: 'target',
      targetLabel: 'target',
      reason: null,
    })
  ).toEqual({ kind: 'denied', code: 'reason_required' });
  expect(f.config.getServerConfig).toHaveBeenCalledWith('guild', {
    forceRefresh: true,
    failOnReadError: true,
  });
  expect(f.security.handleUserReport).not.toHaveBeenCalled();
});
