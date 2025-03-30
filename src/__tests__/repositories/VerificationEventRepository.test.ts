import { SupabaseClient } from '@supabase/supabase-js';
import { Container } from 'inversify';
import { TYPES } from '../../di/symbols';
import {
  VerificationEventRepository,
  IVerificationEventRepository,
} from '../../repositories/VerificationEventRepository';
import { VerificationStatus } from '../../repositories/types';
import { createTestContainer } from '../utils/test-container';
import { PostgrestError } from '@supabase/postgrest-js';

describe('VerificationEventRepository', () => {
  let container: Container;
  let repository: IVerificationEventRepository;
  let mockSupabase: jest.Mocked<SupabaseClient>;

  beforeEach(() => {
    container = createTestContainer();
    repository = container.get<IVerificationEventRepository>(TYPES.VerificationEventRepository);
    mockSupabase = container.get<SupabaseClient>(
      TYPES.SupabaseClient
    ) as jest.Mocked<SupabaseClient>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByUserAndServer', () => {
    it('should return verification events for a user in a server', async () => {
      const mockEvents = [
        {
          id: '1',
          server_id: 'server1',
          user_id: 'user1',
          status: VerificationStatus.PENDING,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: {},
        },
      ];

      mockSupabase
        .from()
        .select()
        .eq()
        .eq()
        .order()
        .mockResolvedValue({ data: mockEvents, error: null });

      const result = await repository.findByUserAndServer('user1', 'server1');
      expect(result).toEqual(mockEvents);
    });

    it('should handle errors gracefully', async () => {
      const mockError: PostgrestError = {
        code: 'ERROR',
        message: 'Database error',
        details: '',
        hint: '',
      };

      mockSupabase
        .from()
        .select()
        .eq()
        .eq()
        .order()
        .mockResolvedValue({ data: null, error: mockError });

      const result = await repository.findByUserAndServer('user1', 'server1');
      expect(result).toEqual([]);
    });
  });

  describe('findActiveByUserAndServer', () => {
    it('should return active verification event', async () => {
      const mockEvent = {
        id: '1',
        server_id: 'server1',
        user_id: 'user1',
        status: VerificationStatus.PENDING,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
      };

      mockSupabase
        .from()
        .select()
        .eq()
        .eq()
        .eq()
        .order()
        .limit()
        .single()
        .mockResolvedValue({ data: mockEvent, error: null });

      const result = await repository.findActiveByUserAndServer('user1', 'server1');
      expect(result).toEqual(mockEvent);
    });

    it('should return null when no active event exists', async () => {
      const mockError: PostgrestError = {
        code: 'PGRST116',
        message: 'No rows returned',
        details: '',
        hint: '',
      };

      mockSupabase
        .from()
        .select()
        .eq()
        .eq()
        .eq()
        .order()
        .limit()
        .single()
        .mockResolvedValue({ data: null, error: mockError });

      const result = await repository.findActiveByUserAndServer('user1', 'server1');
      expect(result).toBeNull();
    });
  });

  describe('createFromDetection', () => {
    it('should create a verification event from a detection event', async () => {
      const mockDetectionEvent = {
        server_id: 'server1',
        user_id: 'user1',
      };

      const mockCreatedEvent = {
        id: '1',
        server_id: 'server1',
        user_id: 'user1',
        detection_event_id: 'detection1',
        status: VerificationStatus.PENDING,
        created_at: expect.any(String),
        updated_at: expect.any(String),
        metadata: {},
      };

      mockSupabase
        .from()
        .select()
        .eq()
        .single()
        .mockResolvedValue({ data: mockDetectionEvent, error: null });

      mockSupabase
        .from()
        .insert()
        .select()
        .single()
        .mockResolvedValue({ data: mockCreatedEvent, error: null });

      mockSupabase.from().update().eq().mockResolvedValue({ data: null, error: null });

      const result = await repository.createFromDetection('detection1', VerificationStatus.PENDING);
      expect(result).toEqual(mockCreatedEvent);
    });

    it('should handle detection event not found', async () => {
      const mockError: PostgrestError = {
        code: 'PGRST116',
        message: 'No rows returned',
        details: '',
        hint: '',
      };

      mockSupabase
        .from()
        .select()
        .eq()
        .single()
        .mockResolvedValue({ data: null, error: mockError });

      await expect(
        repository.createFromDetection('detection1', VerificationStatus.PENDING)
      ).rejects.toThrow('Detection event detection1 not found');
    });
  });

  describe('updateStatus', () => {
    it('should update verification event status', async () => {
      const mockUpdatedEvent = {
        id: '1',
        server_id: 'server1',
        user_id: 'user1',
        status: VerificationStatus.VERIFIED,
        created_at: new Date().toISOString(),
        updated_at: expect.any(String),
        resolved_at: expect.any(String),
        notes: 'Test note',
        metadata: {},
      };

      mockSupabase
        .from()
        .update()
        .eq()
        .select()
        .single()
        .mockResolvedValue({ data: mockUpdatedEvent, error: null });

      const result = await repository.updateStatus(
        '1',
        VerificationStatus.VERIFIED,
        'admin1',
        'Test note'
      );
      expect(result).toEqual(mockUpdatedEvent);
      expect(result.resolved_at).toBeDefined();
    });

    it('should handle event not found', async () => {
      const mockError: PostgrestError = {
        code: 'PGRST116',
        message: 'No rows returned',
        details: '',
        hint: '',
      };

      mockSupabase
        .from()
        .update()
        .eq()
        .select()
        .single()
        .mockResolvedValue({ data: null, error: mockError });

      await expect(repository.updateStatus('1', VerificationStatus.VERIFIED)).rejects.toThrow(
        'Verification event 1 not found'
      );
    });
  });
});
