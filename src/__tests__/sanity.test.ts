// Mock index.ts to prevent it from running
jest.mock('../index.ts', () => {}, { virtual: true });

describe('Sanity Check', () => {
  it('should pass basic assertion', () => {
    expect(true).toBe(true);
  });
});
