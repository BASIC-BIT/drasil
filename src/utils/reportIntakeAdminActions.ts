export const REPORT_INTAKE_ADMIN_ACTION_CUSTOM_ID_PREFIX = 'report_intake_admin';

const DISCORD_CUSTOM_ID_MAX_LENGTH = 100;

const ACTION_TO_CODE = {
  menu: 'm',
  close: 'c',
  confirm_close: 'cc',
  cancel: 'x',
} as const;

const CODE_TO_ACTION = Object.fromEntries(
  Object.entries(ACTION_TO_CODE).map(([action, code]) => [code, action])
) as Partial<Record<string, ReportIntakeAdminAction>>;

export type ReportIntakeAdminAction = keyof typeof ACTION_TO_CODE;

export interface ParsedReportIntakeAdminActionCustomId {
  readonly action: ReportIntakeAdminAction;
  readonly intakeId: string;
}

export function buildReportIntakeAdminActionsCustomId(intakeId: string): string {
  return buildReportIntakeAdminActionCustomId('menu', intakeId);
}

export function buildReportIntakeAdminCloseCustomId(intakeId: string): string {
  return buildReportIntakeAdminActionCustomId('close', intakeId);
}

export function buildReportIntakeAdminConfirmCloseCustomId(intakeId: string): string {
  return buildReportIntakeAdminActionCustomId('confirm_close', intakeId);
}

export function buildReportIntakeAdminCancelCustomId(intakeId: string): string {
  return buildReportIntakeAdminActionCustomId('cancel', intakeId);
}

export function isReportIntakeAdminActionCustomId(customId: string): boolean {
  return customId.startsWith(`${REPORT_INTAKE_ADMIN_ACTION_CUSTOM_ID_PREFIX}:`);
}

export function parseReportIntakeAdminActionCustomId(
  customId: string
): ParsedReportIntakeAdminActionCustomId | null {
  const [prefix, actionCode, intakeId] = customId.split(':');
  if (prefix !== REPORT_INTAKE_ADMIN_ACTION_CUSTOM_ID_PREFIX || !actionCode || !intakeId) {
    return null;
  }

  const action = CODE_TO_ACTION[actionCode] ?? parseLegacyAction(actionCode);
  if (!action) {
    return null;
  }

  return { action, intakeId };
}

function buildReportIntakeAdminActionCustomId(
  action: ReportIntakeAdminAction,
  intakeId: string
): string {
  return assertCustomIdLength(
    [REPORT_INTAKE_ADMIN_ACTION_CUSTOM_ID_PREFIX, ACTION_TO_CODE[action], intakeId].join(':')
  );
}

function parseLegacyAction(action: string): ReportIntakeAdminAction | null {
  return action in ACTION_TO_CODE ? (action as ReportIntakeAdminAction) : null;
}

function assertCustomIdLength(customId: string): string {
  if (customId.length > DISCORD_CUSTOM_ID_MAX_LENGTH) {
    throw new Error(
      `Report intake admin custom_id exceeds Discord's ${DISCORD_CUSTOM_ID_MAX_LENGTH}-character limit.`
    );
  }

  return customId;
}
