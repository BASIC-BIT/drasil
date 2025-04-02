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
- InversifyJS container configuration validation

### Database Testing

**Purpose:** Verify database schema, migrations, and access patterns.

**Areas to Test:**

- Schema validation
- Migration scripts
- Row-level security (RLS) policies
- Complex query performance

## Testing with InversifyJS

### Setting Up the Test Container

The project includes dedicated utilities for testing with InversifyJS dependency injection:

1. **The `createMocks()` Function**:

```typescript
export function createMocks() {
  // Create mocks for all services
  const mockHeuristicService: jest.Mocked<IHeuristicService> = {
    analyzeMessage: jest.fn().mockReturnValue({ result: 'OK', reasons: [] }),
    isMessageSuspicious: jest.fn().mockReturnValue(false),
    // Other methods...
  };

  // Create mocks for all repositories
  const mockUserRepository: jest.Mocked<IUserRepository> = {
    findByDiscordId: jest.fn().mockResolvedValue(null),
    // Other methods...
  };

  // External dependencies
  const mockDiscordClient: jest.Mocked<Partial<Client>> = {
    login: jest.fn().mockResolvedValue('mock-token'),
    // Other methods...
  };

  return {
    mockHeuristicService,
    mockGPTService,
    // Other mocks...
  };
}
```

2. **The `createTestContainer()` Function**:

```typescript
export function createTestContainer(
  customMocks?: Partial<ReturnType<typeof createMocks>>
): Container {
  const container = new Container();
  const mocks = { ...createMocks(), ...customMocks };

  // Bind external dependencies
  container.bind(TYPES.DiscordClient).toConstantValue(mocks.mockDiscordClient as Client);
  container.bind(TYPES.OpenAI).toConstantValue(mocks.mockOpenAI as OpenAI);

  // Bind services
  container
    .bind<IHeuristicService>(TYPES.HeuristicService)
    .toConstantValue(mocks.mockHeuristicService);
  container.bind<IGPTService>(TYPES.GPTService).toConstantValue(mocks.mockGPTService);

  // Bind repositories
  container.bind<IUserRepository>(TYPES.UserRepository).toConstantValue(mocks.mockUserRepository);

  return container;
}
```

3. **The `createServiceTestContainer()` Function**:

```typescript
export function createServiceTestContainer<T>(
  serviceIdentifier: symbol,
  serviceImplementation: new (...args: any[]) => T,
  customMocks?: Partial<ReturnType<typeof createMocks>>
): Container {
  const container = createTestContainer(customMocks);

  // Rebind the service to use the real implementation
  container.unbind(serviceIdentifier);
  container.bind<T>(serviceIdentifier).to(serviceImplementation);

  return container;
}
```

### Testing Patterns

#### 1. Testing a Service with Mocked Dependencies

```typescript
describe('DetectionOrchestrator', () => {
  let container: Container;
  let detectionOrchestrator: IDetectionOrchestrator;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    // Create container with real DetectionOrchestrator but mock dependencies
    container = createServiceTestContainer(TYPES.DetectionOrchestrator, DetectionOrchestrator);

    // Access mocks for assertions
    mocks = createMocks();

    // Get service from container
    detectionOrchestrator = container.get<IDetectionOrchestrator>(TYPES.DetectionOrchestrator);
  });

  it('should detect suspicious message with GPT', async () => {
    // Arrange - Set up mock behavior
    const mockMessage = 'suspicious message';
    const mockUserId = 'user123';
    const mockServerId = 'server456';
    const mockUser = { id: 'user123', username: 'testuser' };

    mocks.mockHeuristicService.isMessageSuspicious.mockReturnValue(false);
    mocks.mockGPTService.analyzeProfile.mockResolvedValue({
      result: 'SUSPICIOUS',
      confidence: 0.8,
      reasons: ['Test reason'],
    });

    // Act - Call the method being tested
    const result = await detectionOrchestrator.detectMessage(
      mockServerId,
      mockUserId,
      mockMessage,
      mockUser
    );

    // Assert - Verify the expected outcome
    expect(result.label).toBe('SUSPICIOUS');
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(mocks.mockHeuristicService.isMessageSuspicious).toHaveBeenCalled();
    expect(mocks.mockGPTService.analyzeProfile).toHaveBeenCalled();
  });
});
```

#### 2. Testing Container Configuration

```typescript
describe('InversifyJS Container Configuration', () => {
  let container: Container;

  beforeEach(() => {
    // Set up environment variables
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_KEY = 'test-key';

    // Configure the container
    container = configureContainer();
  });

  afterEach(() => {
    // Clean up
    delete process.env.DISCORD_TOKEN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_KEY;
  });

  describe('External dependencies', () => {
    it('should resolve Discord client', () => {
      const client = container.get<Client>(TYPES.DiscordClient);
      expect(client).toBeDefined();
      expect(client.login).toBeDefined();
    });

    it('should resolve OpenAI client', () => {
      const openai = container.get<OpenAI>(TYPES.OpenAI);
      expect(openai).toBeDefined();
      expect(openai.chat).toBeDefined();
    });
  });

  describe('Services', () => {
    it('should resolve all services', () => {
      // Assert that all services can be resolved
      const heuristicService = container.get<IHeuristicService>(TYPES.HeuristicService);
      const gptService = container.get<IGPTService>(TYPES.GPTService);
      const detectionOrchestrator = container.get<IDetectionOrchestrator>(
        TYPES.DetectionOrchestrator
      );

      expect(heuristicService).toBeDefined();
      expect(gptService).toBeDefined();
      expect(detectionOrchestrator).toBeDefined();
    });
  });
});
```

#### 3. Testing with Custom Mocks

```typescript
describe('UserService', () => {
  let container: Container;
  let userService: IUserService;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    // Get default mocks
    mocks = createMocks();

    // Customize mock behavior
    mocks.mockUserRepository.findByDiscordId.mockResolvedValue({
      id: 'db-user-id',
      discord_id: 'discord-123',
      username: 'TestUser',
      global_reputation_score: 100,
    });

    // Create container with custom mocks
    container = createServiceTestContainer(TYPES.UserService, UserService, {
      mockUserRepository: mocks.mockUserRepository,
    });

    // Get service from container
    userService = container.get<IUserService>(TYPES.UserService);
  });

  it('should get existing user', async () => {
    // Act
    const result = await userService.getOrCreateUser('discord-123');

    // Assert
    expect(result.discord_id).toBe('discord-123');
    expect(mocks.mockUserRepository.findByDiscordId).toHaveBeenCalledWith('discord-123');
    expect(mocks.mockUserRepository.upsertByDiscordId).not.toHaveBeenCalled();
  });
});
```

### Testing Private Methods

When a class has private methods that need testing, use one of these approaches:

1. **Test through public methods**:
   The most maintainable approach is to test private methods indirectly through public methods.

2. **Type assertions for tests**:
   In cases where direct testing is necessary, use type assertions carefully:

```typescript
describe('GPTService private methods', () => {
  let container: Container;
  let gptService: GPTService; // Note: specific implementation type

  beforeEach(() => {
    container = createServiceTestContainer(TYPES.GPTService, GPTService);
    gptService = container.get<GPTService>(TYPES.GPTService);
  });

  it('should properly format user data', () => {
    // Access private method using type assertion
    const result = (gptService as any).formatUserData({
      username: 'test',
      accountAge: 30,
      joinDate: '2023-01-01',
    });

    expect(result).toContain('username: test');
    expect(result).toContain('account age: 30 days');
  });
});
```

3. **Dedicated test class**:
   For complex cases, create a test subclass that exposes private methods:

```typescript
// Test-only subclass
class TestableGPTService extends GPTService {
  public exposeFormatUserData(data: any): string {
    return this.formatUserData(data);
  }
}

describe('GPTService private methods', () => {
  let testService: TestableGPTService;

  beforeEach(() => {
    // Create with appropriate mocks
    testService = new TestableGPTService(mockOpenAI as any);
  });

  it('should properly format user data', () => {
    const result = testService.exposeFormatUserData({
      username: 'test',
      accountAge: 30,
      joinDate: '2023-01-01',
    });

    expect(result).toContain('username: test');
  });
});
```

## Mocking Strategy for Complex Libraries

Based on our experience debugging and fixing tests in the project, we've established the following best practices for mocking complex npm libraries like discord.js and Supabase:

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

## Supabase Integration Testing

### Repository Layer Testing

**Best Practices:**

1. **Mock Supabase Client Method Chaining:**

   ```typescript
   // Correct way to mock Supabase method chains
   const mockSingle = jest.fn().mockResolvedValue({
     data: mockData,
     error: null,
   });
   const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
   const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
   (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });
   ```

2. **Handle Dynamic Fields:**

   ```typescript
   // Use expect.objectContaining for partial object matching
   expect(mockUpdate).toHaveBeenCalledWith(
     expect.objectContaining({
       field: value,
       updated_at: expect.any(String),
     })
   );
   ```

3. **Mock Multiple Operations:**

   ```typescript
   // Mock different chains for find and update operations
   (supabase.from as jest.Mock)
     .mockReturnValueOnce({ select: mockFindSelect }) // for find
     .mockReturnValueOnce({ update: mockUpdate }); // for update
   ```

4. **Error Handling:**

   ```typescript
   // Test database errors
   const mockSingle = jest.fn().mockResolvedValue({
     data: null,
     error: { message: 'Database error' },
   });
   await expect(repository.method()).rejects.toThrow('Database error');
   ```

5. **Test Setup and Cleanup:**

   ```typescript
   beforeEach(() => {
     jest.clearAllMocks();
     repository = new Repository();
   });

   afterEach(() => {
     jest.clearAllMocks();
     jest.resetModules();
   });
   ```

### Common Supabase Testing Patterns

1. **Finding Records:**

   ```typescript
   // Test successful find
   mockSingle.mockResolvedValue({ data: mockData, error: null });

   // Test not found
   mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

   // Test error
   mockSingle.mockResolvedValue({ data: null, error: { message: 'Error' } });
   ```

2. **Upserting Records:**

   ```typescript
   // Mock find then update/insert
   mockFindSingle.mockResolvedValue({ data: existingData, error: null });
   mockUpdateSingle.mockResolvedValue({ data: updatedData, error: null });
   ```

3. **Listing Records:**

   ```typescript
   // Mock list operation
   mockSelect.mockResolvedValue({ data: items, error: null });
   ```

4. **Filtering Records:**
   ```typescript
   // Mock filter operation
   mockLt.mockResolvedValue({ data: filteredItems, error: null });
   ```

By following these patterns and best practices, we ensure consistent and reliable testing of our Supabase integrations.

#### Error Handling Best Practices

1. **PostgrestError Handling**:

   ```typescript
   // Mock PostgrestError with proper structure
   const mockError = {
     message: 'Database error',
     details: '',
     hint: '',
     code: 'PGRST301',
   } as PostgrestError;

   // Mock error response
   const mockOrder = jest.fn().mockResolvedValue({
     data: null,
     error: mockError,
   });
   ```

2. **Error Assertion**:

   ```typescript
   // Test error handling with proper error message
   await expect(repository.method()).rejects.toThrow(
     'Database error during methodName: Database error'
   );
   ```

3. **Not Found Cases**:
   ```typescript
   // Mock "not found" response with PGRST116
   const mockSingle = jest.fn().mockResolvedValue({
     data: null,
     error: { code: 'PGRST116' },
   });
   ```

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

# Testing Best Practices for InversifyJS and Jest

## InversifyJS Testing

### Container Setup

1. **Dedicated Test Container**:

   - Create a separate container for each test to ensure isolation
   - Use `createServiceTestContainer` utility for consistent setup
   - Bind all dependencies, including nested ones

2. **Mock Injection**:

   - Use `jest.mock()` for module-level mocking
   - Create mock implementations that match interfaces
   - Bind mocks to the test container using interfaces, not implementations
   - Example:
     ```typescript
     container.bind<IUserRepository>(TYPES.UserRepository).toConstantValue(mockUserRepository);
     ```

3. **External Dependency Mocking**:
   - Mock external clients like SupabaseClient, OpenAI, Discord.js
   - Use named mocks that can be referenced in tests
   - Supply mock implementations that handle method chaining
   - Example:
     ```typescript
     const mockSupabaseClient = {
       from: jest.fn().mockReturnThis(),
       select: jest.fn().mockReturnThis(),
       eq: jest.fn().mockReturnThis(),
       single: jest.fn().mockResolvedValue({ data: mockData }),
     };
     container.bind(TYPES.SupabaseClient).toConstantValue(mockSupabaseClient);
     ```

### Private Property Access

1. **Type Assertions for Private Properties**:

   - Use `(instance as any).privateProperty` instead of `instance['privateProperty']`
   - Avoids TypeScript errors when accessing private members
   - Example:
     ```typescript
     (configService as any).serverCache.set(mockServer.guild_id, mockServer);
     ```

2. **Testing Through Public API**:

   - Prefer testing through public methods instead of accessing private properties
   - Use dependency injection to manipulate internal state
   - Verify effects of operations through public methods
   - Example:

     ```typescript
     // Instead of checking private property directly
     // expect(notificationManager['verificationChannelId']).toBe('channel-id');

     // Set the property through public method
     notificationManager.setVerificationChannelId('verification-channel-id');

     // Verify it's set by observing behavior through public API
     await notificationManager.createVerificationThread(mockMember);
     expect(mockClient.channels.fetch).toHaveBeenCalledWith('verification-channel-id');
     ```

### Mock Implementation

1. **Dynamic Field Handling**:

   - Use `expect.any(Type)` for fields that change between test runs
   - Common for timestamps, IDs, and other generated fields
   - Example:
     ```typescript
     expect(result).toEqual({
       ...expectedData,
       created_at: expect.any(String),
       updated_at: expect.any(String),
     });
     ```

2. **Complex Object Mocking**:

   - Create well-structured mocks for complex objects
   - Implement chainable methods for fluent APIs
   - Mock only necessary functionality
   - Example:
     ```typescript
     const mockMessage = {
       embeds: [
         {
           data: {
             fields: [],
           },
           toJSON: function () {
             return this.data;
           },
         },
       ],
       edit: jest.fn().mockResolvedValue(undefined),
     };
     ```

3. **Recursive Method Chaining**:
   - Handle recursive API calls with appropriate mocks
   - Return the mock itself for chainable methods
   - Example:
     ```typescript
     mockRepository.findBy.mockReturnThis();
     mockRepository.order.mockReturnThis();
     mockRepository.limit.mockResolvedValue({ data: [mockEntity] });
     ```

## Jest Testing

### Mock Configuration

1. **Mock Reset and Cleanup**:

   - Use `jest.clearAllMocks()` in `afterEach` for clean state
   - Reset specific mocks when needed with `mockFn.mockReset()`
   - Restore original implementation with `jest.restoreAllMocks()`
   - Example:
     ```typescript
     afterEach(() => {
       jest.clearAllMocks();
     });
     ```

2. **Consistent Timestamps**:

   - Use `jest.useFakeTimers()` and `jest.setSystemTime()` for consistent dates
   - Mock Date constructor for new Date() instances
   - Restore after tests with `jest.useRealTimers()`
   - Example:
     ```typescript
     const fixedDate = new Date('2023-01-01T00:00:00.000Z');
     jest.useFakeTimers();
     jest.setSystemTime(fixedDate);
     ```

3. **Error Scenario Testing**:
   - Configure mocks to simulate errors
   - Test error propagation and handling
   - Use `expect().rejects.toThrow()` for async errors
   - Example:
     ```typescript
     mockUserRepository.upsertByDiscordId.mockRejectedValue(new Error('Database error'));
     await expect(
       userService.updateUserMetadata('discord-123', { profile_analyzed: true })
     ).rejects.toThrow('Database error');
     ```

### Test Structure

1. **Arrange-Act-Assert Pattern**:

   - Clearly separate test setup, action, and verification
   - Label sections with comments for clarity
   - Example:

     ```typescript
     // Arrange
     const mockUser = {
       /* ... */
     };
     mockUserRepository.findByDiscordId.mockResolvedValue(mockUser);

     // Act
     const result = await userService.updateUserMetadata('discord-123', metadata);

     // Assert
     expect(result).toEqual(updatedUser);
     expect(mockUserRepository.upsertByDiscordId).toHaveBeenCalledWith(/* ... */);
     ```

2. **Descriptive Test Names**:

   - Use descriptive `describe` and `it` blocks
   - Format: `it('should <behavior> when <condition>')`
   - Group related tests together
   - Example:

     ```typescript
     describe('updateUserMetadata', () => {
       it('should update user metadata and return updated user', async () => {
         // Test implementation
       });

       it('should handle errors when database operation fails', async () => {
         // Test implementation
       });
     });
     ```

3. **Test Isolation**:
   - Each test should be independent
   - Don't rely on state from other tests
   - Reset state in `beforeEach` or `afterEach`
   - Example:
     ```typescript
     beforeEach(() => {
       // Create fresh mocks for each test
       mockUserRepository = jest.fn(); // Create new mocks
       container = new Container(); // Create new container
     });
     ```

## Common Pitfalls and Solutions

1. **Missing Dependencies**:

   - Error: `No bindings found for service: Symbol(SomeService)`
   - Solution: Ensure all dependencies are bound in the test container
   - Check for nested dependencies that might be needed

2. **Private Property Access Errors**:

   - Error: `Property 'someProperty' does not exist on type 'SomeClass'`
   - Solution: Use `(instance as any).someProperty` instead of bracket notation

3. **Mock Not Called Errors**:

   - Error: `Expected mock function to have been called with <args>`
   - Solution: Check if mock is properly configured and injected into the container

4. **Asynchronous Test Failures**:

   - Error: Test passes incorrectly without waiting for async operations
   - Solution: Always use `async/await` for asynchronous tests

5. **Dynamic Field Mismatches**:

   - Error: `Expected "2023-05-01" but received "2023-05-02"`
   - Solution: Use `expect.any(String)` or specific matchers for dynamic fields

6. **Type Errors in Mocks**:

   - Error: TypeScript errors in mock implementation
   - Solution: Use proper interface typing for mocks and `as unknown as InterfaceType` for type assertions

7. **Constructor Parameter Mismatches**:
   - Error: `Cannot be assigned to the expected parameter type`
   - Solution: Ensure mock parameters match the actual constructor requirements

## Specialized Testing Techniques

1. **Repository Testing**:

   - Mock database clients and responses
   - Test both success and error cases
   - Verify proper query construction
   - Example:
     ```typescript
     mockSupabaseClient.from.mockReturnThis();
     mockSupabaseClient.select.mockReturnThis();
     mockSupabaseClient.eq.mockReturnThis();
     mockSupabaseClient.single.mockResolvedValue({ data: mockEntity });
     ```

2. **Service Integration Testing**:

   - Test services with real implementations but mocked dependencies
   - Focus on interaction between components
   - Verify proper delegation to dependencies
   - Example: Using real `DetectionOrchestrator` with mocked services

3. **Event Handler Testing**:

   - Mock event objects and contexts
   - Verify proper event propagation
   - Test different event scenarios
   - Example: Testing Discord event handlers

4. **Error Handling Testing**:
   - Simulate database errors, API failures, and timeouts
   - Verify proper error handling, logging, and user feedback
   - Test recovery mechanisms
   - Example: Testing repository error handling

## Testing Utilities

1. **Container Creation Helpers**:

   ```typescript
   export function createServiceTestContainer<T>(
     serviceType: symbol,
     serviceClass: new (...args: any[]) => T,
     mocks: Record<string, any>
   ): Container {
     const container = new Container();

     // Bind all mocks to the container
     for (const [key, value] of Object.entries(mocks)) {
       const mockType = TYPES[key.replace('mock', '')];
       container.bind(mockType).toConstantValue(value);
     }

     // Bind the real service
     container.bind(serviceType).to(serviceClass);

     return container;
   }
   ```

2. **Mock Creation Helpers**:

   ```typescript
   export function createMocks() {
     return {
       mockUserRepository: {
         findByDiscordId: jest.fn(),
         upsertByDiscordId: jest.fn(),
         // Other methods...
       } as jest.Mocked<IUserRepository>,

       // Other mocks...
     };
   }
   ```

3. **Custom Matchers**:
   ```typescript
   expect.extend({
     toHaveBeenCalledWithObject(received, expected) {
       const calls = received.mock.calls;
       // Implementation details...
     },
   });
   ```

By following these best practices, you can create robust, maintainable tests for InversifyJS applications that properly verify behavior while remaining resilient to implementation changes.
