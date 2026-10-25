'use client';

import { useState } from 'react';
import {
  captchaMethodSchema,
  captchaModeSchema,
  CAPTCHA_MIN_CHALLENGE_LIFETIME_HOURS,
  CAPTCHA_MAX_CHALLENGE_LIFETIME_HOURS,
  CAPTCHA_MIN_MAX_SUBMISSIONS,
  CAPTCHA_MAX_MAX_SUBMISSIONS,
  type CaptchaMethod,
} from '@drasil/contracts';

export function CaptchaSettingsFields({
  method: initialMethod,
  mode: initialMode,
  passAction,
  lifetimeHours,
  maxSubmissions,
  readinessIssues,
}: {
  readonly method: CaptchaMethod;
  readonly mode: 'off' | 'manual' | 'suspicious_join';
  readonly passAction: 'evidence_only' | 'verify_join_only';
  readonly lifetimeHours: number;
  readonly maxSubmissions: number;
  readonly readinessIssues: Record<CaptchaMethod, readonly string[]>;
}) {
  const [method, setMethod] = useState(initialMethod);
  const [mode, setMode] = useState(initialMode);
  return (
    <>
      <div>
        <h2>Security Checks</h2>
        <p className="muted">
          Choose one method for this server. Members use that method, and outages require retry or
          moderator assistance. Issuing a check and resolving a case are separate decisions.
        </p>
      </div>
      <div className="field">
        <label htmlFor="captchaMethod">Security check method</label>
        <select
          id="captchaMethod"
          name="captchaMethod"
          value={method}
          onChange={(event) => {
            const next = captchaMethodSchema.parse(event.target.value);
            if (next !== 'none' && (method === 'none' || mode === 'off')) setMode('manual');
            setMethod(next);
          }}
        >
          <option value="none">None</option>
          <option value="discord_image">Discord image CAPTCHA</option>
          <option value="turnstile">Cloudflare Turnstile</option>
        </select>
      </div>
      {readinessIssues[method].length > 0 ? (
        <p className="danger-text" role="alert">
          This method is not ready. Operator configuration needs:{' '}
          {readinessIssues[method].join(', ')}.
        </p>
      ) : null}
      {method !== 'none' ? (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="captchaMode">Security check issuance</label>
            <select
              id="captchaMode"
              name="captchaMode"
              value={mode}
              onChange={(event) => setMode(captchaModeSchema.parse(event.target.value))}
            >
              {mode === 'off' ? <option value="off">Off</option> : null}
              <option value="manual">Moderator request only</option>
              <option value="suspicious_join">Moderator request and suspicious joins</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="captchaPassAction">Automatic join pass behavior</label>
            <select defaultValue={passAction} id="captchaPassAction" name="captchaPassAction">
              <option value="evidence_only">Record evidence only</option>
              <option value="verify_join_only">Verify unchanged join-only case</option>
            </select>
            <p className="muted">Moderator-requested and non-join checks remain evidence only.</p>
          </div>
          <div className="field">
            <label htmlFor="captchaChallengeLifetimeHours">Challenge lifetime hours</label>
            <input
              defaultValue={lifetimeHours}
              id="captchaChallengeLifetimeHours"
              name="captchaChallengeLifetimeHours"
              type="number"
              min={CAPTCHA_MIN_CHALLENGE_LIFETIME_HOURS}
              max={CAPTCHA_MAX_CHALLENGE_LIFETIME_HOURS}
            />
          </div>
          <div className="field">
            <label htmlFor="captchaMaxSubmissions">Maximum submissions</label>
            <input
              defaultValue={maxSubmissions}
              id="captchaMaxSubmissions"
              name="captchaMaxSubmissions"
              type="number"
              min={CAPTCHA_MIN_MAX_SUBMISSIONS}
              max={CAPTCHA_MAX_MAX_SUBMISSIONS}
            />
          </div>
        </div>
      ) : (
        <p className="muted">
          Checks are disabled. Saved issuance and pass preferences are retained.
        </p>
      )}
    </>
  );
}
