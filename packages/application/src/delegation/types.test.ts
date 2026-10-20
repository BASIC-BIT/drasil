import { humanCommandSchema, type HumanCommand, type WorkflowId } from './commands';
import type { GuildSelection, HumanOutcome, DelegatedScope } from './types';

it('keeps human command and outcome contracts separate from system authority', () => {
  // These compile-time fixtures fail typechecking if the human contracts are widened.
  // @ts-expect-error System CAPTCHA completion cannot be delegated as a human command.
  const system: HumanCommand = { kind: 'apply_captcha_pass' };
  // @ts-expect-error Infrastructure diagnostics are not family outcomes.
  const arbitraryOutcome: HumanOutcome = { databaseWrite: 'arbitrary' };
  // @ts-expect-error All-eligible consent does not contain a hidden selected-guild restriction.
  const ambiguous: GuildSelection = { mode: 'all_eligible', guildIds: ['123'] };
  // @ts-expect-error OAuth infrastructure scope is not a Drasil action scope.
  const scope: DelegatedScope = 'offline_access';
  // @ts-expect-error Semantic case opening must select its actual authority workflow.
  const ambiguousWorkflow: WorkflowId = 'open_admin_case';
  expect(ambiguousWorkflow).toBe('open_admin_case');
  expect(humanCommandSchema.safeParse(system).success).toBe(false);
  expect([arbitraryOutcome, ambiguous, scope]).toHaveLength(3);
});
