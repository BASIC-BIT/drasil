const PUBLIC_WEB_URL_ENV_NAMES = ['DRASIL_WEB_PUBLIC_URL', 'NEXT_PUBLIC_APP_URL'] as const;

function normalizePublicWebUrl(value: string): string | null {
  try {
    const url = new URL(value.trim().replace(/\/+$/, ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function getPublicWebBaseUrl(): string | null {
  for (const envName of PUBLIC_WEB_URL_ENV_NAMES) {
    const value = process.env[envName];
    if (!value?.trim()) {
      continue;
    }

    const normalized = normalizePublicWebUrl(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function buildPublicWebUrl(path: string): string | null {
  const baseUrl = getPublicWebBaseUrl();
  if (!baseUrl) {
    return null;
  }

  return new URL(path, `${baseUrl}/`).toString();
}

export function buildAdminGuildSetupUrl(guildId: string): string | null {
  return buildPublicWebUrl(`/admin/guild/${encodeURIComponent(guildId)}/setup`);
}

export function buildAdminCaseQueueUrl(guildId: string): string | null {
  return buildPublicWebUrl(`/admin/guild/${encodeURIComponent(guildId)}/cases`);
}

export function buildAdminModerationInboxUrl(guildId: string): string | null {
  return buildPublicWebUrl(`/admin/guild/${encodeURIComponent(guildId)}/inbox`);
}

export function buildAdminCaseDetailUrl(guildId: string, caseId: string): string | null {
  return buildPublicWebUrl(
    `/admin/guild/${encodeURIComponent(guildId)}/cases/${encodeURIComponent(caseId)}`
  );
}
