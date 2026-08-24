'use client';

import Link from 'next/link';
import { useState } from 'react';
import type {
  DetectionResponseMode,
  SetupChecklistItem,
  SetupReadinessStatus,
} from '@drasil/contracts';
import { InboxActionForm, type InboxStateAction } from './inbox/InboxActionForm';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import type { OnboardingWizardValues } from '@/lib/onboardingState';

interface Option {
  readonly id: string;
  readonly name: string;
  readonly type?: number;
}

const STEPS = ['Welcome', 'Alerts', 'Case role', 'Verification', 'Reports', 'Protection', 'Review'];

export function OnboardingWizard({
  action,
  canApplySetup,
  channels,
  checklist,
  durableRequest,
  guildId,
  guildName,
  initialValues,
  initialSubmissionId,
  inviteUrl,
  readiness,
  roles,
}: {
  readonly action: InboxStateAction;
  readonly canApplySetup: boolean;
  readonly channels: readonly Option[];
  readonly checklist: readonly SetupChecklistItem[];
  readonly durableRequest: ModerationActionRequestSummary | null;
  readonly guildId: string;
  readonly guildName: string;
  readonly initialValues: OnboardingWizardValues;
  readonly initialSubmissionId: string;
  readonly inviteUrl: string | null;
  readonly readiness: SetupReadinessStatus;
  readonly roles: readonly Option[];
}) {
  const [step, setStep] = useState(readiness === 'ready' ? STEPS.length - 1 : 0);
  const [values, setValues] = useState(initialValues);
  const [submissionId] = useState(initialSubmissionId);
  const blockingIssues = checklist.filter((item) => item.status === 'error');
  const textChannels = channels.filter((channel) => channel.type === 0);
  const update = <K extends keyof OnboardingWizardValues>(
    key: K,
    value: OnboardingWizardValues[K]
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  if (readiness === 'not_installed') {
    return (
      <section className="panel onboarding-wizard stack">
        <span className="status warning">Install Drasil first</span>
        <h1 className="page-title">Bring Drasil into {guildName}</h1>
        <p className="lede">
          Install the bot, then return here. The wizard will read the server&apos;s channels, roles,
          and live permissions before it changes anything.
        </p>
        <div className="actions">
          {inviteUrl ? (
            <a className="button" href={inviteUrl} rel="noreferrer" target="_blank">
              Install Drasil
            </a>
          ) : null}
          <Link className="button secondary" href={`/admin/guild/${guildId}/onboarding`}>
            Check installation
          </Link>
        </div>
      </section>
    );
  }

  const nextDisabled = step === 1 && !values.adminChannelId;
  const selected = (options: readonly Option[], id: string, fallback: string) =>
    options.find((option) => option.id === id)?.name ?? fallback;

  return (
    <section className="panel onboarding-wizard stack">
      <div className="onboarding-progress" aria-label="Setup progress">
        <span>
          Step {step + 1} of {STEPS.length}
        </span>
        <strong>{STEPS[step]}</strong>
      </div>

      {step === 0 ? (
        <div className="stack">
          <span className={readiness === 'blocked' ? 'status error' : 'status warning'}>
            {readiness === 'blocked' ? 'Setup needs repair' : 'Setup incomplete'}
          </span>
          <h1 className="page-title">Set up Drasil for {guildName}</h1>
          <p className="lede">
            This guided setup chooses the three core resources Drasil needs, applies safe channel
            permissions, and verifies the result before protection becomes active.
          </p>
          {blockingIssues.length > 0 ? (
            <div className="onboarding-issues">
              <strong>What needs attention</strong>
              <ul>
                {blockingIssues.map((issue) => (
                  <li key={issue.key}>{issue.detail}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <label className="field stack">
          <span>Admin alert channel</span>
          <small>Moderator alerts and setup failures are sent here.</small>
          <select
            onChange={(event) => update('adminChannelId', event.target.value)}
            value={values.adminChannelId}
          >
            <option value="">Choose a text channel</option>
            {textChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {step === 2 ? (
        <div className="stack">
          <label className="field stack">
            <span>Case role</span>
            <small>Drasil applies this role while a member is under review.</small>
            <select
              onChange={(event) => update('caseRoleId', event.target.value)}
              value={values.caseRoleId}
            >
              <option value="__create__">Create a new role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  @{role.name}
                </option>
              ))}
            </select>
          </label>
          {values.caseRoleId === '__create__' ? (
            <label className="field stack">
              <span>New role name</span>
              <input
                maxLength={100}
                onChange={(event) => update('caseRoleName', event.target.value)}
                value={values.caseRoleName}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <label className="field stack">
          <span>Verification channel</span>
          <small>
            Let Drasil safely reuse or create #verification, or choose an existing text channel.
          </small>
          <select
            onChange={(event) => update('verificationChannelId', event.target.value)}
            value={values.verificationChannelId}
          >
            <option value="__auto__">Reuse or create #verification</option>
            {textChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {step === 4 ? (
        <label className="field stack">
          <span>Report instructions channel</span>
          <small>Optional: Drasil can post and maintain public reporting instructions here.</small>
          <select
            onChange={(event) => update('reportInstructionsChannelId', event.target.value)}
            value={values.reportInstructionsChannelId}
          >
            <option value="__none__">Skip for now</option>
            {textChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {step === 5 ? (
        <label className="field stack">
          <span>Automatic protection</span>
          <small>
            Notify only is the safest starting point. Restrict can open cases and apply the case
            role after the configured confidence threshold.
          </small>
          <select
            onChange={(event) =>
              update('detectionResponseMode', event.target.value as DetectionResponseMode)
            }
            value={values.detectionResponseMode}
          >
            <option value="notify_only">Notify only (recommended)</option>
            <option value="restrict">Restrict automatically</option>
            <option value="record_only">Record only</option>
            <option value="off">Off</option>
          </select>
        </label>
      ) : null}

      {step === 6 ? (
        <div className="stack">
          <div className="section-heading">
            <h1 className="page-title">Review and finish</h1>
            <p className="lede">
              Drasil will validate permissions, create only the missing artifacts you selected, and
              roll back its changes if final validation fails.
            </p>
          </div>
          <dl className="onboarding-review">
            <div>
              <dt>Admin alerts</dt>
              <dd>#{selected(channels, values.adminChannelId, 'Not selected')}</dd>
            </div>
            <div>
              <dt>Case role</dt>
              <dd>
                {values.caseRoleId === '__create__'
                  ? `Create @${values.caseRoleName}`
                  : `@${selected(roles, values.caseRoleId, 'Missing role')}`}
              </dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>
                {values.verificationChannelId === '__auto__'
                  ? 'Reuse or create #verification'
                  : `#${selected(channels, values.verificationChannelId, 'Missing channel')}`}
              </dd>
            </div>
            <div>
              <dt>Reports</dt>
              <dd>
                {values.reportInstructionsChannelId === '__none__'
                  ? 'Skip for now'
                  : `#${selected(channels, values.reportInstructionsChannelId, 'Missing channel')}`}
              </dd>
            </div>
            <div>
              <dt>Protection</dt>
              <dd>{values.detectionResponseMode.replace(/_/g, ' ')}</dd>
            </div>
          </dl>
          {readiness === 'ready' ? (
            <div className="action-receipt">
              <span className="status ok">ready</span>
              <span>Drasil passed all core setup checks.</span>
            </div>
          ) : !canApplySetup ? (
            <div className="action-receipt danger-text" role="alert">
              <span className="status warning">Administrator required</span>
              <span>
                You can review these choices, but a server owner or Discord Administrator must apply
                setup.
              </span>
            </div>
          ) : (
            <InboxActionForm
              action={action}
              buttonClassName="button"
              buttonLabel="Apply and verify setup"
              durableRequest={durableRequest}
              formClassName="stack"
              pendingLabel="Queueing setup..."
              requestBaseHref={`/admin/guild/${guildId}/operations`}
            >
              <input name="adminChannelId" type="hidden" value={values.adminChannelId} />
              <input name="caseRoleId" type="hidden" value={values.caseRoleId} />
              <input name="caseRoleName" type="hidden" value={values.caseRoleName} />
              <input
                name="verificationChannelId"
                type="hidden"
                value={values.verificationChannelId}
              />
              <input
                name="reportInstructionsChannelId"
                type="hidden"
                value={values.reportInstructionsChannelId}
              />
              <input
                name="detectionResponseMode"
                type="hidden"
                value={values.detectionResponseMode}
              />
              <input name="submissionId" type="hidden" value={submissionId} />
            </InboxActionForm>
          )}
        </div>
      ) : null}

      <div className="actions onboarding-navigation">
        {step > 0 ? (
          <button className="button secondary" onClick={() => setStep(step - 1)} type="button">
            Back
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button
            className="button"
            disabled={nextDisabled}
            onClick={() => setStep(step + 1)}
            type="button"
          >
            Continue
          </button>
        ) : null}
        {readiness === 'ready' && step === STEPS.length - 1 ? (
          <Link className="button" href={`/admin/guild/${guildId}/setup`}>
            Open full settings
          </Link>
        ) : null}
      </div>
    </section>
  );
}
