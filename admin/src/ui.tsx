import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  Search,
  X,
} from 'lucide-react';
import { number, safeImageUrl } from './format';

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warning' | 'danger' | 'purple';
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}

export function Avatar({
  name,
  src = '',
  size = 'normal',
}: {
  name: string;
  src?: string;
  size?: 'normal' | 'large';
}) {
  const [failed, setFailed] = useState(false);
  const safeSrc = safeImageUrl(src);
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      <span>{name.trim().slice(0, 1) || '共'}</span>
      {safeSrc && !failed && <img src={safeSrc} alt="" onError={() => setFailed(true)} />}
    </span>
  );
}

export function Notice({
  children,
  tone = 'error',
  onDismiss,
}: {
  children: ReactNode;
  tone?: 'error' | 'success' | 'info';
  onDismiss?: () => void;
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      <div>{children}</div>
      {onDismiss && (
        <button className="icon-button" aria-label="关闭提示" onClick={onDismiss}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export function Loading({ label = '正在加载数据…' }: { label?: string }) {
  return (
    <div className="state-panel" role="status">
      <LoaderCircle className="spin" size={24} />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state-panel">
      <span className="state-icon danger">
        <AlertCircle size={24} />
      </span>
      <h2>暂时无法读取</h2>
      <p role="alert">{message}</p>
      <button className="button" onClick={onRetry}>
        重新加载
      </button>
    </div>
  );
}

export function Empty({
  title = '没有符合条件的记录',
  description = '试试其他搜索词，或清除筛选。',
  icon,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="state-panel">
      {icon && <span className="state-icon">{icon}</span>}
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function SearchForm({
  value,
  placeholder,
  onSearch,
}: {
  value: string;
  placeholder: string;
  onSearch: (query: string) => void;
}) {
  return (
    <form
      className="search-form"
      role="search"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSearch(String(new FormData(event.currentTarget).get('q') || '').trim());
      }}
    >
      <Search size={18} />
      <input
        key={value}
        name="q"
        aria-label={placeholder}
        placeholder={placeholder}
        defaultValue={value}
        maxLength={200}
      />
      <button type="submit">搜索</button>
      {value && (
        <button
          className="icon-button"
          type="button"
          aria-label="清除搜索"
          onClick={() => onSearch('')}
        >
          <X size={15} />
        </button>
      )}
    </form>
  );
}

export function Pagination({
  total,
  offset,
  count,
  limit,
  onChange,
}: {
  total: number;
  offset: number;
  count: number;
  limit: number;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {count ? `${number(offset + 1)}–${number(offset + count)}` : '0'}{' '}
        <span className="muted">/ 共 {number(total)} 条</span>
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="上一页"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ArrowLeft size={17} />
        </button>
        <span>第 {Math.floor(offset / limit) + 1} 页</span>
        <button
          className="icon-button"
          aria-label="下一页"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          <ArrowRight size={17} />
        </button>
      </div>
    </div>
  );
}

export function Dialog({
  title,
  description,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const container = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    container.current?.focus();
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = Array.from(
        container.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) || [],
      );
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === container.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === container.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`dialog${wide ? ' dialog-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={description ? descriptionId : undefined}
        ref={container}
        tabIndex={-1}
      >
        <header className="dialog-heading">
          <div>
            <h2 id={headingId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button className="icon-button" aria-label="关闭详情" disabled={busy} onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function ConfirmAction({
  title,
  description,
  confirmLabel,
  danger = false,
  busy,
  error,
  phrase,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  error: string;
  phrase?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [input, setInput] = useState('');
  return (
    <section className={`confirmation${danger ? ' confirmation-danger' : ''}`} aria-label={title}>
      <h3>{title}</h3>
      <p>{description}</p>
      {phrase && (
        <label className="field">
          输入 <strong>{phrase}</strong> 以确认
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
            disabled={busy}
            aria-label="确认账号标识"
          />
        </label>
      )}
      {error && <Notice>{error}</Notice>}
      <div className="form-actions">
        <button className="button button-quiet" onClick={onCancel} disabled={busy}>
          返回修改
        </button>
        <button
          className={`button ${danger ? 'button-danger' : 'button-primary'}`}
          disabled={busy || (!!phrase && input !== phrase)}
          onClick={onConfirm}
        >
          {busy && <LoaderCircle size={16} className="spin" />}
          {busy ? '正在提交…' : confirmLabel}
        </button>
      </div>
    </section>
  );
}
