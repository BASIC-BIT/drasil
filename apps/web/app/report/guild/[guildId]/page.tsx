import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  closeOpenReportIntakeFromWeb,
  startGuidedReportIntakeFromWeb,
  submitUserReportFromWeb,
} from './actions';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import { fetchDiscordGuilds } from '@/lib/discordApi';
import { createReportIntakePortalDataAdapter } from '@/lib/reportIntakePortalDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';

type PageProps = {
  readonly params: Promise<{ readonly guildId: string }>;
  readonly searchParams: Promise<{
    readonly closed?: string;
    readonly guided?: string;
    readonly queued?: string;
    readonly target?: string;
  }>;
};

const USER_REPORT_REASON_MAX_LENGTH = 900;

export default async function GuildReportPage({ params, searchParams }: PageProps) {
  const [{ guildId }, query, session, token] = await Promise.all([
    params,
    searchParams,
    getCurrentAdminSession(),
    getCurrentDiscordToken(),
  ]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/report/guild/${guildId}`);
  }

  const [guilds, server] = await Promise.all([
    fetchDiscordGuilds(token.accessToken),
    createSetupDataAdapter().getServer(guildId),
  ]);
  const guild = guilds.find((item) => item.id === guildId);
  const submitAction = submitUserReportFromWeb.bind(null, guildId);
  const guidedIntakeAction = startGuidedReportIntakeFromWeb.bind(null, guildId);
  const closeIntakeAction = closeOpenReportIntakeFromWeb.bind(null, guildId);
  const reportDestinationAvailable = Boolean(guild && server?.is_active);
  const openIntake = reportDestinationAvailable
    ? await createReportIntakePortalDataAdapter().getOpenIntakeForReporter({
        guildId,
        reporterId: session.userId,
      })
    : null;
  const reasonRequired = server?.settings.user_report_reason_required === true;
  const guidedIntakeChannelId = server?.settings.report_instructions_channel_id ?? null;
  const queuedTarget = query.queued === '1' ? query.target : null;
  const guidedQueued = query.guided === 'queued';
  const closeQueued = query.closed === 'queued';

  return (
    <main className="shell stack">
      <nav className="topbar">
        <Link className="brand" href="/report">
          <span className="brand-mark" />
          <span>Drasil</span>
        </Link>
        <div className="nav-cluster">
          <Link className="button secondary" href="/report">
            Report Servers
          </Link>
          <ThemeToggle />
          <AccountControl username={session.username} />
        </div>
      </nav>

      <section className="panel stack">
        <div className="section-heading">
          <span className={reportDestinationAvailable ? 'status ok' : 'status warning'}>
            {reportDestinationAvailable ? 'Report enabled' : 'Unavailable'}
          </span>
          <h1 className="page-title">{guild?.name ?? 'Server Report'}</h1>
          <p className="lede">
            Submit a Discord user ID for moderator review in this server. Drasil will verify the
            target is still a member before creating the report.
          </p>
        </div>
        {queuedTarget ? (
          <div className="card">
            <span className="status ok">Report queued</span>
            <h2>Report queued for {queuedTarget}</h2>
            <p className="muted">
              Moderators will review the report through the same queue used by Discord reports.
            </p>
          </div>
        ) : null}
        {guidedQueued ? (
          <div className="card">
            <span className="status ok">Guided report queued</span>
            <h2>Private report thread requested</h2>
            <p className="muted">
              Drasil will open or reuse a private report intake thread in Discord.
            </p>
          </div>
        ) : null}
        {closeQueued ? (
          <div className="card">
            <span className="status ok">Report intake close queued</span>
            <h2>Close request queued</h2>
            <p className="muted">
              Drasil will close the intake through the same Discord thread workflow.
            </p>
          </div>
        ) : null}
      </section>

      {reportDestinationAvailable ? (
        <>
          {openIntake ? (
            <form action={closeIntakeAction} className="panel stack">
              <div className="section-heading compact-heading">
                <span className="status warning">Open report thread</span>
                <h2>Open Report Thread</h2>
                <p className="muted">
                  Continue in Discord or close the open intake before starting over.
                </p>
              </div>
              <input name="reportIntakeId" type="hidden" value={openIntake.id} />
              <div className="actions">
                {openIntake.threadUrl ? (
                  <Link className="button secondary" href={openIntake.threadUrl}>
                    Open Discord thread
                  </Link>
                ) : null}
                <span className="muted">Status: {openIntake.status.split('_').join(' ')}</span>
              </div>
              <div className="actions">
                <label>
                  <input name="confirmCloseIntake" required type="checkbox" /> Close this report
                  intake
                </label>
              </div>
              <div className="actions">
                <button className="button secondary" type="submit">
                  Queue close report
                </button>
              </div>
            </form>
          ) : null}

          <form action={guidedIntakeAction} className="panel stack">
            <div className="section-heading compact-heading">
              <h2>Guided Report Thread</h2>
              <p className="muted">
                Open a private Discord thread to collect message links, screenshots, and target
                confirmation before anything is submitted.
              </p>
            </div>
            <div className="actions">
              <button className="button secondary" disabled={!guidedIntakeChannelId} type="submit">
                Start guided report
              </button>
              <p className="muted">
                {guidedIntakeChannelId
                  ? 'Thread parent: configured report instructions channel.'
                  : 'A report instructions channel must be configured first.'}
              </p>
            </div>
          </form>

          <form action={submitAction} className="panel stack">
            <div className="section-heading compact-heading">
              <h2>Direct User Report</h2>
              <p className="muted">
                Use the numeric Discord user ID for the account you want moderators to review.
              </p>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="targetUserId">Discord user ID</label>
                <input
                  autoComplete="off"
                  id="targetUserId"
                  inputMode="numeric"
                  name="targetUserId"
                  pattern="[0-9]{15,22}"
                  placeholder="123456789012345678"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="reason">Report reason{reasonRequired ? '' : ' (optional)'}</label>
                <textarea
                  id="reason"
                  maxLength={USER_REPORT_REASON_MAX_LENGTH}
                  name="reason"
                  placeholder="What happened?"
                  required={reasonRequired}
                  rows={5}
                />
              </div>
            </div>
            <div className="actions">
              <label>
                <input name="confirmReport" required type="checkbox" /> Submit this report for
                moderator review
              </label>
            </div>
            <div className="actions">
              <button className="button" type="submit">
                Submit report
              </button>
              <p className="muted">Signed in as {session.username}.</p>
            </div>
          </form>
        </>
      ) : (
        <section className="panel stack">
          <h2>Report destination unavailable</h2>
          <p className="muted">
            This server is not shared with the signed-in Discord account, or Drasil is not active
            there.
          </p>
          <div className="actions">
            <Link className="button secondary" href="/report">
              Choose another server
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
