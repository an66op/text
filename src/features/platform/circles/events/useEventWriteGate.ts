import { useCallback, useEffect, useRef, useState } from 'react';
export function useEventWriteGate() {
  const [busy, setBusy] = useState(false),
    active = useRef(true),
    token = useRef<symbol | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      token.current = null;
    };
  }, []);
  const acquire = useCallback(() => {
    if (!active.current || token.current) return null;
    const current = Symbol();
    token.current = current;
    setBusy(true);
    return () => {
      if (active.current && token.current === current) {
        token.current = null;
        setBusy(false);
      }
    };
  }, []);
  return { busy, acquire };
}
export type EventWriteGate = ReturnType<typeof useEventWriteGate>;
