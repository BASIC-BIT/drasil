/**
 * Utility functions for suppressing console output during tests
 */

// Store original console methods
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

// Track which methods are currently silenced
const silencedMethods: Record<string, boolean> = {
  log: false,
  error: false,
  warn: false,
  info: false,
};

/**
 * Silences all console methods or just the specified ones
 * @param methods Optional array of methods to silence ('log', 'error', 'warn', 'info')
 */
export function silenceConsole(methods?: Array<'log' | 'error' | 'warn' | 'info'>): void {
  const methodsToSilence = methods || ['error', 'warn'];

  methodsToSilence.forEach((method) => {
    console[method] = jest.fn();
    silencedMethods[method] = true;
  });
}

/**
 * Restores all console methods or just the specified ones
 * @param methods Optional array of methods to restore ('log', 'error', 'warn', 'info')
 */
export function restoreConsole(methods?: Array<'log' | 'error' | 'warn' | 'info'>): void {
  const methodsToRestore = methods || ['error', 'warn', 'log', 'info'];

  methodsToRestore.forEach((method) => {
    console[method] = originalConsole[method];
    silencedMethods[method] = false;
  });
}

/**
 * Jest setup to silence and restore console for each test
 * Import this in your Jest setup file or at the top of test files
 * @param methods Optional array of methods to silence
 */
export function setupConsoleMocking(methods?: Array<'log' | 'error' | 'warn' | 'info'>): void {
  beforeAll(() => silenceConsole(methods));
  afterAll(() => restoreConsole(methods));
}

/**
 * Temporarily enables console output for a specific test
 * Useful for debugging a specific test case
 * @example
 * ```
 * it('should do something', withConsoleOutput(() => {
 *   // Test code with console output enabled
 * }));
 * ```
 */
export function withConsoleOutput<T>(
  testFn: () => T | Promise<T>,
  methods?: Array<'log' | 'error' | 'warn' | 'info'>
): () => Promise<T> {
  return async () => {
    const methodsToRestore =
      methods ||
      (Object.keys(silencedMethods).filter(
        (method) => silencedMethods[method as keyof typeof silencedMethods]
      ) as Array<'log' | 'error' | 'warn' | 'info'>);

    // Restore console methods temporarily
    methodsToRestore.forEach((method) => {
      console[method] = originalConsole[method];
    });

    try {
      // Run the test
      return await testFn();
    } finally {
      // Re-silence console methods
      methodsToRestore.forEach((method) => {
        if (silencedMethods[method]) {
          console[method] = jest.fn();
        }
      });
    }
  };
}
