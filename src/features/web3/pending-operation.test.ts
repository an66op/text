import { beforeEach, describe, expect, it } from 'vitest';
import { clearPending, pendingKey, readPending } from './pending-operation';

describe('test ledger recovery identifiers', () => {
  beforeEach(() => sessionStorage.clear());
  it('keeps recovery requests isolated by account and validates every persisted field', () => {
    sessionStorage.setItem(
      pendingKey('alice'),
      JSON.stringify({
        kind: 'transfer',
        requestId: 'recovery-123',
        recipientHandle: 'bob',
        amount: '29',
      }),
    );
    expect(readPending('alice')).toEqual({
      kind: 'transfer',
      requestId: 'recovery-123',
      recipientHandle: 'bob',
      amount: '29',
    });
    expect(readPending('bob')).toBeNull();
    for (const changes of [
      { amount: '-1' },
      { amount: '100000000001' },
      { recipientHandle: '12bad' },
      { requestId: 'bad' },
      { amount: '9'.repeat(1000) },
    ]) {
      sessionStorage.setItem(
        pendingKey('alice'),
        JSON.stringify({
          kind: 'transfer',
          requestId: 'recovery-123',
          recipientHandle: 'bob',
          amount: '29',
          ...changes,
        }),
      );
      expect(readPending('alice')).toBeNull();
    }
  });
  it('never clears a newer request when an older response resolves', () => {
    sessionStorage.setItem(
      pendingKey('alice'),
      JSON.stringify({ kind: 'faucet', requestId: 'newer-request' }),
    );
    clearPending('alice', 'older-request');
    expect(readPending('alice')?.requestId).toBe('newer-request');
    clearPending('alice', 'newer-request');
    expect(readPending('alice')).toBeNull();
  });
});
