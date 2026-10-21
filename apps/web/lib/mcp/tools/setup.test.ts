import { describe, expect, it, vi } from 'vitest';
import { createSetupTools } from './setup';
import { mcpWorkflowManifest } from '../manifest';

describe('setup and guild operations tools', () => {
  it('registers every setup and operations workflow with its canonical strict parser', () => {
    const tools = createSetupTools({ service: { submit: vi.fn() } });
    expect(tools.map((tool) => tool.toolName)).toEqual(
      mcpWorkflowManifest
        .filter((entry) => ['setup', 'operations'].includes(entry.family))
        .map((entry) => entry.toolName)
    );
  });
});
