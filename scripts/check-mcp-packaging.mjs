import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
for (const route of ['api/mcp', 'api/mcp-auth/[...all]']) {
  const artifact = fileURLToPath(
    new URL(`../apps/web/.next/server/app/${route}/route.js`, import.meta.url)
  );
  const trace = JSON.parse(await readFile(`${artifact}.nft.json`, 'utf8'));
  assert(
    Array.isArray(trace.files) && trace.files.length > 0,
    `Missing dependency trace: ${route}`
  );
  const files = trace.files.map((file) => path.resolve(path.dirname(artifact), file));
  await Promise.all(files.map((file) => access(file)));
  const loaded = require(artifact);
  assert(loaded.routeModule, `Production route could not load: ${route}`);
  // Next 16.4 lazily loads userland and minifies internal function names.
  // Verify executable route exports instead of searching for renamed symbols.
  await loaded.routeModule.ensureUserland();
  for (const method of ['GET', 'POST', ...(route === 'api/mcp' ? ['DELETE'] : [])])
    assert.equal(
      typeof loaded.routeModule.userland[method],
      'function',
      `Production handler missing: ${method} ${route}`
    );
  console.log(
    `Production ${route}: ${files.length} traced dependencies exist; lazy route import and request handlers verified.`
  );
}
