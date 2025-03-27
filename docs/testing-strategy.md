# Testing Strategy for Supabase Applications

## 1. Introduction

This document outlines our testing strategy for applications using Supabase, incorporating lessons learned from our development process and industry best practices. A robust testing approach ensures our application remains stable and reliable while accelerating development through early detection of issues.

## 2. Testing Layers

### 2.1 Unit Testing

**Purpose:** Verify the correct functioning of individual components in isolation.

**Key Principles:**

- Test at the appropriate level of abstraction
- Focus on behavior over implementation details
- Create deterministic tests with proper mock implementations
- Test both happy paths and error handling

### 2.2 Integration Testing

**Purpose:** Verify interactions between components and with external services like Supabase.

**Key Areas:**

- Repository layer interactions with Supabase
- Service coordination
- End-to-end workflows

### 2.3 Database Testing

**Purpose:** Verify database schema, migrations, and access patterns.

**Areas to Test:**

- Schema validation
- Migration scripts
- Row-level security (RLS) policies
- Complex query performance

## 3. Unit Testing Best Practices

### 3.1 Test the Right Level of Abstraction

**Lesson Learned:** Testing at too high a level (e.g., testing `getServerConfig`) when we wanted to verify specific behavior (preserving settings) made diagnosis difficult.

**Best Practice:**

- Identify the precise behavior being tested
- Test at the most appropriate unit level
- Create smaller, focused test cases
- Add explicit test cases for edge scenarios

### 3.2 Mock Implementation Strategies

**Lesson Learned:** Methods with complex flows require sophisticated mocking strategies.

**Best Practices:**

- Match the exact operational sequence in mocks
- Use `mockImplementation` with conditional logic for complex interactions
- Consider the state changes across multiple calls
- Track mock call counts for sequence-dependent behavior

```typescript
// Example: Mock different responses based on call sequence
mockRepository.findByGuildId.mockImplementation((id) => {
  if (mockRepository.findByGuildId.mock.calls.length === 1) {
    return Promise.resolve(null); // First call returns null
  } else {
    return Promise.resolve({
      // Subsequent calls return the saved entity
      id: 'saved-id',
      // other properties
    });
  }
});
```

### 3.3 Behavior Verification vs. Implementation Details

**Lesson Learned:** Tests that verify exact parameter structures are brittle.

**Best Practices:**

- Focus on verifying the high-level behavior rather than implementation details
- Test outcomes rather than specific function calls when possible
- For method calls that must be verified, check critical properties rather than exact parameter matching
- Use `.toHaveBeenCalled()` over `.toHaveBeenCalledWith()` when the exact parameters aren't critical

### 3.4 Method Responsibility Clarity

**Lesson Learned:** Similar methods with subtle differences create confusion.

**Best Practices:**

- Ensure clear, distinct naming for different methods
- Document method responsibilities explicitly
- Consider combining related functionality into a single method with options
- Test each responsibility independently

## 4. Supabase Integration Testing

### 4.1 Repository Layer Testing

**Strategy:**

- Mock the Supabase client for unit tests
- Test repository methods with real Supabase instance in integration tests
- Verify CRUD operations work as expected
- Test error handling and edge cases

### 4.2 Test Isolation Strategies

From Supabase documentation:

1. **Unique Identifiers**

   - Generate unique IDs for each test suite to prevent data conflicts
   - Use UUIDs or timestamped identifiers

2. **Cleanup After Tests**

   - Use `afterEach` or `afterAll` hooks to clean up test data
   - Implement transaction rollbacks when possible

3. **Isolated Data Sets**
   - Use prefixes or namespaces to separate test data
   - Create test-specific schemas when appropriate

### 4.3 Row-Level Security Testing

**Areas to Cover:**

- Test access with different user roles (anonymous, authenticated)
- Verify policy enforcement for CRUD operations
- Test edge cases and policy bypasses
- Verify negative cases (access that should be denied)

## 5. Test Data Management

### 5.1 Test Data Setup

**Best Practices:**

- Create realistic test data covering edge cases
- Use factories or builders for consistent test entities
- Document expected initial state
- Reset to known state between tests

### 5.2 Database Transactions

**Strategy:**

- Use transactions with rollbacks to isolate tests
- Create test-specific database users with appropriate permissions
- Consider database snapshots for complex scenarios

## 6. CI/CD Integration

### 6.1 Automated Testing Pipeline

**Implementation:**

- Run unit tests on every pull request
- Run integration tests on staging deployments
- Include database migrations in test flow
- Verify database schema consistency

### 6.2 Supabase Local Environment

Example GitHub Actions setup:

```yaml
name: Database Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
      - name: Start Supabase
        run: supabase start
      - name: Run Tests
        run: supabase test db
```

## 7. Debugging Test Failures

### 7.1 Debugging Strategies

**Best Practices:**

- Add conditional logging in tests
- Use descriptive test and variable names
- Isolate failing tests with `.only`
- Implement step-by-step test verification

### 7.2 Common Issues and Solutions

**Database Connection Issues:**

- Verify Supabase is running and accessible
- Check environment variables and configuration
- Confirm network connectivity and firewall settings

**Authentication Problems:**

- Verify correct roles are set
- Check JWT claims are properly configured
- Confirm RLS policies match test assumptions

**Test Isolation Failures:**

- Verify cleanup between tests
- Check for resource leaks
- Ensure unique identifiers for concurrent tests

## 8. Appendix: Code Examples

### 8.1 Mock Repository Example

```typescript
// Mock repository with conditional response
const mockRepository = {
  findById: jest.fn().mockImplementation((id) => {
    if (id === 'existing-id') {
      return Promise.resolve({ id, name: 'Existing Entity' });
    }
    return Promise.resolve(null);
  }),
  save: jest.fn().mockImplementation((entity) => {
    return Promise.resolve({ ...entity, id: entity.id || 'new-id' });
  }),
};
```

### 8.2 Service Test Example

```typescript
describe('EntityService', () => {
  let service: EntityService;
  let mockRepo: jest.Mocked<EntityRepository>;

  beforeEach(() => {
    mockRepo = {
      findById: jest.fn(),
      save: jest.fn(),
    } as any;
    service = new EntityService(mockRepo);
  });

  it('should create default entity when none exists', async () => {
    // Setup: Repository returns null on first call, then returns saved entity
    mockRepo.findById.mockImplementation((id) => {
      if (mockRepo.findById.mock.calls.length === 1) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        id: 'new-id',
        name: 'Default Name',
        created_at: new Date().toISOString(),
      });
    });

    mockRepo.save.mockImplementation((entity) => {
      return Promise.resolve({
        ...entity,
        id: 'new-id',
      });
    });

    // Execute
    const result = await service.getOrCreateEntity('test-id');

    // Verify
    expect(mockRepo.findById).toHaveBeenCalled();
    expect(mockRepo.save).toHaveBeenCalled();
    expect(result.id).toBe('new-id');
    expect(result.name).toBe('Default Name');
  });
});
```

### 8.3 Supabase Integration Test Example

```typescript
describe('SupabaseRepository Integration', () => {
  let supabase: SupabaseClient;
  let repo: EntityRepository;

  beforeAll(async () => {
    // Start local Supabase or connect to test instance
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
    repo = new EntityRepository(supabase);

    // Setup test data
    await supabase.from('entities').delete().eq('test', true);
  });

  afterEach(async () => {
    // Clean up test data
    await supabase.from('entities').delete().eq('test', true);
  });

  it('should create and retrieve an entity', async () => {
    // Create test entity
    const entity = { name: 'Test Entity', test: true };
    const { data: created } = await repo.create(entity);

    // Retrieve and verify
    const { data: retrieved } = await repo.findById(created.id);
    expect(retrieved).toEqual(created);
  });
});
```

By following these strategies and practices, we can build robust, maintainable test suites that catch issues early and support rapid development with confidence.
