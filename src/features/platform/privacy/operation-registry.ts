import { ApiError, apiErrorMessage } from '@/shared/api/client';
import { onAccountEpochChange } from '@/shared/api/account-guard';
import { isContactScopeCurrent } from './contact-scope';
import { privacyApi } from './privacy-api';
import type { BlockList, BlockReceipt, ContactPrivacy, ContactPrivacyFields } from './types';

export type PrivacyOperation =
  | { kind: 'privacy'; value: ContactPrivacyFields; revision: number }
  | { kind: 'block'; userId: string; blocked: boolean; revision: number };
export type PrivacyResult = ContactPrivacy | BlockReceipt | BlockList;
export type PrivacyOperationState = {
  phase: 'idle' | 'pending' | 'unknown';
  operation: PrivacyOperation | null;
  error: string;
  result: PrivacyResult | null;
  checked: boolean;
};
const empty: PrivacyOperationState = {
  phase: 'idle',
  operation: null,
  error: '',
  result: null,
  checked: false,
};
type Entry = { state: PrivacyOperationState; epoch: number; request: AbortController | null };
const entries = new Map<string, Entry>(),
  listeners = new Set<() => void>();
let activeScope = '';
const emit = () => {
  for (const listener of listeners) listener();
};
const entry = (scope: string) => {
  if (!entries.has(scope)) entries.set(scope, { state: empty, epoch: 0, request: null });
  return entries.get(scope)!;
};
export function activatePrivacyScope(scope: string) {
  if (activeScope === scope) return;
  for (const value of entries.values()) value.request?.abort();
  entries.clear();
  activeScope = scope;
  emit();
}
onAccountEpochChange(() => {
  for (const value of entries.values()) value.request?.abort();
  entries.clear();
  activeScope = '';
  emit();
});
const current = (scope: string) => !!scope && scope === activeScope && isContactScopeCurrent(scope);
export const privacyReadEpoch = (scope: string) => (current(scope) ? entry(scope).epoch : -1);
export const getPrivacyOperation = (scope: string) => (current(scope) ? entry(scope).state : empty);
export const subscribePrivacyOperation = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function privacyChanged() {
  window.dispatchEvent(new Event('gongming:privacy-changed'));
  window.dispatchEvent(new Event('gongming:friendships-changed'));
  window.dispatchEvent(new Event('gongming:conversations-changed'));
}
function publish(value: Entry, next: PrivacyOperationState) {
  value.state = next;
  value.epoch++;
  emit();
}
const uncertain = (error: unknown) =>
  !(error instanceof ApiError) ||
  error.status === 0 ||
  error.status >= 500 ||
  (error.status >= 200 && error.status < 300);
const samePrivacy = (value: ContactPrivacy, expected: ContactPrivacyFields) =>
  value.directMessagePolicy === expected.directMessagePolicy &&
  value.groupInvitePolicy === expected.groupInvitePolicy &&
  value.allowFriendRequests === expected.allowFriendRequests &&
  value.discoverableByHandle === expected.discoverableByHandle;
async function write(scope: string, operation: PrivacyOperation): Promise<PrivacyResult | null> {
  const value = entry(scope),
    request = new AbortController();
  value.request = request;
  publish(value, { phase: 'pending', operation, error: '', result: null, checked: false });
  try {
    const result =
      operation.kind === 'privacy'
        ? await privacyApi.save(
            { ...operation.value, revision: operation.revision },
            request.signal,
          )
        : await (operation.blocked ? privacyApi.block : privacyApi.unblock)(
            operation.userId,
            operation.revision,
            request.signal,
          );
    if (!current(scope) || request.signal.aborted || value.request !== request) return null;
    if (
      result.revision < operation.revision ||
      result.revision > operation.revision + 1 ||
      (operation.kind === 'privacy' && !samePrivacy(result as ContactPrivacy, operation.value))
    )
      throw new ApiError('保存回执无法确认，请先核实', 'INVALID_RESPONSE', 200);
    publish(value, { ...empty, result });
    privacyChanged();
    return result;
  } catch (error) {
    if (current(scope) && !request.signal.aborted && value.request === request)
      publish(value, {
        ...empty,
        phase: uncertain(error) ? 'unknown' : 'idle',
        operation: uncertain(error) ? operation : null,
        error: apiErrorMessage(error),
      });
    return null;
  } finally {
    if (value.request === request) value.request = null;
  }
}
export function runPrivacyOperation(
  scope: string,
  operation: PrivacyOperation,
): Promise<PrivacyResult | null> {
  if (!current(scope) || entry(scope).state.phase !== 'idle') return Promise.resolve(null);
  return write(scope, operation);
}
export async function reconcilePrivacyOperation(scope: string): Promise<PrivacyResult | null> {
  if (!current(scope)) return null;
  const value = entry(scope),
    operation = value.state.operation;
  if (value.state.phase !== 'unknown' || !operation || value.request) return null;
  const request = new AbortController();
  value.request = request;
  publish(value, { ...value.state, phase: 'pending', error: '' });
  try {
    const result =
      operation.kind === 'privacy'
        ? await privacyApi.get(request.signal)
        : await privacyApi.blocks(
            { userId: operation.userId, limit: 1, offset: 0 },
            request.signal,
          );
    if (!current(scope) || request.signal.aborted || value.request !== request) return null;
    if (result.revision < operation.revision)
      throw new ApiError('服务器状态尚未确认，请重新核实', 'INVALID_RESPONSE', 200);
    const matches =
      operation.kind === 'privacy'
        ? samePrivacy(result as ContactPrivacy, operation.value)
        : !!(result as BlockList).items.length === operation.blocked;
    // An unchanged snapshot cannot prove a timed-out write will never commit.
    // Keep the opposite intent locked; only a same-intent manual retry is safe.
    if (matches || result.revision > operation.revision) {
      publish(value, { ...empty, result });
      privacyChanged();
    } else
      publish(value, {
        phase: 'unknown',
        operation,
        error: '尚未确认上次操作，请再次核实或重试原操作',
        result,
        checked: true,
      });
    return result;
  } catch (error) {
    if (current(scope) && !request.signal.aborted && value.request === request)
      publish(value, {
        ...value.state,
        phase: 'unknown',
        error: apiErrorMessage(error),
        checked: false,
      });
    return null;
  } finally {
    if (value.request === request) value.request = null;
  }
}
export function retryPrivacyOperation(scope: string): Promise<PrivacyResult | null> {
  if (!current(scope)) return Promise.resolve(null);
  const state = entry(scope).state;
  if (state.phase !== 'unknown' || !state.operation || !state.checked) return Promise.resolve(null);
  return write(scope, state.operation);
}
