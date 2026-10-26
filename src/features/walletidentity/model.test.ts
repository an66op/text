import { describe, expect, it } from 'vitest';
import { prepared, testAddress } from './test-helpers';
import { validateChallenge } from './model';
const snapshot = {
  provider: { request: async () => null },
  address: testAddress,
  chainId: '1',
  version: 1,
};
describe('server SIWE preview boundaries', () => {
  it.each(['login', 'bind'] as const)(
    'accepts the exact fixed %s message without rewriting it',
    (purpose) => {
      const value = prepared(purpose);
      expect(
        validateChallenge(value, snapshot, purpose, window.location.origin, 'user-member'),
      ).toBe(value);
    },
  );
  it.each([
    'origin',
    'address',
    'chainId',
    'purpose',
    'uri',
    'expired',
    'statement',
    'extra-lines',
    'message-address',
  ] as const)('rejects %s changes before signing', (field) => {
    const value = prepared();
    if (field === 'origin') value.challenge.origin = 'https://other.test';
    if (field === 'address') value.challenge.address = `0x${'ff'.repeat(20)}`;
    if (field === 'chainId') value.challenge.chainId = '9007199254740993';
    if (field === 'purpose') value.challenge.purpose = 'bind';
    if (field === 'uri') value.challenge.uri = `${window.location.origin}/account/wallets`;
    if (field === 'expired') value.challenge.expiresAt = new Date(Date.now() - 1).toISOString();
    if (field === 'statement')
      value.challenge.message = value.challenge.message.replace(
        'Sign in to your existing Gongming account.',
        'Send money to this account.',
      );
    if (field === 'extra-lines') value.challenge.message += '\nMore terms';
    if (field === 'message-address')
      value.challenge.message = value.challenge.message.replace(
        testAddress,
        `0x${'ff'.repeat(20)}`,
      );
    expect(() => validateChallenge(value, snapshot, 'login', window.location.origin)).toThrow();
  });
  it('rejects a bind statement for a different user', () => {
    expect(() =>
      validateChallenge(
        prepared('bind', 'user-other'),
        snapshot,
        'bind',
        window.location.origin,
        'user-member',
      ),
    ).toThrow();
  });
});
