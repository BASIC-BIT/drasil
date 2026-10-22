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
  const chunks = await Promise.all(
    files.filter((file) => file.endsWith('.js')).map((file) => readFile(file, 'utf8'))
  );
  const bundled = chunks.join('\n');
  for (const symbol of ['createMcpHandler', 'mcp-handler', 'oauthProvider'])
    assert(bundled.includes(symbol), `Traced MCP/issuer runtime absent: ${symbol} in ${route}`);
  const loaded = require(artifact);
  assert(loaded.routeModule, `Production route could not load: ${route}`);
  console.log(
    `Production ${route}: ${files.length} traced dependencies exist; bundled transport/issuer and route import verified.`
  );
}
