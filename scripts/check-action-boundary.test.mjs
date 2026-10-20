import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const checker = path.resolve('scripts/check-action-boundary.mjs');
function fixture(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'drasil-boundary-'));
  const entries = {
    'prisma/schema.prisma': 'enum moderation_action_request_type {\n verify_case_user\n}',
    'packages/application/src/requests/commands.ts':
      'export const queuedCommandSchemas = { verify_case_user: true };',
    'src/application/requestDispatch.ts':
      'export const queuedActionHandlers = { verify_case_user: true };',
    'packages/application/src/index.ts': 'export const core = true;',
    'docs/dev/action-boundary-inventory.md':
      '| `verify_case_user` | Controller.execute | Fresh | Confirmed | Direct | cases.execute | cases.test.ts | Migrated |',
    ...files,
  };
  for (const [file, text] of Object.entries(entries)) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return {
    root,
    run() {
      return spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
    },
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function check(files, assertion) {
  const context = fixture(files);
  try {
    assertion(context.run());
  } finally {
    context.close();
  }
}
test('missing_enum_handler_fails', () => {
  check(
    { 'src/application/requestDispatch.ts': 'export const queuedActionHandlers = {};' },
    (result) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /verify_case_user.*handler/);
    }
  );
});
test('missing_enum_codec_fails', () => {
  check(
    { 'packages/application/src/requests/commands.ts': 'export const queuedCommandSchemas = {};' },
    (result) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /verify_case_user.*codec/);
    }
  );
});
test('aliased_workflow_import_in_ui_fails', () => {
  check(
    {
      'src/services/UserModerationService.ts': 'export const enforce = () => true;',
      'src/domainExports.ts': "export { enforce as run } from './services/UserModerationService';",
      'apps/web/app/actions.ts':
        "import { run as innocuous } from '../../../src/domainExports'; export const submit = () => innocuous();",
    },
    (result) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /workflow import/);
    }
  );
});
test('aliased_workflow_in_mixed_controller_fails_but_unrelated_read_is_allowed', () => {
  const service = 'export interface Workflow { verifyUser(): void; getState(): void; }';
  check(
    {
      'src/services/UserModerationService.ts': service,
      'src/controllers/InteractionHandler.ts':
        "import type { Workflow as Renamed } from '../services/UserModerationService'; class InteractionHandler { constructor(private work: Renamed) {} executeConfirmedCaseAction() { const alias = this.work.verifyUser; alias(); } readOnly() { this.work.getState(); } }",
    },
    (result) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /direct workflow call/);
    }
  );
  check(
    {
      'src/services/UserModerationService.ts': service,
      'src/controllers/InteractionHandler.ts':
        "import type { Workflow as Renamed } from '../services/UserModerationService'; class InteractionHandler { constructor(private work: Renamed) {} executeConfirmedCaseAction() { return true; } readOnly() { this.work.getState(); } }",
    },
    (result) => assert.equal(result.status, 0, result.stderr)
  );
});
test('namespace_workflow_alias_in_ui_fails', () => {
  check(
    {
      'src/services/UserModerationService.ts': 'export const enforce = () => true;',
      'src/domainExports.ts': "export { enforce as run } from './services/UserModerationService';",
      'apps/web/app/actions.ts':
        "import * as facade from '../../../src/domainExports'; export const submit = () => facade.run();",
    },
    (result) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /workflow import/);
    }
  );
});
test('domain_internal_call_is_allowed', () => {
  check(
    {
      'src/services/UserModerationService.ts': 'export const enforce = () => true;',
      'src/services/RecoveryService.ts':
        "import { enforce as resume } from './UserModerationService'; resume();",
      'src/application/adapters/cases.ts':
        "import { enforce } from '../../services/UserModerationService'; enforce();",
    },
    (result) => assert.equal(result.status, 0, result.stderr)
  );
});
for (const [owner, method] of [
  ['controllers/ReportInstructionsManager', 'upsertReportInstructionsMessage'],
  ['controllers/ReportInstructionsManager', 'clearReportInstructions'],
  ['services/RoleGateService', 'applyResolution'],
]) {
  test(`mixed_mutation_cannot_bypass_${method}`, () => {
    check(
      {
        [`src/${owner}.ts`]: `export interface Workflow { ${method}(): void; }`,
        'src/controllers/InteractionHandler.ts': `
          import type { Workflow as Renamed } from '../${owner}';
          class InteractionHandler {
            constructor(private workflow: Renamed) {}
            executeConfirmedCaseAction() { const alias = this.workflow.${method}; alias(); }
          }
        `,
      },
      (result) => {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, new RegExp(`direct workflow call ${method}`));
      }
    );
  });
}
test('role_gate_and_report_instructions_reads_and_owned_runtime_calls_are_allowed', () => {
  check(
    {
      'src/controllers/ReportInstructionsManager.ts':
        'export interface Instructions { readRepostBinding(): void; clearReportInstructions(): void; }',
      'src/services/RoleGateService.ts':
        'export interface RoleGate { previewResolution(): void; applyResolution(): void; }',
      'src/services/RecoveryService.ts': `
        import type { Instructions } from '../controllers/ReportInstructionsManager';
        import type { RoleGate } from './RoleGateService';
        export function recover(instructions: Instructions, roles: RoleGate) {
          instructions.clearReportInstructions(); roles.applyResolution();
        }
      `,
      'src/controllers/RuntimeRecovery.ts': `
        import { recover } from '../services/RecoveryService';
        import type { Instructions } from './ReportInstructionsManager';
        import type { RoleGate } from '../services/RoleGateService';
        export function run(instructions: Instructions, roles: RoleGate) {
          recover(instructions, roles); roles.applyResolution();
        }
      `,
      'src/controllers/InteractionHandler.ts': `
        import type { Instructions } from './ReportInstructionsManager';
        import type { RoleGate } from '../services/RoleGateService';
        class InteractionHandler {
          constructor(private instructions: Instructions, private roles: RoleGate) {}
          executeConfirmedCaseAction() {
            this.instructions.readRepostBinding(); this.roles.previewResolution();
          }
        }
      `,
    },
    (result) => assert.equal(result.status, 0, result.stderr)
  );
});
test('pending_inventory_row_fails', () => {
  check(
    { 'docs/dev/action-boundary-inventory.md': '| `verify_case_user` | Pending |' },
    (result) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /unmigrated/);
    }
  );
});
test('core_import_does_not_load_postgres', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function (id, ...args) {
      assert(!/(^pg$|postgres|prisma|discord\\.js|next\\/)/.test(id), id);
      return load.call(this, id, ...args);
    };
    require('@drasil/application');
  `,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
});
test('canonical_setup_leaf_supports_commonjs_and_es_imports', async () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import * as browser from '@drasil/application/setup-settings';
    const commonjs = createRequire(import.meta.url)('@drasil/application/setup-settings');
    assert.deepEqual(Object.keys(browser).sort(), Object.keys(commonjs).sort());
    assert.deepEqual(browser.guildSetupUpdateSchema.parse({guildId:'g', captchaMode:'manual'}), commonjs.guildSetupUpdateSchema.parse({guildId:'g', captchaMode:'manual'}));
    assert.equal(Object.keys(browser.guildSetupUpdateSchema.innerType().shape).filter(key => !['guildId', 'updatedBy'].includes(key)).length, 73);
  `,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
});
