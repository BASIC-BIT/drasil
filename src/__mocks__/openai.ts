'use strict';

// Create a mockCreate function to be used in tests
const mockCreate = jest.fn();

// Create the structure to match OpenAI's client
const mockOpenAIInstance = {
  chat: {
    completions: {
      create: mockCreate,
    },
  },
};

// Mock constructor that returns the instance
class MockOpenAI {
  constructor() {
    return mockOpenAIInstance;
  }
}

// Export the mock class as default
export default MockOpenAI;

// Export mockCreate for tests to access
export const __mockCreate = mockCreate;
