import {
  getReportAiSettings,
  selectEligibleReportImageAttachments,
} from '../../utils/reportAiSettings';

describe('reportAiSettings (unit)', () => {
  it('defaults report AI to enabled hints mode', () => {
    expect(getReportAiSettings({})).toEqual(
      expect.objectContaining({
        enabled: true,
        analyzeText: true,
        analyzeImages: true,
        maxAction: 'hints',
        maxImages: 4,
        maxImageBytes: 10 * 1024 * 1024,
      })
    );
  });

  it('falls back for old restrict max action values', () => {
    expect(getReportAiSettings({ report_ai_max_action: 'restrict' } as any).maxAction).toBe(
      'hints'
    );
  });

  it('selects only eligible capped image attachments', () => {
    const settings = getReportAiSettings({
      report_ai_triage_enabled: true,
      report_ai_max_images: 1,
      report_ai_max_image_bytes: 1000,
    });

    expect(
      selectEligibleReportImageAttachments(
        [
          {
            id: 'image-1',
            url: 'https://cdn.discordapp.com/image.png',
            contentType: 'image/png',
            size: 999,
          },
          {
            id: 'image-2',
            url: 'https://cdn.discordapp.com/image-2.png',
            contentType: 'image/png',
            size: 999,
          },
          {
            id: 'large-image',
            url: 'https://cdn.discordapp.com/large.png',
            contentType: 'image/png',
            size: 2000,
          },
          {
            id: 'archive',
            url: 'https://cdn.discordapp.com/file.zip',
            contentType: 'application/zip',
            size: 100,
          },
        ],
        settings
      )
    ).toEqual([
      {
        id: 'image-1',
        url: 'https://cdn.discordapp.com/image.png',
        contentType: 'image/png',
        size: 999,
      },
    ]);
  });
});
