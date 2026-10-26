import { useEffect, useRef } from 'react';
import type { PublicUser } from '@/shared/api/types';
import { PlatformError } from '@/features/platform/PlatformUi';

export default function FriendRemovalDialog({
  person,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  person: PublicUser;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const current = useRef({ busy, onCancel });
  current.current = { busy, onCancel };
  useEffect(() => {
    const previous = document.activeElement;
    cancel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !current.current.busy) current.current.onCancel();
      if (event.key !== 'Tab' || !dialog.current) return;
      const controls = [
        ...dialog.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      ];
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div className="friendship-dialog-backdrop">
      <div
        className="friendship-removal-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="friendship-removal-title"
        aria-describedby="friendship-removal-description"
      >
        <h2 id="friendship-removal-title">移除 {person.name}？</h2>
        <p id="friendship-removal-description">
          确定移除 @{person.handle} 的好友关系吗？你们将不再出现在彼此的好友列表，已有会话会保留。
        </p>
        <PlatformError message={error} />
        <div>
          <button
            ref={cancel}
            className="friendship-secondary"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button className="friendship-danger" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? '正在移除…' : '确认移除'}
          </button>
        </div>
      </div>
    </div>
  );
}
