import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { advanceAccountEpoch } from '@/shared/api/account-guard';
import type { Conversation } from '@/shared/api/types';
import { member } from '../platform-test-fixtures';
import { conversationApi, type ConversationDetails } from '../conversations/conversation-api';
import { useConversationWriteAccess } from './useConversationWriteAccess';
const conversation: Conversation = {
  id: 'private',
  title: '旧聊天',
  kind: 'direct',
  members: [member.id, 'other'],
  ownerId: member.id,
  createdAt: '2026-10-27T08:00:00Z',
  canSend: true,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const detail = (canSend: boolean): ConversationDetails => ({
  conversation: { ...conversation, canSend },
  memberProfiles: [member],
});
afterEach(() => vi.restoreAllMocks());
it('keeps an observed write restriction through old GET and positive management props, recovering only from a new authoritative GET', async () => {
  const old = deferred<ConversationDetails>(),
    fresh = deferred<ConversationDetails>();
  const read = vi
    .spyOn(conversationApi, 'details')
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise)
    .mockResolvedValue(detail(true));
  const denied = vi.fn(),
    view = renderHook(
      ({ value }) => useConversationWriteAccess(member.id, value, undefined, denied),
      { initialProps: { value: conversation } },
    );
  act(() => view.result.current.restrict());
  expect(view.result.current.allowed).toBe(false);
  await act(async () => old.resolve(detail(true)));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(view.result.current.allowed).toBe(false);
  view.rerender({ value: { ...conversation, canSend: true } });
  expect(view.result.current.allowed).toBe(false);
  await act(async () => fresh.resolve(detail(false)));
  expect(view.result.current.allowed).toBe(false);
  expect(denied).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(view.result.current.allowed).toBe(true));
});
it('does not apply a late permission restoration after an authentication epoch changes', async () => {
  const old = deferred<ConversationDetails>();
  vi.spyOn(conversationApi, 'details').mockReturnValue(old.promise);
  const { result } = renderHook(() =>
    useConversationWriteAccess(member.id, { ...conversation, canSend: false }, undefined, vi.fn()),
  );
  advanceAccountEpoch();
  await act(async () => old.resolve(detail(true)));
  expect(result.current.allowed).toBe(false);
});
