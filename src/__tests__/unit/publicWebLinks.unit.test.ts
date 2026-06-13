import {
  buildAdminCaseDetailUrl,
  buildAdminCaseQueueUrl,
  buildAdminGuildSetupUrl,
  getPublicWebBaseUrl,
} from '../../utils/publicWebLinks';

describe('publicWebLinks', () => {
  const originalDrasilWebPublicUrl = process.env.DRASIL_WEB_PUBLIC_URL;
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    if (originalDrasilWebPublicUrl === undefined) {
      delete process.env.DRASIL_WEB_PUBLIC_URL;
    } else {
      process.env.DRASIL_WEB_PUBLIC_URL = originalDrasilWebPublicUrl;
    }

    if (originalNextPublicAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
    }
  });

  it('returns null when no valid public web URL is configured', () => {
    delete process.env.DRASIL_WEB_PUBLIC_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'ftp://example.com';

    expect(getPublicWebBaseUrl()).toBeNull();
    expect(buildAdminCaseQueueUrl('guild-1')).toBeNull();
  });

  it('builds admin routes from the bot-side public web URL', () => {
    process.env.DRASIL_WEB_PUBLIC_URL = 'https://drasilbot.com///';
    process.env.NEXT_PUBLIC_APP_URL = 'https://ignored.example';

    expect(getPublicWebBaseUrl()).toBe('https://drasilbot.com');
    expect(buildAdminGuildSetupUrl('guild-1')).toBe(
      'https://drasilbot.com/admin/guild/guild-1/setup'
    );
    expect(buildAdminCaseQueueUrl('guild-1')).toBe(
      'https://drasilbot.com/admin/guild/guild-1/cases'
    );
    expect(buildAdminCaseDetailUrl('guild-1', 'case-1')).toBe(
      'https://drasilbot.com/admin/guild/guild-1/cases/case-1'
    );
  });
});
