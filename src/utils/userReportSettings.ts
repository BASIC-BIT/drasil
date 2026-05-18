import { ServerSettings } from '../repositories/types';

export const USER_REPORT_REASON_REQUIRED_SETTING_KEY = 'user_report_reason_required';
export const DEFAULT_USER_REPORT_REASON_REQUIRED = false;
export const USER_REPORT_REASON_MAX_LENGTH = 900;

export interface UserReportSettings {
  reasonRequired: boolean;
}

export function getUserReportSettings(settings: ServerSettings = {}): UserReportSettings {
  return {
    reasonRequired:
      settings[USER_REPORT_REASON_REQUIRED_SETTING_KEY] ?? DEFAULT_USER_REPORT_REASON_REQUIRED,
  };
}
