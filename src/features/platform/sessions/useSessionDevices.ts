import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import { sessionApi } from './session-api';
import type { SessionDevice } from './session-types';

export type SessionRemoval = { kind: 'one'; device: SessionDevice } | { kind: 'others' };
export function useSessionDevices(userId: string, onCurrentRevoked: () => Promise<void>) {
  const [items, setItems] = useState<SessionDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [message, setMessage] = useState('');
  const [currentRevoked, setCurrentRevoked] = useState(false);
  const onRevoked = useRef(onCurrentRevoked);
  onRevoked.current = onCurrentRevoked;
  const refreshRef = useRef<() => void>(() => {});
  const revokeRef = useRef<(target: SessionRemoval) => Promise<boolean>>(async () => false);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let dirty = false;
    let revoked = false;
    let timer = 0;
    let read: AbortController | null = null;
    let mutation: AbortController | null = null;
    let channel: BroadcastChannel | null = null;
    setItems([]);
    setLoading(true);
    setRefreshing(false);
    setError('');
    setBusy(false);
    setMutationError('');
    setMessage('');
    setCurrentRevoked(false);
    const schedule = () => {
      if (active && !revoked) timer = window.setTimeout(poll, 30000);
    };
    const load = async () => {
      if (!active || revoked || read || mutation) return;
      window.clearTimeout(timer);
      dirty = false;
      const controller = new AbortController();
      read = controller;
      setRefreshing(true);
      const current = generation;
      try {
        const result = await sessionApi.list(controller.signal);
        if (active && !controller.signal.aborted && current === generation) {
          setItems(result.items);
          setError('');
        }
      } catch (caught) {
        if (active && current === generation && !controller.signal.aborted && !isAbort(caught))
          setError(apiErrorMessage(caught));
      } finally {
        if (read === controller) {
          read = null;
          if (active) {
            if (current === generation) {
              setLoading(false);
              setRefreshing(false);
            }
            if (dirty) void load();
            else schedule();
          }
        }
      }
    };
    const poll = () => {
      if (document.hidden) schedule();
      else void load();
    };
    const refresh = () => {
      if (!active || revoked) return;
      dirty = true;
      void load();
    };
    const visible = () => {
      if (!document.hidden) refresh();
    };
    const notify = () => {
      try {
        channel?.postMessage({ type: 'devices.changed', userId });
      } catch {
        // Focus and visible polling still reconcile devices without cross-tab messaging.
      }
    };
    revokeRef.current = async (target) => {
      if (!active || mutation || revoked) return false;
      window.clearTimeout(timer);
      generation += 1;
      read?.abort();
      read = null;
      setRefreshing(false);
      dirty = false;
      const controller = new AbortController();
      mutation = controller;
      const current = generation;
      const valid = () => active && !controller.signal.aborted && current === generation;
      setBusy(true);
      setMutationError('');
      setMessage('');
      try {
        if (target.kind === 'one') {
          const result = await sessionApi.revoke(target.device.id, controller.signal);
          if (!valid()) return false;
          if (result.ok !== true || typeof result.current !== 'boolean')
            throw new Error('服务尚未确认设备已撤销，请刷新后重试');
          if (result.current) {
            revoked = true;
            setCurrentRevoked(true);
            setItems([]);
            setMessage('当前设备已撤销，正在重新验证账号…');
            notify();
            await onRevoked.current();
          } else {
            setItems((previous) => previous.filter((item) => item.id !== target.device.id));
            setMessage(
              `已撤销 ${target.device.legacy ? '旧会话' : target.device.device || '未知设备'}`,
            );
            notify();
          }
        } else {
          const result = await sessionApi.revokeOthers(controller.signal);
          if (!valid()) return false;
          if (!Number.isInteger(result.revoked) || result.revoked < 0)
            throw new Error('服务尚未确认其它设备已撤销，请刷新后重试');
          setItems((previous) => previous.filter((item) => item.current));
          setMessage(`已撤销 ${result.revoked} 个其它登录设备，当前设备已保留`);
          notify();
        }
        return valid();
      } catch (caught) {
        if (valid() && !isAbort(caught)) setMutationError(apiErrorMessage(caught));
        return false;
      } finally {
        if (mutation === controller) {
          mutation = null;
          if (active) {
            setBusy(false);
            setLoading(false);
            if (!revoked) void load();
          }
        }
      }
    };
    refreshRef.current = refresh;
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    if (typeof BroadcastChannel === 'function') {
      try {
        channel = new BroadcastChannel('gongming-devices');
        channel.onmessage = (event: MessageEvent<unknown>) => {
          const value = event.data;
          if (
            value &&
            typeof value === 'object' &&
            'type' in value &&
            value.type === 'devices.changed' &&
            'userId' in value &&
            value.userId === userId
          )
            refresh();
        };
      } catch {
        channel = null;
      }
    }
    void load();
    return () => {
      active = false;
      generation += 1;
      window.clearTimeout(timer);
      read?.abort();
      mutation?.abort();
      channel?.close();
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      refreshRef.current = () => {};
      revokeRef.current = async () => false;
    };
  }, [userId]);
  const refresh = useCallback(() => refreshRef.current(), []);
  const revoke = useCallback((target: SessionRemoval) => revokeRef.current(target), []);
  return {
    items,
    loading,
    refreshing,
    error,
    busy,
    mutationError,
    message,
    currentRevoked,
    refresh,
    revoke,
  };
}
