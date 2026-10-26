import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve('apps/web');
const visited = new Set();
const forbidden = [];
function visit(file, chain) {
  if (visited.has(file)) return;
  visited.add(file);
  if (/(?:fixtures?|stories|\/e2e\/)/i.test(file)) forbidden.push([...chain, file]);
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.isTypeOnly || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.every((entry) => entry.isTypeOnly)
    )
      continue;
    const specifier = statement.moduleSpecifier.text;
    const base = specifier.startsWith('@/')
      ? path.join(root, specifier.slice(2))
      : specifier.startsWith('.')
        ? path.resolve(path.dirname(file), specifier)
        : null;
    if (!base) continue;
    const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`].find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    );
    if (resolved && /\.[cm]?[jt]sx?$/.test(resolved)) visit(resolved, [...chain, file]);
  }
}
function routes(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) routes(file);
    else if (/^(page|route|layout)\.[jt]sx?$/.test(entry.name)) visit(file, []);
  }
}
routes(path.join(root, 'app'));
if (forbidden.length) {
  for (const chain of forbidden)
    console.error(chain.map((file) => path.relative(root, file)).join(' → '));
  process.exitCode = 1;
} else
  console.log(
    `Production route graph: ${visited.size} source modules; no fixtures, studies or simulated test handlers.`
  );

// Bundled modules can hide behind adapter factories, so inspect the release
// trace and emitted server/client JavaScript as well as the source imports.
const release = path.join(root, '.next');
if (fs.existsSync(path.join(release, 'BUILD_ID'))) {
  let bundles = 0;
  let traces = 0;
  const markers =
    /Fixture(?:Setup|ActiveCase|Report|Moderation|MemberProfile|MessageCleanup)|fixture-admin|DRASIL_WEB_E2E_FIXTURE_MODE|e2eFixtures|reportBanFixtures|e2e\/legacy/;
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(file);
      else if (entry.name.endsWith('.nft.json')) {
        traces++;
        for (const dependency of JSON.parse(fs.readFileSync(file, 'utf8')).files) {
          if (/apps\/web\/(?:e2e\/|lib\/[^/]*Fixtures)/.test(dependency))
            throw new Error(`Release trace includes test dependency: ${dependency}`);
        }
      } else if (entry.name.endsWith('.js')) {
        bundles++;
        if (markers.test(fs.readFileSync(file, 'utf8')))
          throw new Error(`Release bundle includes test boundary: ${path.relative(root, file)}`);
      }
    }
  }
  inspect(path.join(release, 'server'));
  inspect(path.join(release, 'static'));
  console.log(
    `Release artifact ${fs.readFileSync(path.join(release, 'BUILD_ID'), 'utf8').trim()}: ${traces} traces and ${bundles} JavaScript bundles exclude test boundaries.`
  );
} else {
  console.log(
    'No release artifact found; source graph checked. Run after web:build for bundle proof.'
  );
}
