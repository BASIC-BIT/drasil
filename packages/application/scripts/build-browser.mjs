import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

// Compile the same canonical, SDK-free schema as ESM for browser bundlers. The
// package and bot entry remain CommonJS; only the import condition uses this leaf.
const source = await readFile(new URL('../src/setup/settings.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
  fileName: 'settings.ts',
});
const directory = new URL('../dist/browser/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('settings.mjs', directory), outputText);
