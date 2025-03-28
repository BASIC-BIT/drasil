import { ServerMemberRepository, IServerMemberRepository } from '../ServerMemberRepository';
import { ServerMember } from '../types';
import { SupabaseClient } from '@supabase/supabase-js';
import { TYPES } from '../../di/symbols';
import { createServiceTestContainer, createMocks } from '../../__tests__/utils/test-container';
import { Container } from 'inversify';

describe('ServerMemberRepository', () => {
  let container: Container;
  let repository: IServerMemberRepository;
  let mocks: ReturnType<typeof createMocks>;

  const mockMember: ServerMember = {
    server_id: 'server123',
    user_id: 'user123',
    join_date: '2024-03-27T00:00:00Z',
    reputation_score: 0.5,
    is_restricted: false,
    last_verified_at: '2024-03-27T00:00:00Z',
    last_message_at: '2024-03-27T00:00:00Z',
    message_count: 10,
  };

  beforeEach(() => {
    // Create mocks
    mocks = createMocks();

    // Create container with real ServerMemberRepository and mocked Supabase client
    container = createServiceTestContainer(TYPES.ServerMemberRepository, ServerMemberRepository, {
      mockSupabaseClient: mocks.mockSupabaseClient as unknown as SupabaseClient,
    });

    // Get the repository from the container
    repository = container.get<IServerMemberRepository>(TYPES.ServerMemberRepository);

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('findByServerAndUser', () => {
    it('should return member when found', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: mockMember,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockEq2 = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findByServerAndUser(mockMember.server_id, mockMember.user_id);

      expect(result).toEqual(mockMember);
      expect(mockFrom).toHaveBeenCalledWith('server_members');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq1).toHaveBeenCalledWith('server_id', mockMember.server_id);
      expect(mockEq2).toHaveBeenCalledWith('user_id', mockMember.user_id);
    });

    it('should return null when member not found', async () => {
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

      const result = await repository.findByServerAndUser('nonexistent', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { message: 'Database error' },
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockEq2 = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      await expect(repository.findByServerAndUser('server123', 'user123')).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('upsertMember', () => {
    it('should update existing member', async () => {
      const updatedMember = { ...mockMember, reputation_score: 0.8 };

      // Set up chained mock methods
      const mockResult = {
        data: updatedMember,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockUpsert = jest.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = jest.fn().mockReturnValue({ upsert: mockUpsert });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.upsertMember(mockMember.server_id, mockMember.user_id, {
        reputation_score: 0.8,
      });

      expect(result).toEqual(updatedMember);
      expect(mockFrom).toHaveBeenCalledWith('server_members');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: mockMember.server_id,
          user_id: mockMember.user_id,
          reputation_score: 0.8,
        }),
        { onConflict: 'server_id,user_id' }
      );
    });

    it('should create new member when not found', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: mockMember,
        error: null,
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockUpsert = jest.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = jest.fn().mockReturnValue({ upsert: mockUpsert });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.upsertMember('server123', 'user123', {
        join_date: '2024-03-27T00:00:00Z',
      });

      expect(result).toEqual(mockMember);
      expect(mockFrom).toHaveBeenCalledWith('server_members');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: 'server123',
          user_id: 'user123',
          join_date: '2024-03-27T00:00:00Z',
        }),
        { onConflict: 'server_id,user_id' }
      );
    });
  });

  describe('findRestrictedMembers', () => {
    it('should return restricted members', async () => {
      const restrictedMembers = [
        { ...mockMember, is_restricted: true },
        { ...mockMember, server_id: 'server456', user_id: 'user456', is_restricted: true },
      ];

      // Set up chained mock methods
      const mockResult = {
        data: restrictedMembers,
        error: null,
      };

      const mockEq2 = jest.fn().mockResolvedValue(mockResult);
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findRestrictedMembers(mockMember.server_id);

      expect(result).toEqual(restrictedMembers);
      expect(mockFrom).toHaveBeenCalledWith('server_members');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq1).toHaveBeenCalledWith('server_id', mockMember.server_id);
      expect(mockEq2).toHaveBeenCalledWith('is_restricted', true);
    });

    it('should handle database errors', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { message: 'Database error' },
      };

      const mockEq2 = jest.fn().mockResolvedValue(mockResult);
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      await expect(repository.findRestrictedMembers('server123')).rejects.toThrow('Database error');
    });
  });

  describe('incrementMessageCount', () => {
    it('should increment message count using RPC', async () => {
      const updatedMember = { ...mockMember, message_count: 11 };

      // Set up mock for rpc method
      const mockRpc = jest.fn().mockResolvedValue({
        data: updatedMember,
        error: null,
      });

      // Set up the mock for rpc method
      mocks.mockSupabaseClient!.rpc = mockRpc;

      const result = await repository.incrementMessageCount(
        mockMember.server_id,
        mockMember.user_id
      );

      expect(result).toEqual(updatedMember);
      expect(mockRpc).toHaveBeenCalledWith('increment_member_message_count', {
        p_server_id: mockMember.server_id,
        p_user_id: mockMember.user_id,
        p_timestamp: expect.any(String),
      });
    });

    it('should handle RPC errors', async () => {
      // Set up mock for rpc method
      const mockRpc = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'RPC error' },
      });

      // Set up the mock for rpc method
      mocks.mockSupabaseClient!.rpc = mockRpc;

      await expect(
        repository.incrementMessageCount(mockMember.server_id, mockMember.user_id)
      ).rejects.toThrow('RPC error');
    });
  });

  describe('updateRestrictionStatus', () => {
    it('should update restriction status', async () => {
      const restrictedMember = { ...mockMember, is_restricted: true };

      // Set up chained mock methods
      const mockResult = {
        data: restrictedMember,
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

      const result = await repository.updateRestrictionStatus(
        mockMember.server_id,
        mockMember.user_id,
        true
      );

      expect(result).toEqual(restrictedMember);
      expect(mockFrom).toHaveBeenCalledWith('server_members');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          is_restricted: true,
        })
      );
    });
  });
});
