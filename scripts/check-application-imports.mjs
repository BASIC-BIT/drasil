import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('@drasil/application');
assert.equal(typeof core.createCaseActions, 'function');
assert(
  !Object.keys(require.cache).some((file) =>
    /node_modules\/(?:@modelcontextprotocol|@better-auth|better-auth|mcp-handler)\//.test(file)
  ),
  'Application core must stay free of SDK and issuer runtime dependencies.'
);
assert(!Object.keys(require.cache).some((file) => file.includes('/application/dist/postgres/')));
const postgres = require('@drasil/application/postgres');
assert.equal(typeof postgres.buildEnqueueStatement, 'function');
const approval = require('@drasil/application/approval-presentation');
assert.equal(typeof approval.presentApprovalResult, 'function');
const settings = require('@drasil/application/setup-settings');
const [esmCore, esmPostgres, esmSettings, esmApproval] = await Promise.all([
  import('@drasil/application'),
  import('@drasil/application/postgres'),
  import('@drasil/application/setup-settings'),
  import('@drasil/application/approval-presentation'),
]);
assert.deepEqual(Object.keys(approval).sort(), Object.keys(esmApproval).sort());
assert.equal(typeof esmCore.createCaseActions, 'function');
assert.equal(typeof esmPostgres.buildEnqueueStatement, 'function');
assert.deepEqual(Object.keys(settings).sort(), Object.keys(esmSettings).sort());
assert.deepEqual(
  settings.guildSetupUpdateSchema.parse({ guildId: 'probe', captchaMode: 'off' }),
  esmSettings.guildSetupUpdateSchema.parse({ guildId: 'probe', captchaMode: 'off' })
);
console.log(
  'CommonJS and ES imports passed: isolated core, postgres, canonical setup-settings and approval-presentation.'
);
