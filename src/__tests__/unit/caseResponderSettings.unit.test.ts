import {
  getCaseResponderSettings,
  normalizeCaseResponderRoleIds,
} from '../../utils/caseResponderSettings';

describe('caseResponderSettings (unit)', () => {
  it('normalizes role IDs with dedupe and safe defaults', () => {
    expect(
      normalizeCaseResponderRoleIds(['123456789012345678', 'bad', '123456789012345678'])
    ).toEqual(['123456789012345678']);

    expect(getCaseResponderSettings({})).toEqual({
      roleIds: [],
      routingMode: 'off',
      threadMemberCap: 25,
    });
  });

  it('coerces routing settings from server settings', () => {
    expect(
      getCaseResponderSettings({
        case_responder_role_ids: ['123456789012345678', '234567890123456789'],
        case_responder_routing_mode: 'ping_and_add_members',
        case_responder_thread_member_cap: 500,
      })
    ).toEqual({
      roleIds: ['123456789012345678', '234567890123456789'],
      routingMode: 'ping_and_add_members',
      threadMemberCap: 100,
    });
  });
});
