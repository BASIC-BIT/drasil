# Discord Anti-Spam Bot: Testing Best Practices

## Mocking Strategy for Complex Libraries

Based on our experience debugging and fixing tests in the project, we've established the following best practices for mocking complex npm libraries like discord.js:

### 1. Function-Based Mocks vs. Class-Based Mocks

**Recommended Approach:**

- Use Jest's `mockImplementation()` for creating function-based mocks
- Return plain objects with the necessary properties and methods
- Avoid using ES6 classes for mocks when possible

**Example:**

```javascript
const MockClient = jest.fn().mockImplementation(() => ({
  guilds: {
    cache: new Map(),
    fetch: jest.fn(),
  },
  on: jest.fn().mockReturnThis(),
  login: jest.fn().mockResolvedValue('token'),
  destroy: jest.fn().mockResolvedValue(undefined),
}));
```

### 2. Null-Safe Property Access

**Recommended Approach:**

- Use optional chaining (`?.`) and nullish coalescing (`??`) in mock implementations
- Check for undefined values before accessing properties
- Provide default values for all properties

**Example:**

```javascript
this.handleMessage = jest.fn().mockImplementation(async (message) => {
  // Safely access properties with null checks
  const content = message?.content;
  const isBot = message?.author?.bot;

  // Rest of implementation with null checks
});
```

### 3. Type Assertions for Private Members

**Recommended Approach:**

- Use type assertions (`as any`) carefully when accessing private members
- Create dedicated mock classes that expose private members for testing
- Document the use of type assertions for clarity

**Example:**

```typescript
// In test file
const bot = new Bot() as any;
await (bot as any).handleMessage(mockMessage);

// Or better, create a dedicated mock:
// src/__mocks__/Bot.ts that exposes private methods
```

### 4. Direct Mock Imports

**Recommended Approach:**

- Use `jest.requireActual()` to import mock implementations directly
- Avoid relying on automatic Jest mocking for complex objects
- Import specific mock classes/functions as needed

**Example:**

```javascript
// Import the mock directly
const { MockMessage } = require('../__mocks__/discord.js');

// Create mock instance
const mockMessage = MockMessage({
  content: '!ping',
  isBot: false,
  userId: 'mock-user-id',
});
```

### 5. Comprehensive Error Handling

**Recommended Approach:**

- Implement proper error handling in mock functions
- Log errors with context in catch blocks
- Use try/catch in tests to verify error handling behavior

**Example:**

```javascript
try {
  if (message?.author?.id && content) {
    await this.detectionOrchestrator.detectMessage(message.author.id || '', content || '', {
      username: message.author?.username || 'unknown',
    });
  }
} catch (error) {
  console.error('Failed to process message', error || new Error('Unknown error'));
}
```

### 6. Focused Test Structure

**Recommended Approach:**

- Test one aspect at a time with simple, focused tests
- Clear separation between test setup, action, and assertion phases
- Restore mocks and spies in `afterEach` blocks
- Use descriptive test names that explain the expected behavior

**Example:**

```javascript
it('should respond to !ping command', async () => {
  // Arrange - Setup test data
  const mockMessage = MockMessage({
    content: '!ping',
    isBot: false,
  });

  // Act - Perform the action being tested
  await bot.handleMessage(mockMessage);

  // Assert - Verify the expected outcome
  expect(mockMessage.reply).toHaveBeenCalledWith(
    'Pong! Note: Please use slash commands instead (e.g. /ping)'
  );
});
```

## Common Pitfalls and Solutions

### 1. "is not a constructor" Errors

**Problem:** Using `new` with a function mock that isn't a constructor.

**Solution:**

- Use function calls instead of `new` for function mocks
- Example: `MockMessage({...})` instead of `new MockMessage({...})`

### 2. "Cannot read properties of undefined" Errors

**Problem:** Accessing properties on undefined objects in mocks.

**Solution:**

- Use optional chaining (`?.`) for all property access
- Provide default values with nullish coalescing (`??`)
- Check for undefined before accessing nested properties

### 3. Type Errors with Private Properties

**Problem:** TypeScript prevents access to private class members.

**Solution:**

- Create dedicated mock classes that expose private members
- Use type assertions (`as any`) carefully and document their use
- Consider refactoring to improve testability with protected methods

### 4. Mock Function Not Being Called

**Problem:** Mock functions not registering calls in tests.

**Solution:**

- Ensure mock functions are created with `jest.fn()`
- Verify the mock is properly attached to the object
- Check for typos in property names
- Use Jest's `.mockImplementation()` to provide custom behavior

## Recommended Testing Structure

1. **Mock External Dependencies**:

   - Create dedicated mock files in `__mocks__` directory
   - Implement function-based mocks with proper typing
   - Use null-safe property access in all mocks

2. **Expose Private Members for Testing**:

   - Create a dedicated `Bot.ts` mock that exposes private methods
   - Use type assertions carefully when accessing private members
   - Document the use of type assertions for clarity

3. **Focus on Behavior, Not Implementation**:

   - Test what the code does, not how it does it
   - Verify outputs for given inputs
   - Mock only what's necessary for the test

4. **Handle Errors Gracefully**:
   - Implement proper error handling in mocks
   - Test both success and error paths
   - Use try/catch blocks to verify error handling behavior

By following these best practices, we can create more robust and maintainable tests for complex libraries like discord.js.
