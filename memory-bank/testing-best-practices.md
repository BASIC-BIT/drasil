# Discord Anti-Spam Bot: Testing Best Practices

## Testing Layers

### Unit Testing

**Purpose:** Verify the correct functioning of individual components in isolation.

**Key Principles:**

- Test at the appropriate level of abstraction
- Focus on behavior over implementation details
- Create deterministic tests with proper mock implementations
- Test both happy paths and error handling

### Integration Testing

**Purpose:** Verify interactions between components and with external services like Supabase.

**Key Areas:**

- Repository layer interactions with Supabase
- Service coordination
- End-to-end workflows

### Database Testing

**Purpose:** Verify database schema, migrations, and access patterns.

**Areas to Test:**

- Schema validation
- Migration scripts
- Row-level security (RLS) policies
- Complex query performance

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

## Supabase Integration Testing

### Repository Layer Testing

**Current Implementation:**

- Mock the Supabase client for unit tests
- Basic unit tests for ServerRepository implemented

**Planned Enhancements (Not Yet Implemented):**

- Integration tests with real Supabase instance
- Test error handling and edge cases

### Test Isolation Strategies

**Planned Strategies (Not Yet Implemented):**

1. **Unique Identifiers**

   - Generate unique IDs for each test suite to prevent data conflicts
   - Use UUIDs or timestamped identifiers

2. **Cleanup After Tests**

   - Use `afterEach` or `afterAll` hooks to clean up test data
   - Implement transaction rollbacks when possible

3. **Isolated Data Sets**
   - Use prefixes or namespaces to separate test data
   - Create test-specific schemas when appropriate

### Row-Level Security Testing

**Areas to Cover:**

- Test access with different user roles (anonymous, authenticated)
- Verify policy enforcement for CRUD operations
- Test edge cases and policy bypasses
- Verify negative cases (access that should be denied)

## Test Data Management

### Test Data Setup

**Best Practices:**

- Create realistic test data covering edge cases
- Use factories or builders for consistent test entities
- Document expected initial state
- Reset to known state between tests

### Database Transactions

**Planned Strategy (Not Yet Implemented):**

Currently, no transaction-based test isolation is implemented. The following strategies are planned for future implementation:

- Use transactions with rollbacks to isolate tests
- Create test-specific database users with appropriate permissions
- Consider database snapshots for complex scenarios

## CI/CD Integration

### Automated Testing Pipeline

**Planned Implementation (Not Yet Implemented):**

- Run unit tests on every pull request
- Run integration tests on staging deployments
- Include database migrations in test flow
- Verify database schema consistency

**Note**: GitHub Actions for automated testing have not been set up yet. Currently, all tests are run manually during development.

### Debugging Test Failures

**Best Practices:**

- Add conditional logging in tests
- Use descriptive test and variable names
- Isolate failing tests with `.only`
- Implement step-by-step test verification

**Common Issues and Solutions:**

- Database Connection Issues: Verify Supabase is running and accessible
- Authentication Problems: Verify correct roles and JWT claims
- Test Isolation Failures: Ensure proper cleanup between tests
