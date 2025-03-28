import 'reflect-metadata';
import { Container } from 'inversify';
import { TYPES } from '../di/symbols';

// Import interfaces
import { IHeuristicService } from '../services/HeuristicService';
import { IGPTService } from '../services/GPTService';

/**
 * Mock implementations for testing
 */
const mockHeuristicService: IHeuristicService = {
  analyzeMessage: jest.fn().mockReturnValue({ result: 'OK', reasons: [] }),
  isMessageSuspicious: jest.fn().mockReturnValue(false),
  isFrequencyAboveThreshold: jest.fn().mockReturnValue(false),
  containsSuspiciousKeywords: jest.fn().mockReturnValue(false),
  clearMessageHistory: jest.fn(),
};

const mockGPTService: IGPTService = {
  analyzeProfile: jest.fn().mockResolvedValue({
    result: 'OK',
    confidence: 0.1,
    reasons: [],
  }),
};

const mockDetectionEventsRepository = {
  createDetectionEvent: jest.fn().mockResolvedValue({ id: 'mock-id' }),
  findById: jest.fn().mockResolvedValue(null),
  findMany: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue(true),
  count: jest.fn().mockResolvedValue(0),
};

/**
 * Create a test container with mock implementations
 */
export function createTestContainer(): Container {
  const container = new Container();

  // Bind mock services
  container.bind<IHeuristicService>(TYPES.HeuristicService).toConstantValue(mockHeuristicService);

  container.bind<IGPTService>(TYPES.GPTService).toConstantValue(mockGPTService);

  container
    .bind<any>(TYPES.DetectionEventsRepository)
    .toConstantValue(mockDetectionEventsRepository);

  // Add more bindings as needed for your specific tests

  return container;
}

/**
 * How to use in tests:
 *
 * ```typescript
 * import { createTestContainer } from './test-container';
 * import { TYPES } from '../di/symbols';
 * import { IDetectionOrchestrator } from '../services/DetectionOrchestrator';
 * import { DetectionOrchestrator } from '../services/DetectionOrchestrator';
 *
 * describe('DetectionOrchestrator', () => {
 *   let container: Container;
 *   let orchestrator: IDetectionOrchestrator;
 *
 *   beforeEach(() => {
 *     container = createTestContainer();
 *
 *     // Register the service being tested
 *     container.bind<IDetectionOrchestrator>(TYPES.DetectionOrchestrator)
 *       .to(DetectionOrchestrator);
 *
 *     // Get service from container
 *     orchestrator = container.get<IDetectionOrchestrator>(TYPES.DetectionOrchestrator);
 *   });
 *
 *   it('should detect suspicious messages', async () => {
 *     // Test implementation
 *     // ...
 *   });
 * });
 * ```
 */
