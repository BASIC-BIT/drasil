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
      const updatedMember = {
        ...mockMember,
        message_count: 11,
        last_message_at: expect.any(String),
      };

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

      // Validate the timestamp format
      const callArgs = mockRpc.mock.calls[0][1];
      expect(callArgs.p_timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
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

  describe('updateReputationScore', () => {
    it('should update a member reputation score', async () => {
      const updatedMember = {
        ...mockMember,
        reputation_score: 0.75,
      };

      // Set up chained mock methods
      const mockResult = {
        data: updatedMember,
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

      const result = await repository.updateReputationScore(
        mockMember.server_id,
        mockMember.user_id,
        0.75
      );

      expect(result).toEqual(updatedMember);
      expect(mockFrom).toHaveBeenCalledWith('server_members');
      expect(mockUpdate).toHaveBeenCalledWith({ reputation_score: 0.75 });
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
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq2 = jest.fn().mockReturnValue({ select: mockSelect });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ update: mockUpdate });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.updateReputationScore('nonexistent', 'nonexistent', 0.75);

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { message: 'Database error' },
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq2 = jest.fn().mockReturnValue({ select: mockSelect });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ update: mockUpdate });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      await expect(
        repository.updateReputationScore(mockMember.server_id, mockMember.user_id, 0.75)
      ).rejects.toThrow('Database error');
    });
  });

  describe('findByServer', () => {
    it('should return members from a server', async () => {
      const serverMembers = [mockMember, { ...mockMember, user_id: 'user456' }];

      // Set up chained mock methods
      const mockResult = {
        data: serverMembers,
        error: null,
      };

      const mockEq = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findByServer(mockMember.server_id);

      expect(result).toEqual(serverMembers);
      expect(mockFrom).toHaveBeenCalledWith('server_members');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('server_id', mockMember.server_id);
    });

    it('should handle database errors', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { message: 'Database error' },
      };

      const mockEq = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      await expect(repository.findByServer(mockMember.server_id)).rejects.toThrow('Database error');
    });
  });

  describe('findByUser', () => {
    it('should return servers for a user', async () => {
      const userServers = [mockMember, { ...mockMember, server_id: 'server456' }];

      // Set up chained mock methods
      const mockResult = {
        data: userServers,
        error: null,
      };

      const mockEq = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findByUser(mockMember.user_id);

      expect(result).toEqual(userServers);
      expect(mockFrom).toHaveBeenCalledWith('server_members');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('user_id', mockMember.user_id);
    });

    it('should handle database errors', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { message: 'Database error' },
      };

      const mockEq = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      await expect(repository.findByUser(mockMember.user_id)).rejects.toThrow('Database error');
    });
  });

  describe('updateVerificationStatus', () => {
    it('should update verification status', async () => {
      const verifiedMember = {
        ...mockMember,
        verification_status: 'verified',
        is_restricted: false,
        last_status_change: expect.any(String),
        last_verified_at: expect.any(String),
        moderator_id: 'moderator123',
      };

      // Set up chained mock methods
      const mockResult = {
        data: verifiedMember,
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

      const result = await repository.updateVerificationStatus(
        mockMember.server_id,
        mockMember.user_id,
        'verified',
        'moderator123'
      );

      expect(result).toEqual(verifiedMember);
      expect(mockFrom).toHaveBeenCalledWith('server_members');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          verification_status: 'verified',
          moderator_id: 'moderator123',
          is_restricted: false,
          last_status_change: expect.any(String),
          last_verified_at: expect.any(String),
        })
      );
      expect(mockEq1).toHaveBeenCalledWith('server_id', mockMember.server_id);
      expect(mockEq2).toHaveBeenCalledWith('user_id', mockMember.user_id);
    });

    it('should update to rejected status', async () => {
      const rejectedMember = {
        ...mockMember,
        verification_status: 'rejected',
        is_restricted: true,
        last_status_change: expect.any(String),
        moderator_id: 'moderator123',
      };

      // Set up chained mock methods
      const mockResult = {
        data: rejectedMember,
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

      const result = await repository.updateVerificationStatus(
        mockMember.server_id,
        mockMember.user_id,
        'rejected',
        'moderator123'
      );

      expect(result).toEqual(rejectedMember);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          verification_status: 'rejected',
          moderator_id: 'moderator123',
          is_restricted: true,
          last_status_change: expect.any(String),
        })
      );
    });

    it('should handle database errors', async () => {
      // Set up chained mock methods
      const mockResult = {
        data: null,
        error: { message: 'Database error' },
      };

      const mockSingle = jest.fn().mockResolvedValue(mockResult);
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq2 = jest.fn().mockReturnValue({ select: mockSelect });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ update: mockUpdate });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      await expect(
        repository.updateVerificationStatus(
          mockMember.server_id,
          mockMember.user_id,
          'verified',
          'moderator123'
        )
      ).rejects.toThrow('Database error');
    });
  });

  describe('findByVerificationStatus', () => {
    it('should find members with specific verification status', async () => {
      const pendingMembers = [
        { ...mockMember, verification_status: 'pending' },
        { ...mockMember, user_id: 'user456', verification_status: 'pending' },
      ];

      // Set up chained mock methods
      const mockResult = {
        data: pendingMembers,
        error: null,
      };

      const mockEq2 = jest.fn().mockResolvedValue(mockResult);
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

      // Set up the mock for from method
      mocks.mockSupabaseClient!.from = mockFrom;

      const result = await repository.findByVerificationStatus(mockMember.server_id, 'pending');

      expect(result).toEqual(pendingMembers);
      expect(mockFrom).toHaveBeenCalledWith('server_members');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq1).toHaveBeenCalledWith('server_id', mockMember.server_id);
      expect(mockEq2).toHaveBeenCalledWith('verification_status', 'pending');
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

      await expect(
        repository.findByVerificationStatus(mockMember.server_id, 'verified')
      ).rejects.toThrow();
    });
  });

  describe('Complete member verification and restriction workflow', () => {
    it('should handle a complete member lifecycle', async () => {
      // 1. Mock finding a member that doesn't exist yet
      const mockFindNullResult = {
        data: null,
        error: { code: 'PGRST116' },
      };

      const mockFindNullSingle = jest.fn().mockResolvedValue(mockFindNullResult);
      const mockFindNullEq2 = jest.fn().mockReturnValue({ single: mockFindNullSingle });
      const mockFindNullEq1 = jest.fn().mockReturnValue({ eq: mockFindNullEq2 });
      const mockFindNullSelect = jest.fn().mockReturnValue({ eq: mockFindNullEq1 });

      // 2. Mock creating a new member
      const newMember = {
        server_id: 'test-server-123',
        user_id: 'test-user-123',
        join_date: '2024-03-27T00:00:00Z',
        reputation_score: 0.5,
        is_restricted: false,
        message_count: 0,
      };

      const mockUpsertResult = {
        data: newMember,
        error: null,
      };

      const mockUpsertSingle = jest.fn().mockResolvedValue(mockUpsertResult);
      const mockUpsertSelect = jest.fn().mockReturnValue({ single: mockUpsertSingle });
      const mockUpsertUpsert = jest.fn().mockReturnValue({ select: mockUpsertSelect });

      // 3. Mock setting member as restricted
      const restrictedMember = {
        ...newMember,
        is_restricted: true,
        restriction_reason: 'Suspicious activity',
        moderator_id: 'moderator-123',
        last_status_change: expect.any(String),
        verification_status: 'pending',
      };

      const mockRestrictResult = {
        data: restrictedMember,
        error: null,
      };

      const mockRestrictSingle = jest.fn().mockResolvedValue(mockRestrictResult);
      const mockRestrictSelect = jest.fn().mockReturnValue({ single: mockRestrictSingle });
      const mockRestrictEq2 = jest.fn().mockReturnValue({ select: mockRestrictSelect });
      const mockRestrictEq1 = jest.fn().mockReturnValue({ eq: mockRestrictEq2 });
      const mockRestrictUpdate = jest.fn().mockReturnValue({ eq: mockRestrictEq1 });

      // 4. Mock setting member as verified
      const verifiedMember = {
        ...restrictedMember,
        is_restricted: false,
        verification_status: 'verified',
        verified_by: 'admin-123',
        verified_at: expect.any(String),
        updated_at: expect.any(String),
      };

      const mockVerifyResult = {
        data: verifiedMember,
        error: null,
      };

      const mockVerifySingle = jest.fn().mockResolvedValue(mockVerifyResult);
      const mockVerifySelect = jest.fn().mockReturnValue({ single: mockVerifySingle });
      const mockVerifyEq2 = jest.fn().mockReturnValue({ select: mockVerifySelect });
      const mockVerifyEq1 = jest.fn().mockReturnValue({ eq: mockVerifyEq2 });
      const mockVerifyUpdate = jest.fn().mockReturnValue({ eq: mockVerifyEq1 });

      // 5. Mock incrementing message count
      const messageCountMember = {
        ...verifiedMember,
        message_count: 1,
        last_message_at: expect.any(String),
      };

      const mockMessageCountResult = {
        data: messageCountMember,
        error: null,
      };

      const mockMessageCountRpc = jest.fn().mockResolvedValue(mockMessageCountResult);

      // Setup the Supabase mock with different responses for each call
      mocks.mockSupabaseClient!.from = jest
        .fn()
        .mockReturnValueOnce({ select: mockFindNullSelect }) // First findByServerAndUser returns null
        .mockReturnValueOnce({ upsert: mockUpsertUpsert }) // Create member
        .mockReturnValueOnce({ update: mockRestrictUpdate }) // Restrict member
        .mockReturnValueOnce({ update: mockVerifyUpdate }); // Verify member

      mocks.mockSupabaseClient!.rpc = mockMessageCountRpc;

      // Begin the workflow
      // 1. Check if member exists
      const initialMember = await repository.findByServerAndUser(
        'test-server-123',
        'test-user-123'
      );
      expect(initialMember).toBeNull();

      // 2. Create the member
      const createdMember = await repository.upsertMember('test-server-123', 'test-user-123', {
        join_date: '2024-03-27T00:00:00Z',
        reputation_score: 0.5,
      });
      expect(createdMember).toEqual(newMember);

      // 3. Set the member as restricted
      const restricted = await repository.updateRestrictionStatus(
        'test-server-123',
        'test-user-123',
        true,
        'Suspicious activity',
        'moderator-123'
      );
      expect(restricted).toEqual(restrictedMember);
      expect(restricted!.is_restricted).toBe(true);
      expect(restricted!.restriction_reason).toBe('Suspicious activity');

      // 4. Verify the member
      const verified = await repository.updateVerificationStatus(
        'test-server-123',
        'test-user-123',
        'verified',
        'admin-123'
      );
      expect(verified).toEqual(verifiedMember);
      expect(verified!.verification_status).toBe('verified');
      expect(verified!.is_restricted).toBe(false); // Should be unrestricted when verified

      // 5. Increment message count
      const withMessageCount = await repository.incrementMessageCount(
        'test-server-123',
        'test-user-123'
      );
      expect(withMessageCount).toEqual(messageCountMember);
      expect(withMessageCount!.message_count).toBe(1);

      // Verify the correct sequence of calls
      expect(mocks.mockSupabaseClient!.from).toHaveBeenCalledTimes(4);
      expect(mockFindNullEq1).toHaveBeenCalledWith('server_id', 'test-server-123');
      expect(mockFindNullEq2).toHaveBeenCalledWith('user_id', 'test-user-123');

      expect(mockUpsertUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: 'test-server-123',
          user_id: 'test-user-123',
          join_date: '2024-03-27T00:00:00Z',
        }),
        { onConflict: 'server_id,user_id' }
      );

      expect(mockRestrictUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          is_restricted: true,
          restriction_reason: 'Suspicious activity',
          moderator_id: 'moderator-123',
          last_status_change: expect.any(String),
          verification_status: 'pending',
        })
      );

      expect(mockVerifyUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          verification_status: 'verified',
          moderator_id: 'admin-123',
          is_restricted: false,
        })
      );

      expect(mockMessageCountRpc).toHaveBeenCalledWith(
        'increment_member_message_count',
        expect.objectContaining({
          p_server_id: 'test-server-123',
          p_user_id: 'test-user-123',
        })
      );
    });
  });
});
