import { randomUUID } from 'node:crypto';
import { notFound, redirect } from 'next/navigation';
import { MemberProfileView } from '@/components/members/MemberProfileView';
import { createMemberProfileDataAdapter } from '@/lib/memberProfileDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import {
  queueDetectionAccountingAction,
  queueMemberManualFlagAction,
  queueMemberOpenCaseAction,
  queueObservedDetectionUndoAction,
} from './actions';

type PageProps = {
  readonly params: Promise<{ readonly guildId: string; readonly userId: string }>;
};

export default async function MemberProfilePage({ params }: PageProps) {
  const { guildId, userId } = await params;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/members/${userId}`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  const profile = await createMemberProfileDataAdapter().getMemberProfile(guildId, userId);
  if (!profile) {
    notFound();
  }

  return (
    <MemberProfileView
      guildId={guildId}
      guildName={guild.name}
      manualFlagRequestId={randomUUID()}
      openCaseRequestId={randomUUID()}
      profile={profile}
      queueDetectionAccountingAction={queueDetectionAccountingAction}
      queueMemberManualFlagAction={queueMemberManualFlagAction}
      queueMemberOpenCaseAction={queueMemberOpenCaseAction}
      queueObservedDetectionUndoAction={queueObservedDetectionUndoAction}
      sessionUsername={session.username}
    />
  );
}
