import { getEffectiveCaptchaMethod, serverSettingsSchema } from '../setup/settings';
import type { DelegationQueryClient } from './delegation';

/** Caller holds the server row lock and owns the transaction. Image cleanup is trigger-owned. */
export async function applyCaptchaMethodChange(
  client: DelegationQueryClient,
  guildId: string,
  previousSettings: unknown,
  nextSettings: unknown
): Promise<number> {
  const previous = serverSettingsSchema.parse(previousSettings ?? {});
  const next = serverSettingsSchema.parse(nextSettings ?? {});
  const changed = getEffectiveCaptchaMethod(previous) !== getEffectiveCaptchaMethod(next);
  const revision = (previous.captcha_method_revision ?? 0) + (changed ? 1 : 0);
  if (revision > 2147483647) throw new Error('CAPTCHA method revision exhausted');
  const disabled =
    (previous.captcha_mode === 'manual' || previous.captcha_mode === 'suspicious_join') &&
    next.captcha_mode === 'off';
  if (!changed && !disabled) return revision;
  // Parent locks precede challenge and attempt locks used by completion and retry.
  await client.query(
    `select v.id from verification_events v
     where v.id in (select verification_event_id from captcha_challenges
       where server_id=$1 and status='pending'::captcha_challenge_status)
     order by v.id for update of v`,
    [guildId]
  );
  await client.query(
    `with cancelled as (
       update captcha_challenges set status='cancelled'::captcha_challenge_status,
         cancelled_at=now(), updated_at=now()
       where server_id=$1 and status='pending'::captcha_challenge_status
       returning id, generation, cancelled_at
     ) update captcha_challenge_requests r
       set outcome='cancelled'::captcha_challenge_request_outcome, outcome_at=c.cancelled_at
       from cancelled c where r.captcha_challenge_id=c.id and r.generation=c.generation`,
    [guildId]
  );
  return revision;
}
