'use server';
import { headers } from 'next/headers';
import type { GuildSelection } from '@drasil/application';
import {
  getMcpConnectionContext,
  eligibleServerPage,
  clientLabel,
  flowSelection,
  ownConnections,
} from '../../lib/mcp/connectionData';

function context() {
  const value = getMcpConnectionContext();
  if (!value) throw new Error('Connections unavailable.');
  return value;
}
async function browserRequest(): Promise<Request> {
  const ctx = context();
  return new Request(`${ctx.config.origin}/mcp`, { method: 'POST', headers: await headers() });
}
/** flowId carries the exact provider-signed query for this tab, including repeated ba_param. */
export async function selectMcpServers(
  flowId: string,
  selection: GuildSelection,
  grantedScopes?: readonly string[]
): Promise<string> {
  return context().service.selectMcpServers(
    await browserRequest(),
    flowId,
    selection,
    grantedScopes
  );
}
export async function consentMcpConnection(
  flowId: string,
  grantedScopes: readonly string[]
): Promise<string> {
  return context().service.consentMcpConnection(await browserRequest(), flowId, grantedScopes);
}
export async function declineMcpConnection(flowId: string): Promise<string> {
  return context().service.declineMcpConnection(await browserRequest(), flowId);
}
export async function revokeMcpConnection(
  connectionId: string,
  expectedVersion: number
): Promise<void> {
  await context().service.revokeMcpConnection(
    await browserRequest(),
    connectionId,
    expectedVersion
  );
}
export async function updateMcpSelection(
  connectionId: string,
  expectedVersion: number,
  selection: GuildSelection
): Promise<void> {
  await context().service.updateMcpSelection(
    await browserRequest(),
    connectionId,
    expectedVersion,
    selection
  );
}
export async function loadMcpFlow(flowId: string) {
  const ctx = context();
  const session = await ctx.issuer.requireSession(await headers());
  const flow = await ctx.issuer.flows.createAuthorizationFlow(session, flowId);
  const grant = flow.referenceId
    ? await flowSelection(ctx, flow.referenceId, await ctx.actor(session))
    : null;
  return {
    label: await clientLabel(ctx, flow.clientId),
    clientId: flow.clientId,
    requestedScopes: flow.requestedScopes,
    approvedScopes: flow.approvedScopes,
    selection: grant?.selection ?? null,
    ...(await eligibleServerPage(ctx, session, null)),
  };
}
export async function loadMcpServers(flowId: string | null, cursor: string | null) {
  const ctx = context();
  const session = await ctx.issuer.requireSession(await headers());
  if (flowId) await ctx.issuer.flows.createAuthorizationFlow(session, flowId);
  return eligibleServerPage(ctx, session, cursor);
}
export async function loadMcpConnections(cursor: string | null = null) {
  const ctx = context();
  const session = await ctx.issuer.requireSession(await headers());
  return ownConnections(ctx, session, cursor);
}
export async function mcpSessionStatus(): Promise<'disabled' | 'login' | 'authenticated'> {
  const ctx = getMcpConnectionContext();
  if (!ctx) return 'disabled';
  try {
    await ctx.issuer.requireSession(await headers());
    return 'authenticated';
  } catch {
    return 'login';
  }
}
