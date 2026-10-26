import fs from 'node:fs';
import path from 'node:path';

// Build configuration only. Runtime environment, URLs and cookies cannot enable
// fixture adapters in a release artifact.
export function legacyTestAliases(configDir, webpack) {
  const directory = path.join(configDir, 'e2e', 'legacy');
  const available = new Set(
    fs.readdirSync(directory, { recursive: true }).filter((file) => file.endsWith('.ts'))
  );
  return new webpack.NormalModuleReplacementPlugin(/.*/, (resource) => {
    const request = resource.request;
    const absolute = request.startsWith('@/lib/')
      ? path.join(configDir, 'lib', request.slice('@/lib/'.length))
      : request.startsWith('.')
        ? path.resolve(resource.context, request)
        : request;
    const file = `${absolute.replace(/\.ts$/, '')}.ts`;
    const name = path.relative(path.join(configDir, 'lib'), file);
    if (!available.has(name)) return;
    // The explicit import of a module's original implementation reuses its types
    // and parsers. Its own dependencies still traverse the test-build boundary.
    if (
      resource.context.startsWith(directory) &&
      request.startsWith('.') &&
      request.includes('/lib/')
    )
      return;
    resource.request = path.join(directory, name);
  });
}
