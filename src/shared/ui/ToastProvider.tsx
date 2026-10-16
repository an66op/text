import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { ToastContext } from './toast-context';
// Hooks import the shared context independently of this refreshable component.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(''), 2800);
  }, []);
  useEffect(() => {
    const storageError = () => notify('本地存储空间不足，本次修改暂未保存');
    window.addEventListener('app:storage-error', storageError);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('app:storage-error', storageError);
    };
  }, [notify]);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {message && (
        <div role="status" className="toast">
          <Check size={17} />
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
