/**
 * Example usage of console mocking utilities
 * 
 * This file demonstrates how to use the console mocking utilities
 * for selective error display in tests.
 */

import { withConsoleOutput } from './console-mocks';

describe('Console mocking example', () => {
  /**
   * Example function that generates errors we want to see in certain tests
   */
  function throwError(message: string): never {
    console.error(`Error: ${message}`);
    throw new Error(message);
  }

  // This test suppresses console.error output (default behavior)
  test('errors are normally suppressed', () => {
    // Expected error
    try {
      throwError('This error message should be suppressed');
      fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeDefined();
      // The error was thrown but console.error output was suppressed
    }
  });

  // This test intentionally shows console.error output
  test(
    'errors can be selectively displayed',
    withConsoleOutput(() => {
      // Expected error with visible console output
      try {
        throwError('This error message SHOULD BE VISIBLE in the test output');
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
        // The error was thrown and console.error output was shown
      }
    })
  );

  // This test goes back to suppressing console errors
  test('errors are suppressed again', () => {
    // Expected error
    try {
      throwError('This error message should be suppressed again');
      fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeDefined();
      // The error was thrown but console.error output was suppressed
    }
  });
}); 