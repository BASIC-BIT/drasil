import { readFileSync } from 'fs';
import { join } from 'path';
import OpenAI from 'openai';
import { GPTService } from '../../services/GPTService';
import { sourceRef, associatedOutput } from '../fixtures/report-intake/source-associated';

const imageRef = { ...sourceRef, kind: 'image' as const };
const png = (): Buffer =>
  readFileSync(join(__dirname, '../fixtures/report-intake/clean-match.png'));
function fixture(output: unknown = associatedOutput()) {
  const create = jest.fn().mockResolvedValue({
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }],
      },
    ],
  });
  return { create, service: new GPTService({ responses: { create } } as unknown as OpenAI) };
}
describe('trusted report extraction fixture entry', () => {
  it('uses the shared bounded extraction for a local PNG and preserves source association', async () => {
    const output = associatedOutput();
    for (const item of [...output.subjects, ...output.contextLabels]) item.sourceRefs = [imageRef];
    const f = fixture(output);
    const result = await f.service.extractReportIdentityFixture({
      ref: imageRef,
      png: png(),
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ kind: 'extracted', includedEvidenceIds: [imageRef.evidenceId] });
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.create.mock.calls[0][0]).toMatchObject({
      max_output_tokens: 4096,
      store: false,
      input: [
        {
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'input_image',
              image_url: expect.stringMatching(/^data:image\/png;base64,/),
            }),
          ]),
        },
      ],
    });
    expect(f.create.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
  });
  it.each(['bad signature', 'too large', 'wrong ref'])(
    'rejects %s before dispatch',
    async (kind) => {
      const f = fixture();
      const bytes =
        kind === 'too large'
          ? Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(20 * 1024 * 1024)])
          : Buffer.from('not a PNG');
      await expect(
        f.service.extractReportIdentityFixture({
          ref: kind === 'wrong ref' ? sourceRef : imageRef,
          png: bytes,
          signal: new AbortController().signal,
        })
      ).rejects.toThrow();
      expect(f.create).not.toHaveBeenCalled();
    }
  );
  it('retains shared response validation', async () => {
    const f = fixture(associatedOutput());
    expect(
      await f.service.extractReportIdentityFixture({
        ref: imageRef,
        png: png(),
        signal: new AbortController().signal,
      })
    ).toMatchObject({ kind: 'failed', reason: 'invalid_output' });
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it.each(['data:image/png;base64,AAAA', 'https://example.invalid/fixture.png'])(
    'keeps live URL rejection for %s',
    async (url) => {
      const f = fixture();
      expect(
        await f.service.extractReportIdentity({
          sources: [
            {
              ref: imageRef,
              content: {
                kind: 'image',
                url,
                attachmentId: 'fixture',
                contentType: 'image/png',
                size: 100,
              },
            },
          ],
          signal: new AbortController().signal,
        })
      ).toMatchObject({ kind: 'failed', reason: 'evidence_unavailable' });
      expect(f.create).not.toHaveBeenCalled();
    }
  );
});
