export type Operation =
  | { kind: 'faucet'; requestId: string }
  | { kind: 'transfer'; requestId: string; recipientHandle: string; amount: string };

export function pendingKey(userId: string) {
  return `gongming-ledger-pending:${userId}`;
}

export function readPending(userId: string): Operation | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(userId));
    if (!raw || raw.length > 1000) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      !('kind' in value) ||
      !('requestId' in value) ||
      typeof value.requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(value.requestId)
    )
      return null;
    if (value.kind === 'faucet') return { kind: 'faucet', requestId: value.requestId };
    if (
      value.kind === 'transfer' &&
      'recipientHandle' in value &&
      typeof value.recipientHandle === 'string' &&
      /^[a-z][a-z0-9_]{2,29}$/.test(value.recipientHandle) &&
      'amount' in value &&
      typeof value.amount === 'string' &&
      /^[1-9]\d{0,11}$/.test(value.amount) &&
      BigInt(value.amount) <= 100000000000n
    ) {
      return {
        kind: 'transfer',
        requestId: value.requestId,
        recipientHandle: value.recipientHandle,
        amount: value.amount,
      };
    }
  } catch {
    // Invalid local recovery data must never initiate a request or erase another pending operation.
  }
  return null;
}

export function clearPending(userId: string, requestId: string) {
  if (readPending(userId)?.requestId === requestId) sessionStorage.removeItem(pendingKey(userId));
}
