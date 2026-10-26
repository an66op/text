let accountId = '';
let epoch = 0;
const listeners = new Set<() => void>();
export const expectedAccount = () => accountId;
export const accountEpoch = () => epoch;
export function advanceAccountEpoch() {
  epoch += 1;
}
export function setExpectedAccount(value: string, rotate = true) {
  if (rotate || value !== accountId) advanceAccountEpoch();
  accountId = value;
}
export function accountChanged() {
  for (const listener of listeners) listener();
}
export function onAccountChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
