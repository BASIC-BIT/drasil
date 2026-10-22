import { setupResourceReferences, validateSetupResourceReferences } from './resources';
import { operationCommandSchema } from '../operations/commands';
import {
  selectSetupProvisioning,
  type SetupSelectionResources,
  type SetupProvisioningSelection,
} from './selection';
import { ActionDeniedError } from '../results';
import { workflowDefinitions, type HumanCommand } from '../delegation/commands';
import type { IntentResolver, IntentResolution, IntentPreconditions } from '../delegation/types';
import { canonicalDigest } from '../delegation/intents';
import type { AuthorityPort } from '../authorization';
import { setupCommandSchema, type SetupCommand, type HeuristicChanges } from './commands';
import {
  buildSetupSettingsPatch,
  settingsSectionSchemas,
  type SetupServerRecord,
} from './settings';
import {
  normalizeHeuristicKeywords,
  setupApprovedState,
  setupStoredChange,
  type SetupStoredChange,
} from './persistence';
import { validateSetupPolicy } from './policy';
import { shippedHeuristicDefaults } from './defaults';
import type { QueuedCommand } from '../requests/commands';

export interface SetupResolutionResources {
  loadServer(guildId: string): Promise<SetupServerRecord | null>;
  loadGuildResources(guildId: string): Promise<SetupSelectionResources>;
  readonly authority: AuthorityPort;
  readonly provider: { isConfigured(): boolean };
  loadHeuristicDefaults(scope: 'all' | 'keywords'): Promise<HeuristicChanges>;
}
export function shippedResetChanges(scope: 'all' | 'keywords'): HeuristicChanges {
  return {
    ...(scope === 'all'
      ? {
          messageThreshold: shippedHeuristicDefaults.messageThreshold,
          timeframeSeconds: shippedHeuristicDefaults.timeframeSeconds,
        }
      : {}),
    suspiciousKeywords: [...shippedHeuristicDefaults.suspiciousKeywords],
  };
}
export function approvedResetDelivery(
  command: HumanCommand,
  child: QueuedCommand,
  precondition: IntentPreconditions
): boolean {
  return (
    command.kind === 'reset_heuristics' &&
    child.kind === 'update_heuristics' &&
    precondition.kind === 'setup' &&
    canonicalDigest(child.changes) === canonicalDigest(shippedResetChanges(command.scope))
  );
}
function changeFor(
  command: SetupCommand,
  state: SetupServerRecord,
  reset?: HeuristicChanges
): SetupStoredChange {
  switch (command.kind) {
    case 'update_setup':
      return setupStoredChange({
        columns: command.changes,
        settings: buildSetupSettingsPatch({ guildId: state.guild_id, ...command.changes }),
      });
    case 'update_settings':
      return {
        settings: command.changes,
        resetSettings:
          command.section === 'verification'
            ? command.reset === 'prompt'
              ? ['verification_prompt_template']
              : command.reset === 'context'
                ? ['server_about', 'verification_context', 'expected_topics']
                : []
            : [],
      };
    case 'disable_lockdown':
      return { settings: { case_role_lockdown_enabled: false } };
    case 'lockdown_allow_add':
    case 'lockdown_allow_remove': {
      const key =
        command.targetKind === 'channel'
          ? 'case_role_lockdown_allowed_channel_ids'
          : 'case_role_lockdown_allowed_category_ids';
      const ids = new Set(state.settings[key] ?? []);
      if (command.kind === 'lockdown_allow_add') ids.add(command.targetId);
      else ids.delete(command.targetId);
      return { settings: { [key]: [...ids] } };
    }
    case 'reset_heuristics':
    case 'update_heuristics': {
      const changes = command.kind === 'update_heuristics' ? command.changes : reset!;
      return {
        columns: {
          heuristic_message_threshold: changes.messageThreshold,
          heuristic_message_timeframe_seconds: changes.timeframeSeconds,
          heuristic_suspicious_keywords: normalizeHeuristicKeywords(
            changes.suspiciousKeywords ?? state.heuristic_suspicious_keywords
          ),
        },
      };
    }
    case 'complete_setup_verification':
      return {
        columns: {
          admin_channel_id: command.adminChannelId,
          case_role_id: command.caseRoleId ?? undefined,
          verification_channel_id: command.verificationChannelId ?? undefined,
          is_active: true,
        },
        settings:
          command.mode === 'provision'
            ? {
                ...(command.detectionResponseMode
                  ? {
                      detection_response_mode: command.detectionResponseMode,
                      message_detection_response_mode: null,
                      join_detection_response_mode: null,
                    }
                  : {}),
                ...(command.reportInstructionsChannelId || command.onboardingWizard
                  ? { report_instructions_channel_id: command.reportInstructionsChannelId ?? null }
                  : {}),
              }
            : {},
      };
    case 'upsert_report_instructions':
      return { settings: { report_instructions_channel_id: command.channelId } };
    case 'clear_report_instructions':
      return { settings: { report_instructions_channel_id: null } };
  }
}
const editableKeys = new Set(
  Object.values(settingsSectionSchemas).flatMap((schema) => Object.keys(schema.shape))
);
export function setupChangeSummary(state: SetupServerRecord, change: SetupStoredChange): string {
  const diff: string[] = [];
  const display = (value: unknown): string =>
    value === undefined ? '(unset)' : JSON.stringify(value);
  for (const [key, value] of Object.entries(change.columns ?? {}))
    if (value !== undefined && display(state[key as keyof SetupServerRecord]) !== display(value))
      diff.push(`${key}: ${display(state[key as keyof SetupServerRecord])} -> ${display(value)}`);
  const keys = new Set([...Object.keys(change.settings ?? {}), ...(change.resetSettings ?? [])]);
  for (const key of keys) {
    if (!editableKeys.has(key)) continue;
    const value = change.resetSettings?.some((resetKey) => resetKey === key)
      ? undefined
      : change.settings?.[key];
    if (display(state.settings[key]) !== display(value))
      diff.push(`${key}: ${display(state.settings[key])} -> ${display(value)}`);
  }
  return diff.length ? diff.join('\n') : 'No editable settings change.';
}
export function createSetupIntentResolver(resources: SetupResolutionResources): IntentResolver {
  return {
    async resolve(principal, invocation): Promise<IntentResolution> {
      const definition = workflowDefinitions.find((entry) => entry.id === invocation.workflowId);
      if (!definition || !['setup', 'operations'].includes(definition.family))
        throw new ActionDeniedError('unsupported_workflow');
      const state = await resources.loadServer(invocation.guildId);
      if (!state || state.guild_id !== invocation.guildId)
        throw new ActionDeniedError('stale_state');
      const bindings = {
        panel: {
          expectedMessageId: state.settings.report_instructions_message_id ?? null,
          expectedChannelId: state.settings.report_instructions_channel_id ?? null,
          submissionId: invocation.idempotencyKey,
        },
      };
      const command = definition.parseCommand(invocation.input, bindings);
      const references = setupResourceReferences(
        definition.family === 'setup'
          ? setupCommandSchema.parse(command)
          : operationCommandSchema.parse(command)
      );
      const guildResources =
        references.length || command.kind === 'complete_setup_verification'
          ? await resources.loadGuildResources(invocation.guildId)
          : undefined;
      if (guildResources) validateSetupResourceReferences(references, guildResources);
      let deliveryCommand: QueuedCommand | undefined;
      let summary: string;
      let provisioning: SetupProvisioningSelection | undefined;
      let defaults: HeuristicChanges | null = null;
      if (definition.family === 'setup') {
        const setup = setupCommandSchema.parse(command);
        if (setup.kind === 'reset_heuristics') {
          defaults = await resources.loadHeuristicDefaults(setup.scope);
          if (canonicalDigest(defaults) !== canonicalDigest(shippedResetChanges(setup.scope)))
            throw new ActionDeniedError('reset_defaults_unavailable');
          deliveryCommand = { kind: 'update_heuristics', changes: defaults };
        }
        if (setup.kind === 'complete_setup_verification') {
          provisioning = selectSetupProvisioning(state, setup, guildResources!);
          if (
            [provisioning.role.kind, provisioning.verification.kind].some(
              (kind) => kind === 'invalid' || kind === 'ambiguous'
            ) ||
            (setup.mode === 'verification_modal' && provisioning.role.kind !== 'reuse')
          )
            throw new ActionDeniedError('invalid_selection');
        }
        const change = changeFor(setup, state, defaults ?? undefined);
        if (provisioning) {
          Object.assign(change, {
            columns: {
              ...change.columns,
              ...(provisioning.role.kind === 'reuse' ? { case_role_id: provisioning.role.id } : {}),
              ...(provisioning.verification.kind === 'reuse'
                ? { verification_channel_id: provisioning.verification.id }
                : {}),
            },
            settings: {
              ...change.settings,
              ...(provisioning.detectionResponseMode
                ? {
                    detection_response_mode: provisioning.detectionResponseMode,
                    message_detection_response_mode: null,
                    join_detection_response_mode: null,
                  }
                : {}),
            },
          });
        }
        const facts = await resources.authority.loadFresh(invocation.guildId, principal.userId);
        if (
          !facts?.present ||
          facts.guildId !== invocation.guildId ||
          facts.userId !== principal.userId
        )
          throw new ActionDeniedError('permission_denied');
        const policy = validateSetupPolicy(
          setup,
          change.settings ?? {},
          state,
          facts.owner,
          resources.provider.isConfigured()
        );
        if (policy) throw new ActionDeniedError(policy);
        summary = `${invocation.workflowId}\n${setupChangeSummary(state, change)}`;
        if (setup.kind === 'reset_heuristics')
          summary += `\nShipped defaults: ${JSON.stringify(defaults)}`;
        if (provisioning) summary += `\nProvisioning plan: ${JSON.stringify(provisioning)}`;
        if (setup.kind === 'complete_setup_verification')
          summary += `\nSetup choices: ${JSON.stringify({ mode: setup.mode, caseRoleId: setup.caseRoleId ?? null, caseRoleName: setup.caseRoleName ?? null, verificationChannelId: setup.verificationChannelId ?? null, reportInstructionsChannelId: setup.reportInstructionsChannelId ?? null, detectionResponseMode: setup.detectionResponseMode ?? null, onboardingWizard: setup.onboardingWizard })}`;
        if (setup.kind === 'upsert_report_instructions')
          summary += `\nPanel channel: ${JSON.stringify(setup.channelId)}; action: ${setup.repost ? 'repost' : 'repair'}`;
      } else {
        // These fields are the canonical public operation options, never runtime provenance.
        const { kind, ...options } = command;
        summary = `${kind}\n${JSON.stringify(options)}`;
        if (command.kind === 'apply_case_role_lockdown')
          summary += `\nIntended settings change:\n${setupChangeSummary(state, {
            settings: { case_role_lockdown_enabled: true },
          })}\nAfter validation succeeds, lockdown is enabled when no overwrite changes are needed or at least one planned overwrite succeeds. External changes may be partial. If application is blocked or every planned overwrite fails, the enabled setting remains unchanged.`;
        if (
          command.kind === 'intake_role_members' &&
          command.execute &&
          state.settings.admin_case_open_requires_reason !== false &&
          !command.reason?.trim()
        )
          throw new ActionDeniedError('reason_required');
      }
      return {
        bindings,
        delivery:
          definition.delivery === 'direct'
            ? { kind: 'direct' }
            : { kind: 'queued', command: deliveryCommand ?? (command as QueuedCommand) },
        preconditions: {
          kind: 'setup',
          approvedState: state,
          ...(provisioning ? { provisioning } : {}),
        },
        relevantState: {
          state: setupApprovedState(state),
          providerConfigured: resources.provider.isConfigured(),
          defaults,
          provisioning,
        },
        summary,
        previewExpiresAt: null,
      };
    },
  };
}
