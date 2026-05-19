import { ServerSettings } from '../repositories/types';

export const USER_REPORT_REASON_REQUIRED_SETTING_KEY = 'user_report_reason_required';
export const USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY = 'user_report_external_response_mode';
export const DEFAULT_USER_REPORT_REASON_REQUIRED = false;
export const DEFAULT_USER_REPORT_EXTERNAL_RESPONSE_MODE: UserReportExternalResponseMode = 'off';
export const USER_REPORT_REASON_MAX_LENGTH = 900;
export const USER_REPORT_MESSAGE_CONTENT_MAX_LENGTH = 1500;
export const REPORT_MESSAGE_MODAL_PREFIX = 'rmm';
export const REPORT_MESSAGE_REASON_FIELD_ID = 'report_message_reason';

export const USER_REPORT_EXTERNAL_RESPONSE_MODES = ['off', 'notify_only', 'open_case'] as const;
export type UserReportExternalResponseMode = (typeof USER_REPORT_EXTERNAL_RESPONSE_MODES)[number];

export interface UserReportSettings {
  reasonRequired: boolean;
  externalResponseMode: UserReportExternalResponseMode;
}

export function isUserReportExternalResponseMode(
  value: string
): value is UserReportExternalResponseMode {
  return USER_REPORT_EXTERNAL_RESPONSE_MODES.includes(value as UserReportExternalResponseMode);
}

export function getUserReportSettings(settings: ServerSettings = {}): UserReportSettings {
  const externalResponseMode = settings[USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY];

  return {
    reasonRequired:
      settings[USER_REPORT_REASON_REQUIRED_SETTING_KEY] ?? DEFAULT_USER_REPORT_REASON_REQUIRED,
    externalResponseMode:
      typeof externalResponseMode === 'string' &&
      isUserReportExternalResponseMode(externalResponseMode)
        ? externalResponseMode
        : DEFAULT_USER_REPORT_EXTERNAL_RESPONSE_MODE,
  };
}
