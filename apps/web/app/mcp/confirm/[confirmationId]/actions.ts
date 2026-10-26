'use server';
import { headers } from 'next/headers';
import type { PublicActionResult } from '@drasil/application';
import { getMcpConnectionContext } from '../../../../lib/mcp/connectionData';
import {
  approveMcpIntentFromWebsite,
  cancelMcpIntentFromWebsite,
} from '../../../../lib/mcp/websiteApprovals';
async function mutate(form: FormData, action: 'approve' | 'cancel'): Promise<PublicActionResult> {
  const context = getMcpConnectionContext();
  if (!context) throw new Error('Approvals unavailable.');
  const session = await context.issuer.requireBrowserSession(
    new Request(`${context.config.origin}/mcp/confirm`, {
      method: 'POST',
      headers: await headers(),
    })
  );
  const id = form.get('confirmationId');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id))
    throw new Error('Confirmation unavailable.');
  const result =
    action === 'approve'
      ? await approveMcpIntentFromWebsite(session, id)
      : await cancelMcpIntentFromWebsite(session, id);
  return result;
}
export async function approveMcpConfirmation(form: FormData): Promise<PublicActionResult> {
  return mutate(form, 'approve');
}
export async function cancelMcpConfirmation(form: FormData): Promise<PublicActionResult> {
  return mutate(form, 'cancel');
}
