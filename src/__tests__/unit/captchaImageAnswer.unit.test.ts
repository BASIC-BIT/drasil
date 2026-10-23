import {
  generateImageAnswer,
  normalizeImageAnswer,
  digestImageAnswer,
  verifyImageAnswer,
  imageAnswerKeyVersion,
} from '../../services/captcha/imageAnswer';

const binding = {
  serverId: 'server',
  userId: 'user',
  caseId: 'case',
  challengeId: 'challenge',
  generation: 1,
};
const key = Buffer.alloc(32, 7);
describe('native image answers', () => {
  it('uses six characters from the exact alphabet', () => {
    for (let i = 0; i < 100; i++)
      expect(generateImageAnswer()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  });
  it('accepts only ASCII case changes and surrounding whitespace', () => {
    expect(normalizeImageAnswer('  ab2cde  ')).toBe('AB2CDE');
    for (const input of [
      'AB CDE',
      'ＡB2CDE',
      'ſB2CDE',
      'AB2CD',
      'AB2CDEF',
      'AB2CD!',
      'AB2CDI',
      'AB2CD0',
    ])
      expect(normalizeImageAnswer(input)).toBeNull();
  });
  it('binds a keyed digest to every issuance field without ambiguous concatenation', () => {
    const digest = digestImageAnswer(binding, 'AB2CDE', key);
    for (const changed of [
      { serverId: 'other' },
      { userId: 'other' },
      { caseId: 'other' },
      { challengeId: 'other' },
      { generation: 2 },
    ])
      expect(digestImageAnswer({ ...binding, ...changed }, 'AB2CDE', key)).not.toEqual(digest);
    expect(
      digestImageAnswer({ ...binding, serverId: 'a', userId: 'bc' }, 'AB2CDE', key)
    ).not.toEqual(digestImageAnswer({ ...binding, serverId: 'ab', userId: 'c' }, 'AB2CDE', key));
    expect(verifyImageAnswer(binding, '  ab2cde  ', key, digest)).toBe(true);
    expect(verifyImageAnswer(binding, 'AB2CDF', key, digest)).toBe(false);
    expect(verifyImageAnswer(binding, 'AB2CDE', key, Buffer.alloc(2))).toBe(false);
    expect(imageAnswerKeyVersion(key)).toMatch(/^[a-f0-9]{64}$/);
    expect(imageAnswerKeyVersion(Buffer.alloc(32, 8))).not.toBe(imageAnswerKeyVersion(key));
  });
});
