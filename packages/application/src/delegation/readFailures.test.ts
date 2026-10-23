import { ReadDependencyUnavailableError, toUnavailableReadDenial } from '../index';

describe('unavailable read projection', () => {
  it('preserves_known_temporary_retry_advice', () => {
    expect(
      toUnavailableReadDenial(new ReadDependencyUnavailableError({ retryAfterSeconds: 2 }))
    ).toEqual({ kind: 'denied', reason: 'unavailable', retryAfterSeconds: 2 });
  });

  it('unknown_error_is_unavailable_without_retry_timing', () => {
    for (const error of [
      new Error('PRIVATE_BACKEND'),
      Object.assign(new Error('PRIVATE_BACKEND'), { retryAfterSeconds: 2 }),
      { name: 'ReadDependencyUnavailableError', retryAfterSeconds: 2, status: 429 },
      null,
    ]) {
      expect(toUnavailableReadDenial(error)).toEqual({ kind: 'denied', reason: 'unavailable' });
    }
  });

  it('invalid_retry_advice_never_reaches_results', () => {
    for (const retryAfterSeconds of [undefined, 0, -1, NaN, Infinity, -Infinity]) {
      expect(
        toUnavailableReadDenial(new ReadDependencyUnavailableError({ retryAfterSeconds }))
      ).toEqual({ kind: 'denied', reason: 'unavailable' });
    }
  });
});
