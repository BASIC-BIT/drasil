import {
  VerificationThreadRepository,
  IVerificationThreadRepository,
} from '../VerificationThreadRepository';
import { VerificationThread } from '../types';
import { SupabaseClient } from '@supabase/supabase-js';
import { TYPES } from '../../di/symbols';
import { createServiceTestContainer, createMocks } from '../../__tests__/utils/test-container';
import { Container } from 'inversify';

describe('VerificationThreadRepository', () => {
  let container: Container;
  let repository: IVerificationThreadRepository;
  let mocks: ReturnType<typeof createMocks>;

  const mockThread: VerificationThread = {
    id: 'thread-uuid-123',
    server_id: 'server-123',
    user_id: 'user-123',
    thread_id: 'discord-thread-123',
    created_at: '2023-01-01T00:00:00Z',
    status: 'open',
  };

  beforeEach(() => {
    // Create mocks
    mocks = createMocks();

    // Create container with real VerificationThreadRepository and mocked Supabase client
    container = createServiceTestContainer(
      TYPES.VerificationThreadRepository,
      VerificationThreadRepository,
      {
        mockSupabaseClient: mocks.mockSupabaseClient as unknown as SupabaseClient,
      }
    );

    // Get the repository from the container
    repository = container.get<IVerificationThreadRepository>(TYPES.VerificationThreadRepository);

    jest.clearAllMocks();
  });

  describe('findByThreadId', () => {
    it('should find a thread by server ID and thread ID', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: mockThread,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockEq2 = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findByThreadId(mockThread.server_id, mockThread.thread_id);

      expect(result).toEqual(mockThread);
      expect(mockFrom).toHaveBeenCalledWith('verification_threads');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq1).toHaveBeenCalledWith('server_id', mockThread.server_id);
      expect(mockEq2).toHaveBeenCalledWith('thread_id', mockThread.thread_id);
    });

    it('should return null when thread not found', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { code: 'PGRST116' },
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockEq2 = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findByThreadId('nonexistent', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('createThread', () => {
    it('should create a new verification thread', async () => {
      // Setup mock for the insert operation
      const mockResult = {
        data: mockThread,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = jest.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.createThread(
        mockThread.server_id,
        mockThread.user_id,
        mockThread.thread_id
      );

      expect(result).toEqual(mockThread);
      expect(mockFrom).toHaveBeenCalledWith('verification_threads');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: mockThread.server_id,
          user_id: mockThread.user_id,
          thread_id: mockThread.thread_id,
          status: 'open',
        })
      );
    });
  });

  describe('updateThreadStatus', () => {
    it('should update a thread status to resolved with resolution info', async () => {
      // Expected updated thread
      const updatedThread: VerificationThread = {
        ...mockThread,
        status: 'resolved',
        resolved_at: '2023-01-02T00:00:00Z',
        resolved_by: 'admin-123',
        resolution: 'verified',
      };

      // Setup mock for the update operation
      const mockResult = {
        data: updatedThread,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq2 = jest.fn().mockReturnValue({ select: mockSelect });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ update: mockUpdate });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      // Mock Date.now() to return a consistent date for testing
      const mockDate = new Date('2023-01-02T00:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate as unknown as string);

      const result = await repository.updateThreadStatus(
        mockThread.server_id,
        mockThread.thread_id,
        'resolved',
        'admin-123',
        'verified'
      );

      expect(result).toEqual(updatedThread);
      expect(mockFrom).toHaveBeenCalledWith('verification_threads');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'resolved',
          resolved_at: expect.any(String),
          resolved_by: 'admin-123',
          resolution: 'verified',
        })
      );
      expect(mockEq1).toHaveBeenCalledWith('server_id', mockThread.server_id);
      expect(mockEq2).toHaveBeenCalledWith('thread_id', mockThread.thread_id);

      // Restore the original implementation
      jest.restoreAllMocks();
    });
  });

  describe('findByStatus', () => {
    it('should find all threads with the specified status', async () => {
      const mockOpenThreads = [
        mockThread,
        { ...mockThread, id: 'thread-uuid-456', thread_id: 'discord-thread-456' },
      ];

      // Setup mock for the select operation
      const mockResult = {
        data: mockOpenThreads,
        error: null,
      };

      const mockOrder = jest.fn().mockResolvedValue(mockResult);
      const mockEq2 = jest.fn().mockReturnValue({ order: mockOrder });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findByStatus(mockThread.server_id, 'open');

      expect(result).toEqual(mockOpenThreads);
      expect(mockFrom).toHaveBeenCalledWith('verification_threads');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq1).toHaveBeenCalledWith('server_id', mockThread.server_id);
      expect(mockEq2).toHaveBeenCalledWith('status', 'open');
      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    });
  });
});
