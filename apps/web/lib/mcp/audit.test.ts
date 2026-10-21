import { expect, it } from 'vitest';
import { createMcpAudit, createProviderLogger } from './audit';
it('serializes only allowlisted provenance and never errors or private arguments', async () => {
  const lines: string[] = [];
  const record = createMcpAudit((line) => {
    lines.push(line);
  });
  await record({
    event: 'execution',
    userId: '123',
    guildId: '456',
    clientId: 'client',
    connectionId: 'id',
    grantVersion: 2,
    workflowId: 'ban_user',
    confirmationMethod: 'discord',
    executionId: 'execution',
    outcome: 'uncertain',
    queueDelayMs: 321,
    error: new Error('Bearer SENTINEL'),
    command: { token: 'PRIVATE' },
  } as never);
  expect(JSON.parse(lines[0])).toMatchObject({
    event: 'execution',
    userId: '123',
    outcome: 'uncertain',
    queueDelayMs: 321,
  });
  expect(lines.join('')).not.toMatch(/SENTINEL|PRIVATE|Bearer|command|error/);
  const logger = createProviderLogger((line) => {
    lines.push(line);
  });
  logger.log('error', 'Bearer SENTINEL', new Error('PRIVATE'), {
    headers: { authorization: 'SECRET' },
  });
  expect(JSON.parse(lines[1])).toEqual({ event: 'provider', level: 'error' });
  expect(lines.join('')).not.toMatch(/SENTINEL|PRIVATE|SECRET/);
  await record({
    event: 'admission',
    clientId: 'https://client.example/metadata?private=SENTINEL',
  });
  expect(JSON.parse(lines[2])).toEqual({
    event: 'admission',
    clientIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(lines[2]).not.toContain('SENTINEL');
});
