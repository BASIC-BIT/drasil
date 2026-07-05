import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const errors = [];

const toPath = (relativePath) => path.join(repoRoot, relativePath);
const exists = (relativePath) => fs.existsSync(toPath(relativePath));
const read = (relativePath) => fs.readFileSync(toPath(relativePath), 'utf8');
const assert = (condition, message) => {
  if (!condition) errors.push(message);
};

const readIfExists = (relativePath) => (exists(relativePath) ? read(relativePath) : '');

const listDirectories = (relativePath) => {
  if (!exists(relativePath)) return [];

  return fs
    .readdirSync(toPath(relativePath), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
};

const parseProjectOpenCodeMcpNames = () => {
  if (!exists('opencode.json')) return [];

  try {
    const opencode = JSON.parse(read('opencode.json'));
    return Object.keys(opencode.mcp ?? {}).sort((left, right) => left.localeCompare(right));
  } catch (error) {
    errors.push(`opencode.json must be valid JSON: ${error.message}`);
    return [];
  }
};

const parseCodexMcpNames = () => {
  const config = readIfExists('.codex/config.toml');
  return [...config.matchAll(/^\[mcp_servers\.([^\]]+)\]/gmu)]
    .map((match) => match[1])
    .sort((left, right) => left.localeCompare(right));
};

assert(exists('AGENTS.md'), 'AGENTS.md must exist.');
assert(exists('docs/dev/codex.md'), 'docs/dev/codex.md must exist.');
assert(exists('.opencode/skills'), '.opencode/skills must exist.');
assert(exists('.codex/skills'), '.codex/skills must exist.');

const agents = readIfExists('AGENTS.md');
const codexDocs = readIfExists('docs/dev/codex.md');
const opencodeSkillNames = listDirectories('.opencode/skills');
const codexSkillNames = listDirectories('.codex/skills');

assert(opencodeSkillNames.length > 0, '.opencode/skills must contain at least one skill.');
assert(
  agents.includes('.codex/skills/*'),
  'AGENTS.md must mention the Codex wrapper skill location.'
);

for (const skillName of opencodeSkillNames) {
  const sourcePath = `.opencode/skills/${skillName}/SKILL.md`;
  const wrapperPath = `.codex/skills/${skillName}/SKILL.md`;
  const wrapper = readIfExists(wrapperPath);

  assert(exists(sourcePath), `${sourcePath} must exist.`);
  assert(exists(wrapperPath), `${wrapperPath} must exist.`);
  assert(codexSkillNames.includes(skillName), `.codex/skills must include ${skillName}.`);
  assert(wrapper.startsWith('---\n'), `${wrapperPath} must start with frontmatter.`);
  assert(wrapper.includes(`name: ${skillName}`), `${wrapperPath} must declare name: ${skillName}.`);
  assert(/^description:\s+\S/mu.test(wrapper), `${wrapperPath} must include a description.`);
  assert(
    !/^compatibility:/mu.test(wrapper),
    `${wrapperPath} must not use OpenCode-only compatibility frontmatter.`
  );
  assert(wrapper.includes(sourcePath), `${wrapperPath} must point to ${sourcePath}.`);
  assert(codexDocs.includes(`- \`${skillName}\``), `docs/dev/codex.md must list ${skillName}.`);
}

const opencodeMcpNames = parseProjectOpenCodeMcpNames();
const codexMcpNames = parseCodexMcpNames();

for (const mcpName of opencodeMcpNames) {
  assert(
    codexMcpNames.includes(mcpName),
    `.codex/config.toml must define [mcp_servers.${mcpName}] to mirror opencode.json.`
  );
}

for (const mcpName of codexMcpNames) {
  assert(codexDocs.includes(`- \`${mcpName}\``), `docs/dev/codex.md must list MCP ${mcpName}.`);
}

if (opencodeMcpNames.length === 0 && codexMcpNames.length === 0) {
  assert(
    codexDocs.includes('No project-scoped OpenCode MCP servers are committed'),
    'docs/dev/codex.md must state that Drasil has no project-scoped OpenCode MCP servers.'
  );
}

if (errors.length > 0) {
  console.error('Agent tooling check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Agent tooling check passed.');
