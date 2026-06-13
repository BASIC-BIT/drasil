import { Collection, Message } from 'discord.js';
import {
  buildSpoilerImageAttachmentFileResult,
  buildSpoilerImageAttachmentFiles,
  messageAttachmentsToReportMetadata,
  selectEligibleMessageReportImageAttachments,
  toSpoilerFilename,
} from '../../utils/reportAttachments';
import { getReportAiSettings } from '../../utils/reportAiSettings';

describe('reportAttachments (unit)', () => {
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
