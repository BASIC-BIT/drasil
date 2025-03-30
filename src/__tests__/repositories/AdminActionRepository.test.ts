import { SupabaseClient } from '@supabase/supabase-js';
import { Container } from 'inversify';
import { TYPES } from '../../di/symbols';
import {
  AdminActionRepository,
  IAdminActionRepository,
} from '../../repositories/AdminActionRepository';
import { AdminActionType, VerificationStatus } from '../../repositories/types';
import { createTestContainer } from '../utils/test-container';
import { PostgrestError } from '@supabase/postgrest-js';

describe('AdminActionRepository', () => {
  let container: Container;
  let repository: IAdminActionRepository;
  let mockSupabase: jest.Mocked<SupabaseClient>;

  beforeEach(() => {
    container = createTestContainer();
    repository = container.get<IAdminActionRepository>(TYPES.AdminActionRepository);
    mockSupabase = container.get<SupabaseClient>(
      TYPES.SupabaseClient
    ) as jest.Mocked<SupabaseClient>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByUserAndServer', () => {
    it('should return admin actions for a user in a server', async () => {
      const mockActions = [
        {
          id: '1',
          server_id: 'server1',
          user_id: 'user1',
          admin_id: 'admin1',
          verification_event_id: 'verification1',
          action_type: AdminActionType.VERIFY,
          action_at: new Date().toISOString(),
          previous_status: VerificationStatus.PENDING,
          new_status: VerificationStatus.VERIFIED,
          metadata: {},
        },
      ];

      mockSupabase
        .from()
        .select()
        .eq()
        .eq()
        .order()
        .mockResolvedValue({ data: mockActions, error: null });

      const result = await repository.findByUserAndServer('user1', 'server1');
      expect(result).toEqual(mockActions);
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

  describe('findByAdmin', () => {
    it('should return actions taken by an admin', async () => {
      const mockActions = [
        {
          id: '1',
          server_id: 'server1',
          user_id: 'user1',
          admin_id: 'admin1',
          verification_event_id: 'verification1',
          action_type: AdminActionType.VERIFY,
          action_at: new Date().toISOString(),
          metadata: {},
        },
      ];

      mockSupabase
        .from()
        .select()
        .eq()
        .order()
        .mockResolvedValue({ data: mockActions, error: null });

      const result = await repository.findByAdmin('admin1');
      expect(result).toEqual(mockActions);
    });

    it('should handle errors gracefully', async () => {
      const mockError: PostgrestError = {
        code: 'ERROR',
        message: 'Database error',
        details: '',
        hint: '',
      };

      mockSupabase.from().select().eq().order().mockResolvedValue({ data: null, error: mockError });

      const result = await repository.findByAdmin('admin1');
      expect(result).toEqual([]);
    });
  });

  describe('findByVerificationEvent', () => {
    it('should return actions for a verification event', async () => {
      const mockActions = [
        {
          id: '1',
          server_id: 'server1',
          user_id: 'user1',
          admin_id: 'admin1',
          verification_event_id: 'verification1',
          action_type: AdminActionType.VERIFY,
          action_at: new Date().toISOString(),
          metadata: {},
        },
      ];

      mockSupabase
        .from()
        .select()
        .eq()
        .order()
        .mockResolvedValue({ data: mockActions, error: null });

      const result = await repository.findByVerificationEvent('verification1');
      expect(result).toEqual(mockActions);
    });

    it('should handle errors gracefully', async () => {
      const mockError: PostgrestError = {
        code: 'ERROR',
        message: 'Database error',
        details: '',
        hint: '',
      };

      mockSupabase.from().select().eq().order().mockResolvedValue({ data: null, error: mockError });

      const result = await repository.findByVerificationEvent('verification1');
      expect(result).toEqual([]);
    });
  });

  describe('createAction', () => {
    it('should create a new admin action', async () => {
      const mockAction = {
        id: '1',
        server_id: 'server1',
        user_id: 'user1',
        admin_id: 'admin1',
        verification_event_id: 'verification1',
        action_type: AdminActionType.VERIFY,
        action_at: expect.any(String),
        previous_status: VerificationStatus.PENDING,
        new_status: VerificationStatus.VERIFIED,
        metadata: {},
      };

      mockSupabase
        .from()
        .insert()
        .select()
        .single()
        .mockResolvedValue({ data: mockAction, error: null });

      const result = await repository.createAction({
        server_id: 'server1',
        user_id: 'user1',
        admin_id: 'admin1',
        verification_event_id: 'verification1',
        action_type: AdminActionType.VERIFY,
        previous_status: VerificationStatus.PENDING,
        new_status: VerificationStatus.VERIFIED,
        metadata: {},
      });

      expect(result).toEqual(mockAction);
    });

    it('should handle creation errors', async () => {
      const mockError: PostgrestError = {
        code: 'ERROR',
        message: 'Database error',
        details: '',
        hint: '',
      };

      mockSupabase
        .from()
        .insert()
        .select()
        .single()
        .mockResolvedValue({ data: null, error: mockError });

      await expect(
        repository.createAction({
          server_id: 'server1',
          user_id: 'user1',
          admin_id: 'admin1',
          verification_event_id: 'verification1',
          action_type: AdminActionType.VERIFY,
          metadata: {},
        })
      ).rejects.toThrow('Error creating admin action');
    });
  });
});
