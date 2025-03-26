/**
 * Jest setup file
 * 
 * This file runs before all tests and sets up global test environment
 * 
 * By default, console.error and console.warn are silenced during tests
 * to reduce clutter in the test output. Expected errors are intentionally
 * hidden to make test output more readable.
 * 
 * To temporarily re-enable console output for a specific test:
 * 
 * ```typescript
 * import { withConsoleOutput } from './utils/console-mocks';
 * 
 * it('should show console output for debugging', withConsoleOutput(() => {
 *   // Test code with console output enabled
 *   console.error('This error will be visible in test output');
 * }));
 * ```
 */

import { silenceConsole } from './utils/console-mocks';

// By default, silence console.error and console.warn during tests
// This prevents expected errors from cluttering the test output
silenceConsole(['error', 'warn']);

// You can also add other global test setup here
// For example, mocking global browser APIs if needed 