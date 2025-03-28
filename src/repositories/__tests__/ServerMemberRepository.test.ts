import { ServerMemberRepository } from '../ServerMemberRepository';
import { ServerMember } from '../types';
import { supabase } from '../../config/supabase';

// Mock Supabase client
jest.mock('../../config/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

describe('ServerMemberRepository', () => {
  let repository: ServerMemberRepository;
  const mockMember: ServerMember = {
    id: 'member123',
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
    jest.clearAllMocks();
    repository = new ServerMemberRepository();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('findByServerAndUser', () => {
    it('should return member when found', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockMember,
        error: null,
      });

      const mockEq2 = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const result = await repository.findByServerAndUser(mockMember.server_id, mockMember.user_id);

      expect(result).toEqual(mockMember);
      expect(supabase.from).toHaveBeenCalledWith('server_members');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq1).toHaveBeenCalledWith('server_id', mockMember.server_id);
      expect(mockEq2).toHaveBeenCalledWith('user_id', mockMember.user_id);
    });

    it('should return null when member not found', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const mockEq2 = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const result = await repository.findByServerAndUser('nonexistent', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const mockEq2 = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      await expect(repository.findByServerAndUser('server123', 'user123')).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('upsertMember', () => {
    it('should update existing member', async () => {
      // Mock findByServerAndUser
      const mockFindSingle = jest.fn().mockResolvedValue({
        data: mockMember,
        error: null,
      });
      const mockFindEq2 = jest.fn().mockReturnValue({ single: mockFindSingle });
      const mockFindEq1 = jest.fn().mockReturnValue({ eq: mockFindEq2 });
      const mockFindSelect = jest.fn().mockReturnValue({ eq: mockFindEq1 });

      // Mock update
      const mockUpdateSingle = jest.fn().mockResolvedValue({
        data: { ...mockMember, reputation_score: 0.8 },
        error: null,
      });
      const mockUpdateSelect = jest.fn().mockReturnValue({ single: mockUpdateSingle });
      const mockUpdateEq2 = jest.fn().mockReturnValue({ select: mockUpdateSelect });
      const mockUpdateEq1 = jest.fn().mockReturnValue({ eq: mockUpdateEq2 });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockUpdateEq1 });

      // Setup supabase mock to return different chains for find and update
      (supabase.from as jest.Mock)
        .mockReturnValueOnce({ select: mockFindSelect }) // for find
        .mockReturnValueOnce({ update: mockUpdate }); // for update

      const result = await repository.upsertMember(mockMember.server_id, mockMember.user_id, {
        reputation_score: 0.8,
      });

      expect(result).toEqual({ ...mockMember, reputation_score: 0.8 });
      expect(supabase.from).toHaveBeenCalledWith('server_members');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should create new member when not found', async () => {
      // Mock findByServerAndUser to return null
      const mockFindSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });
      const mockFindEq2 = jest.fn().mockReturnValue({ single: mockFindSingle });
      const mockFindEq1 = jest.fn().mockReturnValue({ eq: mockFindEq2 });
      const mockFindSelect = jest.fn().mockReturnValue({ eq: mockFindEq1 });

      // Mock insert
      const mockInsertSingle = jest.fn().mockResolvedValue({
        data: mockMember,
        error: null,
      });
      const mockInsertSelect = jest.fn().mockReturnValue({ single: mockInsertSingle });
      const mockInsert = jest.fn().mockReturnValue({ select: mockInsertSelect });

      // Setup supabase mock
      (supabase.from as jest.Mock)
        .mockReturnValueOnce({ select: mockFindSelect }) // for find
        .mockReturnValueOnce({ insert: mockInsert }); // for insert

      const result = await repository.upsertMember('server123', 'user123', {
        join_date: '2024-03-27T00:00:00Z',
      });

      expect(result).toEqual(mockMember);
      expect(supabase.from).toHaveBeenCalledWith('server_members');
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  describe('findRestrictedMembers', () => {
    it('should return restricted members', async () => {
      const restrictedMembers = [
        { ...mockMember, is_restricted: true },
        { ...mockMember, id: 'member456', is_restricted: true },
      ];

      const mockEq2 = jest.fn().mockResolvedValue({
        data: restrictedMembers,
        error: null,
      });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const result = await repository.findRestrictedMembers(mockMember.server_id);

      expect(result).toEqual(restrictedMembers);
      expect(supabase.from).toHaveBeenCalledWith('server_members');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq1).toHaveBeenCalledWith('server_id', mockMember.server_id);
      expect(mockEq2).toHaveBeenCalledWith('is_restricted', true);
    });

    it('should handle database errors', async () => {
      const mockEq2 = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      await expect(repository.findRestrictedMembers('server123')).rejects.toThrow('Database error');
    });
  });

  describe('incrementMessageCount', () => {
    it('should increment message count using RPC', async () => {
      const updatedMember = { ...mockMember, message_count: 11 };
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: updatedMember,
        error: null,
      });

      const result = await repository.incrementMessageCount(
        mockMember.server_id,
        mockMember.user_id
      );

      expect(result).toEqual(updatedMember);
      expect(supabase.rpc).toHaveBeenCalledWith('increment_member_message_count', {
        p_server_id: mockMember.server_id,
        p_user_id: mockMember.user_id,
        p_timestamp: expect.any(String),
      });
    });

    it('should handle RPC errors', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'RPC error' },
      });

      await expect(
        repository.incrementMessageCount(mockMember.server_id, mockMember.user_id)
      ).rejects.toThrow('RPC error');
    });
  });

  describe('updateRestrictionStatus', () => {
    it('should update restriction status', async () => {
      const restrictedMember = { ...mockMember, is_restricted: true };
      const mockSingle = jest.fn().mockResolvedValue({
        data: restrictedMember,
        error: null,
      });
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq2 = jest.fn().mockReturnValue({ select: mockSelect });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq1 });
      (supabase.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      const result = await repository.updateRestrictionStatus(
        mockMember.server_id,
        mockMember.user_id,
        true
      );

      expect(result).toEqual(restrictedMember);
      expect(supabase.from).toHaveBeenCalledWith('server_members');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          is_restricted: true,
        })
      );
    });

    it('should handle database errors', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });
      const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
      const mockEq2 = jest.fn().mockReturnValue({ select: mockSelect });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq1 });
      (supabase.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      await expect(
        repository.updateRestrictionStatus(mockMember.server_id, mockMember.user_id, true)
      ).rejects.toThrow('Database error');
    });
  });
});
