import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ApprovalSignIn } from './SignIn';
import { getMcpConnectionContext } from '../../../../lib/mcp/connectionData';
import { loadMcpWebsiteApproval } from '../../../../lib/mcp/websiteApprovals';
import { approveMcpConfirmation, cancelMcpConfirmation } from './actions';
import { ConfirmationView } from './ConfirmationView';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ confirmationId: string }> }) {
  const context = getMcpConnectionContext();
  if (!context) notFound();
  const { confirmationId } = await params;
  let session;
  try {
    session = await context.issuer.requireSession(await headers());
  } catch {
    return <ApprovalSignIn confirmationId={confirmationId} />;
  }
  try {
    const saved = await loadMcpWebsiteApproval(session, confirmationId);
    return (
      <ConfirmationView
        {...saved}
        approve={approveMcpConfirmation}
        cancel={cancelMcpConfirmation}
      />
    );
  } catch {
    return (
      <main className="mcp-shell">
        <h1>Confirmation unavailable</h1>
        <p>Check the account and connection, then try again.</p>
      </main>
    );
  }
}
