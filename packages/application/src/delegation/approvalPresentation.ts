import type { PublicActionResult } from './types';

const statusLabels: Readonly<Record<string, string>> = {
  busy: 'Busy: no action was taken',
  already_handled: 'Already handled: no new action was taken',
  closed: 'Report closed',
  acknowledged: 'Acknowledged',
  case_exists: 'A case already exists: no new case was opened',
  missing_target: 'Target unavailable: no case was opened',
  missing_detection: 'Detection unavailable: no case was opened',
  opener_unavailable: 'Case opening unavailable',
};
function words(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}
function status(value: string): string {
  return Object.prototype.hasOwnProperty.call(statusLabels, value)
    ? statusLabels[value]
    : words(value);
}
/** Plain text only, from the shared public projection. Renderers must escape for their surface.
 * Deliberately select outcome fields; never serialize a domain record or exception. */
export function presentApprovalResult(result: PublicActionResult): readonly string[] {
  const lines = [result.code === 'cancelled' ? 'Confirmation cancelled' : `Action ${result.state}`];
  if (result.executionId) lines.push(`Execution: ${result.executionId}`);
  if (result.code && result.code !== 'cancelled') lines.push(`Code: ${result.code}`);
  const outcome = result.outcome;
  if (outcome?.status) lines.push(status(outcome.status));
  if (outcome?.queueCleanupStatus) lines.push(`Queue cleanup ${words(outcome.queueCleanupStatus)}`);
  if (outcome?.succeeded !== undefined)
    lines.push(`Succeeded: ${outcome.succeeded ? 'yes' : 'no'}`);
  if (outcome?.count !== undefined) lines.push(`Count: ${outcome.count}`);
  for (const [key, value] of Object.entries(outcome?.details ?? {})) {
    const label = words(key);
    lines.push(
      `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${value === null ? 'none' : value}`
    );
  }
  for (const item of outcome?.items ?? []) {
    lines.push(
      `Item ${item.itemId}: ${item.state}${item.status ? ` — ${status(item.status)}` : ''}`
    );
  }
  if (result.state === 'uncertain' || outcome?.items?.some((item) => item.state === 'uncertain'))
    lines.push(
      'The outcome is uncertain. Keep this execution reference and check its status before starting another action.'
    );
  return lines;
}
