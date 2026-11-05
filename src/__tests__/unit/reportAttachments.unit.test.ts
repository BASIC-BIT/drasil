import { sourceRef } from '../fixtures/report-intake/source-associated';
import { Collection, Message } from 'discord.js';
import {
  buildSpoilerImageAttachmentFileResult,
  buildSpoilerImageAttachmentFiles,
  messageAttachmentsToReportMetadata,
  selectEligibleMessageReportImageAttachments,
  toSpoilerFilename,
  prepareReportEvidenceSource,
} from '../../utils/reportAttachments';
import { getReportAiSettings } from '../../utils/reportAiSettings';

describe('reportAttachments (unit)', () => {
  it('prepares only the original authorized message and attachment within configured limits', () => {
    const message = {
      id: sourceRef.messageId,
      content: 'Target Alder',
      attachments: new Collection([
        [
          'attachment',
          {
            id: 'attachment',
            contentType: 'image/png',
            size: 100,
            url: 'https://cdn.discordapp.com/attachments/channel/attachment/proof.png',
          },
        ],
      ]),
    };
    const ref = { ...sourceRef, kind: 'image' as const };
    const settings = getReportAiSettings({ report_ai_max_image_bytes: 200 });
    expect(
      prepareReportEvidenceSource({ message, ref, attachmentId: 'attachment', settings })
    ).toEqual({
      ref,
      content: {
        kind: 'image',
        attachmentId: 'attachment',
        contentType: 'image/png',
        size: 100,
        url: 'https://cdn.discordapp.com/attachments/channel/attachment/proof.png',
      },
    });
    expect(prepareReportEvidenceSource({ message, ref: sourceRef, settings })).toEqual({
      ref: sourceRef,
      content: { kind: 'text', text: 'Target Alder' },
    });
    for (const input of [
      { message: { ...message, id: 'other' }, ref, attachmentId: 'attachment', settings },
      { message, ref, attachmentId: 'different', settings },
      {
        message,
        ref,
        attachmentId: 'attachment',
        settings: getReportAiSettings({ report_ai_max_image_bytes: 50 }),
      },
      {
        message,
        ref,
        attachmentId: 'attachment',
        settings: getReportAiSettings({ report_ai_analyze_images: false }),
      },
    ])
      expect(prepareReportEvidenceSource(input).content.kind).toBe('unavailable');
  });

  it.each([
    [
      'expired',
      'image/png',
      'https://cdn.discordapp.com/attachments/channel/attachment/proof.png?ex=00000001',
    ],
    [
      'unsupported',
      'application/zip',
      'https://cdn.discordapp.com/attachments/channel/attachment/proof.png',
    ],
    [
      'untrusted host',
      'image/png',
      'https://example.test/attachments/channel/attachment/proof.png',
    ],
    [
      'mismatched URL attachment',
      'image/png',
      'https://cdn.discordapp.com/attachments/channel/other/proof.png',
    ],
  ])('excludes %s image metadata without fetching it', (_name, contentType, url) => {
    const message = {
      id: sourceRef.messageId,
      attachments: new Collection([
        ['attachment', { id: 'attachment', url, contentType, size: 100 }],
      ]),
    };
    const result = prepareReportEvidenceSource({
      message,
      ref: { ...sourceRef, kind: 'image' },
      attachmentId: 'attachment',
      settings: getReportAiSettings(),
    });
    expect(result.content.kind).toBe('unavailable');
  });

  it('distinguishes deliberately excluded evidence from an unavailable original source', () => {
    const ref = { ...sourceRef, kind: 'image' as const };
    const image = {
      id: 'attachment',
      contentType: 'image/png',
      size: 100,
      url: 'https://cdn.discordapp.com/attachments/channel/attachment/proof.png',
    };
    const settings = getReportAiSettings();
    const message = {
      id: sourceRef.messageId,
      attachments: new Collection([['attachment', image]]),
    };
    expect(
      prepareReportEvidenceSource({ message, ref, attachmentId: 'missing', settings }).content
    ).toEqual({ kind: 'unavailable', reason: 'evidence_unavailable' });
    expect(
      prepareReportEvidenceSource({
        message,
        ref,
        attachmentId: 'attachment',
        settings: getReportAiSettings({ report_ai_analyze_images: false }),
      }).content
    ).toEqual({ kind: 'unavailable', reason: 'excluded' });
    const expired = {
      ...message,
      attachments: new Collection([['attachment', { ...image, url: image.url + '?ex=00000001' }]]),
    };
    expect(
      prepareReportEvidenceSource({ message: expired, ref, attachmentId: 'attachment', settings })
        .content
    ).toEqual({ kind: 'unavailable', reason: 'evidence_unavailable' });
  });

  it('classifies an otherwise eligible original image without a URL as unavailable', () => {
    const message = {
      id: sourceRef.messageId,
      attachments: new Collection([
        ['attachment', { id: 'attachment', contentType: 'image/png', size: 100 }],
      ]),
    };
    expect(
      prepareReportEvidenceSource({
        message,
        ref: { ...sourceRef, kind: 'image' },
        attachmentId: 'attachment',
        settings: getReportAiSettings(),
      }).content
    ).toEqual({ kind: 'unavailable', reason: 'evidence_unavailable' });
  });

  it('keeps deliberate settings, unsupported-type and byte-budget exclusions ahead of missing metadata', () => {
    const ref = { ...sourceRef, kind: 'image' as const };
    const image = { id: 'attachment', contentType: 'image/png', size: 100 };
    for (const [attachment, settings] of [
      [image, getReportAiSettings({ report_ai_analyze_images: false })],
      [image, getReportAiSettings({ report_ai_max_images: 0 })],
      [{ ...image, contentType: 'application/zip' }, getReportAiSettings()],
      [image, getReportAiSettings({ report_ai_max_image_bytes: 50 })],
    ] as const) {
      const message = {
        id: sourceRef.messageId,
        attachments: new Collection([['attachment', attachment]]),
      };
      expect(
        prepareReportEvidenceSource({ message, ref, attachmentId: 'attachment', settings }).content
      ).toEqual({ kind: 'unavailable', reason: 'excluded' });
    }
  });

  it('maps Discord message attachments to report metadata', () => {
    const message = buildMessageWithAttachments([
      [
        'attachment-1',
        {
          id: 'attachment-1',
          name: 'proof.png',
          url: 'https://cdn.discordapp.com/proof.png',
          proxyURL: 'https://media.discordapp.net/proof.png',
          contentType: null,
          size: 1234,
        },
      ],
    ]);

    expect(messageAttachmentsToReportMetadata(message)).toEqual([
      {
        id: 'attachment-1',
        name: 'proof.png',
        url: 'https://cdn.discordapp.com/proof.png',
        proxyUrl: 'https://media.discordapp.net/proof.png',
        contentType: undefined,
        size: 1234,
      },
    ]);
  });

  it('selects eligible image attachments from a Discord message', () => {
    const message = buildMessageWithAttachments([
      [
        'image-1',
        {
          id: 'image-1',
          name: 'proof.png',
          url: 'https://cdn.discordapp.com/proof.png',
          contentType: 'image/png',
          size: 999,
        },
      ],
      [
        'archive-1',
        {
          id: 'archive-1',
          name: 'logs.zip',
          url: 'https://cdn.discordapp.com/logs.zip',
          contentType: 'application/zip',
          size: 999,
        },
      ],
    ]);

    expect(
      selectEligibleMessageReportImageAttachments(
        message,
        getReportAiSettings({ report_ai_max_images: 1 })
      )
    ).toEqual([
      expect.objectContaining({
        id: 'image-1',
        name: 'proof.png',
      }),
    ]);
  });

  it('copies fetched images into spoilered Discord file payloads', async () => {
    const imageBytes = Uint8Array.from([4, 5, 6]);
    const fetchImage = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn().mockResolvedValue(imageBytes.buffer),
    });

    const result = await buildSpoilerImageAttachmentFileResult(
      [
        {
          id: 'image-1',
          name: 'proof:image.png',
          url: 'https://cdn.discordapp.com/proof.png',
          proxyUrl: 'https://media.discordapp.net/proof.png',
        },
      ],
      { fetchImage }
    );

    expect(fetchImage).toHaveBeenCalledWith('https://media.discordapp.net/proof.png');
    expect(result.files).toEqual([
      { attachment: Buffer.from(imageBytes), name: 'SPOILER_proof_image.png' },
    ]);
    expect([...result.copiedAttachmentIds]).toEqual(['image-1']);
  });

  it('skips failed image copies without adding copied ids', async () => {
    const fetchImage = jest.fn().mockResolvedValue({ ok: false, arrayBuffer: jest.fn() });

    const result = await buildSpoilerImageAttachmentFileResult(
      [
        {
          id: 'image-1',
          name: 'proof.png',
          url: 'https://cdn.discordapp.com/proof.png',
        },
      ],
      { fetchImage }
    );

    expect(result.files).toEqual([]);
    expect([...result.copiedAttachmentIds]).toEqual([]);
  });

  it('keeps the simple file helper compatible with existing callers', async () => {
    const imageBytes = Uint8Array.from([7]);
    const fetchImage = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn().mockResolvedValue(imageBytes.buffer),
    });

    await expect(
      buildSpoilerImageAttachmentFiles(
        [{ id: 'image-1', name: 'proof.png', url: 'https://cdn.discordapp.com/proof.png' }],
        { fetchImage }
      )
    ).resolves.toEqual([{ attachment: Buffer.from(imageBytes), name: 'SPOILER_proof.png' }]);
  });

  it('normalizes spoiler filenames', () => {
    expect(toSpoilerFilename('receipt:image?.png')).toBe('SPOILER_receipt_image_.png');
    expect(toSpoilerFilename('SPOILER_receipt.png')).toBe('SPOILER_receipt.png');
    expect(toSpoilerFilename('   ')).toBe('SPOILER_image');
  });
});

function buildMessageWithAttachments(entries: [string, unknown][]): Pick<Message, 'attachments'> {
  return {
    attachments: new Collection<string, unknown>(entries) as unknown as Message['attachments'],
  };
}
