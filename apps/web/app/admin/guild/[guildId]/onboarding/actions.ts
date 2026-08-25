'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { detectionResponseModeSchema } from '@drasil/contracts';
import type { InboxActionState } from '@/lib/inboxActionState';
import { failedInboxActionState, queuedInboxActionState } from '@/lib/inboxActionState';
import { DISCORD_PERMISSIONS, hasPermission, parsePermissions } from '@/lib/discordPermissions';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { queueCompleteSetupVerificationRequestWithReceipt } from '@/lib/setupArtifactActionQueue';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

function read(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function completeOnboarding(
  guildId: string,
  _previousState: InboxActionState,
  formData: FormData
): Promise<InboxActionState> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/onboarding`);
  }

  try {
    const guild = await createSetupDashboardService().assertCanManageGuild(
      guildId,
      token.accessToken
    );
    if (
      !guild.owner &&
      !hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.Administrator)
    ) {
      throw new Error('You need Administrator permission to finish Drasil setup.');
    }

    const adminChannelId = read(formData, 'adminChannelId');
    if (!adminChannelId) {
      throw new Error('Choose an admin alert channel before finishing setup.');
    }
    const selectedCaseRole = read(formData, 'caseRoleId');
    const selectedVerificationChannel = read(formData, 'verificationChannelId');
    const selectedReportChannel = read(formData, 'reportInstructionsChannelId');
    const selectedDetectionResponseMode = read(formData, 'detectionResponseMode');
    const detectionResponseMode =
      selectedDetectionResponseMode === '__preserve__'
        ? undefined
        : detectionResponseModeSchema.parse(selectedDetectionResponseMode ?? 'notify_only');

    const receipt = await queueCompleteSetupVerificationRequestWithReceipt({
      actorId: session.userId,
      adminChannelId,
      caseRoleId: selectedCaseRole === '__create__' ? null : selectedCaseRole,
      caseRoleName: selectedCaseRole === '__create__' ? read(formData, 'caseRoleName') : undefined,
      createCaseRole: selectedCaseRole === '__create__',
      detectionResponseMode,
      guildId,
      onboardingWizard: true,
      reportInstructionsChannelId:
        selectedReportChannel === '__none__' ? null : selectedReportChannel,
      submissionId: read(formData, 'submissionId') ?? undefined,
      verificationChannelId:
        selectedVerificationChannel === '__auto__' ? null : selectedVerificationChannel,
    });

    revalidatePath(`/admin/guild/${guildId}/onboarding`);
    revalidatePath(`/admin/guild/${guildId}/setup`);
    revalidatePath(`/admin/guild/${guildId}/operations`);
    return queuedInboxActionState(receipt, 'Setup queued. Drasil is applying and verifying it.');
  } catch (error) {
    return failedInboxActionState(error);
  }
}
