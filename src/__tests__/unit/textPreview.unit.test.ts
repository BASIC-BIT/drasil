import { truncatePreview } from '../../utils/textPreview';

describe('truncatePreview', () => {
  it('keeps the complete value when it fits', () => {
    expect(truncatePreview('complete', 8)).toBe('complete');
  });

  it('keeps the truncated value within the requested maximum', () => {
    const result = truncatePreview('a'.repeat(100), 40);

    expect(result).toHaveLength(40);
    expect(result.endsWith('\n... (truncated to fit)')).toBe(true);
  });
});
