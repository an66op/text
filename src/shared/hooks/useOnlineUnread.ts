import { useEffect, useState } from 'react';
import { useAuth } from '@/features/platform/useAuth';
import { apiRequest } from '@/shared/api/client';

export function useOnlineUnread(localUnread: number) {
  const { user } = useAuth();
  const userId = user?.id;
  const [state, setState] = useState({ userId: '', count: 0 });
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let busy = false;
    let again = false;
    let timer = 0;
    let controller: AbortController | null = null;
    const load = async () => {
      if (!active || document.hidden) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      controller = new AbortController();
      window.clearTimeout(timer);
      try {
        const result = await apiRequest<{ unreadTotal: number }>('/conversations?limit=1', {
          signal: controller.signal,
        });
        if (
          active &&
          !controller.signal.aborted &&
          Number.isSafeInteger(result.unreadTotal) &&
          result.unreadTotal >= 0
        )
          setState({ userId, count: result.unreadTotal });
      } catch {
        /* Keep the last server count while the message view explains connection errors. */
      } finally {
        busy = false;
        if (active) {
          if (again) {
            again = false;
            timer = window.setTimeout(() => void load(), 200);
          } else timer = window.setTimeout(() => void load(), 15000);
        }
      }
    };
    const refresh = () => {
      if (!document.hidden) void load();
    };
    void load();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('gongming:conversations-changed', refresh);
    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('gongming:conversations-changed', refresh);
    };
  }, [userId]);
  return userId ? (state.userId === userId ? state.count : 0) : localUnread;
}
