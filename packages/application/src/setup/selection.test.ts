import { selectSetupCandidate, setupProvisioningDetectionMode } from './selection';
test.each(['explicit', 'configured', 'matched'])(
  'candidate %s selection projects only bound fields',
  (mode) => {
    const role = { id: 'role', name: 'Case', permissions: '8', color: 123 };
    expect(
      selectSetupCandidate({
        defaultName: 'Case',
        candidates: [role],
        explicitId: mode === 'explicit' ? role.id : undefined,
        configuredId: mode === 'configured' ? role.id : undefined,
      })
    ).toEqual({ kind: 'reuse', id: 'role', name: 'Case' });
  }
);
test('candidate selection binds create, reuse, ambiguity and explicit disappearance', () => {
  const input = { defaultName: 'Case', candidates: [] as { id: string; name: string }[] };
  expect(selectSetupCandidate(input)).toEqual({ kind: 'create', name: 'Case' });
  const matching = { id: 'role', name: 'Case' };
  expect(selectSetupCandidate({ ...input, candidates: [matching] })).toEqual({
    kind: 'reuse',
    ...matching,
  });
  expect(
    selectSetupCandidate({ ...input, candidates: [matching, { id: 'other', name: 'Case' }] })
  ).toEqual({ kind: 'ambiguous', ids: ['other', 'role'] });
  expect(selectSetupCandidate({ ...input, explicitId: 'gone' })).toEqual({ kind: 'invalid' });
  expect(
    selectSetupCandidate({
      ...input,
      configuredId: 'role',
      candidates: [{ ...matching, name: 'Configured' }],
    })
  ).toEqual({ kind: 'reuse', id: 'role', name: 'Configured' });
  expect(
    selectSetupCandidate({
      ...input,
      configuredId: 'role',
      requestedName: 'New',
      candidates: [matching],
    })
  ).toEqual({ kind: 'create', name: 'New' });
});
test('first setup default changes only incomplete legacy setup without surface overrides', () => {
  const state = {
    case_role_id: null,
    admin_channel_id: null,
    verification_channel_id: null,
    settings: { detection_response_mode: 'restrict' as const },
  };
  expect(setupProvisioningDetectionMode(state)).toBe('notify_only');
  expect(
    setupProvisioningDetectionMode({
      ...state,
      settings: { ...state.settings, join_detection_response_mode: 'off' },
    })
  ).toBeUndefined();
  expect(
    setupProvisioningDetectionMode({
      ...state,
      case_role_id: 'r',
      admin_channel_id: 'a',
      verification_channel_id: 'v',
    })
  ).toBeUndefined();
  expect(setupProvisioningDetectionMode(state, 'off')).toBe('off');
});
