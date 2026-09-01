export const ADMIN_ACTION_CUSTOM_ID_PREFIX = 'admin_actions';
const DISCORD_CUSTOM_ID_MAX_LENGTH = 100;

export type AdminActionSurface = 'case' | 'observed';

const SURFACE_TO_CODE: Record<AdminActionSurface, string> = {
  case: 'c',
  observed: 'o',
};
const CODE_TO_SURFACE: Record<string, AdminActionSurface> = {
  c: 'case',
  o: 'observed',
};

const ACTION_TO_CODE: Record<string, string> = {
  menu: 'm',
  history: 'h',
  ban: 'b',
  kick: 'k',
  observed_ban: 'ob',
  observed_kick: 'ok',
  verify: 'v',
  quarantine: 'q',
  restrict_user: 'ru',
  lift_restriction: 'lr',
  close_no_action: 'cna',
  thread: 't',
  repair: 'rp',
  sync_ban: 'sb',
  reopen: 'ro',
  captcha: 'cp',
  captcha_retry: 'cpr',
  captcha_bypass: 'cpb',
  observed_open: 'oo',
  observed_close_report: 'ocr',
  observed_dismiss: 'od',
  observed_false_positive: 'ofp',
  observed_undo_dismiss: 'oud',
  confirm_verify: 'cv',
  confirm_quarantine: 'cq',
  confirm_restrict_user: 'cru',
  confirm_lift_restriction: 'clr',
  confirm_close_no_action: 'ccna',
  confirm_thread: 'ct',
  confirm_repair: 'crp',
  confirm_sync_ban: 'csb',
  confirm_kick: 'ck',
  confirm_reopen: 'cro',
  confirm_captcha: 'ccp',
  confirm_captcha_retry: 'ccpr',
  confirm_observed_open: 'coo',
  confirm_observed_close_report: 'cocr',
  confirm_observed_kick: 'cok',
  confirm_observed_dismiss: 'cod',
  confirm_observed_false_positive: 'cofp',
  confirm_observed_undo_dismiss: 'coud',
  cancel: 'x',
};
const CODE_TO_ACTION = Object.fromEntries(
  Object.entries(ACTION_TO_CODE).map(([action, code]) => [code, action])
) as Record<string, string>;

function assertCustomIdLength(customId: string): string {
  if (customId.length > DISCORD_CUSTOM_ID_MAX_LENGTH) {
    throw new Error(
      `Admin action custom_id exceeds Discord's ${DISCORD_CUSTOM_ID_MAX_LENGTH}-character limit.`
    );
  }

  return customId;
}

function parseSurface(value: string): AdminActionSurface | null {
  if (value === 'c' || value === 'case') {
    return 'case';
  }
  if (value === 'o' || value === 'observed') {
    return 'observed';
  }

  return null;
}

export function buildCaseAdminActionsCustomId(userId: string): string {
  return buildAdminActionCustomId('menu', 'case', userId);
}

export function buildObservedAdminActionsCustomId(
  userId: string,
  detectionEventId: string
): string {
  return buildAdminActionCustomId('menu', 'observed', userId, detectionEventId);
}

export function buildAdminActionCustomId(
  action: string,
  surface: AdminActionSurface,
  userId: string,
  detectionEventId?: string,
  verificationEventId?: string,
  confirmationFingerprint?: string,
  captchaChallengeId?: string,
  captchaGeneration?: number
): string {
  const isCaptchaRetry = action === 'captcha_retry' || action === 'confirm_captcha_retry';
  if (
    isCaptchaRetry &&
    (!captchaChallengeId || !Number.isInteger(captchaGeneration) || (captchaGeneration ?? 0) < 1)
  ) {
    throw new Error('CAPTCHA retry custom IDs require a challenge ID and generation.');
  }
  const optionalParts = isCaptchaRetry
    ? [captchaChallengeId as string, String(captchaGeneration)]
    : confirmationFingerprint
      ? [detectionEventId ?? '_', verificationEventId ?? '_', confirmationFingerprint]
      : verificationEventId
        ? [detectionEventId ?? '_', verificationEventId]
        : detectionEventId
          ? [detectionEventId]
          : [];
  return assertCustomIdLength(
    [
      ADMIN_ACTION_CUSTOM_ID_PREFIX,
      ACTION_TO_CODE[action] ?? action,
      SURFACE_TO_CODE[surface],
      userId,
      ...optionalParts,
    ].join(':')
  );
}

export interface ParsedAdminActionCustomId {
  readonly action: string;
  readonly surface: AdminActionSurface;
  readonly userId: string;
  readonly detectionEventId?: string;
  readonly verificationEventId?: string;
  readonly confirmationFingerprint?: string;
  readonly captchaChallengeId?: string;
  readonly captchaGeneration?: number;
}

export function parseAdminActionCustomId(customId: string): ParsedAdminActionCustomId | null {
  const [
    prefix,
    actionCode,
    surfaceCode,
    userId,
    detectionEventId,
    verificationEventId,
    confirmationFingerprint,
  ] = customId.split(':');
  if (prefix !== ADMIN_ACTION_CUSTOM_ID_PREFIX || !actionCode || !surfaceCode || !userId) {
    return null;
  }
  const action = CODE_TO_ACTION[actionCode] ?? actionCode;
  const surface = parseSurface(CODE_TO_SURFACE[surfaceCode] ?? surfaceCode);
  if (!surface) {
    return null;
  }

  if (action === 'captcha_retry' || action === 'confirm_captcha_retry') {
    const captchaGeneration = Number(verificationEventId);
    if (
      !detectionEventId ||
      !Number.isInteger(captchaGeneration) ||
      captchaGeneration < 1 ||
      confirmationFingerprint
    ) {
      return null;
    }
    return {
      action,
      surface,
      userId,
      captchaChallengeId: detectionEventId,
      captchaGeneration,
    };
  }

  return {
    action,
    surface,
    userId,
    ...(detectionEventId && detectionEventId !== '_' ? { detectionEventId } : {}),
    ...(verificationEventId && verificationEventId !== '_' ? { verificationEventId } : {}),
    ...(confirmationFingerprint ? { confirmationFingerprint } : {}),
  };
}
