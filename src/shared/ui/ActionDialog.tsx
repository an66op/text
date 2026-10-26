import { useEffect, useId, useRef, type ReactNode } from 'react';
import './ActionDialog.css';

export default function ActionDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const label = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => {
      if (typeof element.close === 'function') element.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="action-dialog"
      aria-labelledby={label}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id={label}>{title}</h2>
      <div className="action-dialog-copy">{children}</div>
      <div className="action-dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className={danger ? 'is-danger' : 'is-primary'}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? '正在处理…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
