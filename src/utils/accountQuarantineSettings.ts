import { ServerSettings } from '../repositories/types';

export const ACCOUNT_QUARANTINE_ENABLED_SETTING_KEY = 'account_quarantine_enabled';

export interface AccountQuarantineSettings {
  readonly enabled: boolean;
}

export function getAccountQuarantineSettings(
  settings: ServerSettings | undefined
): AccountQuarantineSettings {
  return {
    enabled: settings?.[ACCOUNT_QUARANTINE_ENABLED_SETTING_KEY] === true,
  };
}
