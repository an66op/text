import { useEffect, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import type { PublicUser } from '@/shared/api/types';
import { PlatformAvatar, PlatformError } from '../PlatformUi';
import { conversationApi } from './conversation-api';

export default function MemberPicker({
  existingIds,
  busy,
  onAdd,
  onClose,
}: {
  existingIds: string[];
  busy: boolean;
  onAdd: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<PublicUser[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setOffset(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true);
    setError('');
    void conversationApi
      .candidates(search, offset, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setItems((previous) =>
          offset
            ? [
                ...previous.filter((person) => !result.items.some((next) => next.id === person.id)),
                ...result.items,
              ]
            : result.items,
        );
        setTotal(result.total);
      })
      .catch((caught) => {
        if (!controller.signal.aborted && current === generation.current && !isAbort(caught)) {
          setError(apiErrorMessage(caught));
          if (!offset) setItems([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current) setLoading(false);
      });
    return () => {
      controller.abort();
      generation.current += 1;
    };
  }, [search, offset, revision]);
  const visible = items.filter((person) => !existingIds.includes(person.id));
  const chosen = selected.filter((person) => !existingIds.includes(person.id));
  const remaining = 200 - existingIds.length;
  return (
    <section className="conversation-picker" aria-label="选择新成员">
      <div className="conversation-section-heading">
        <h2>添加成员</h2>
        <button type="button" aria-label="收起成员选择" disabled={busy} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <label className="conversation-member-search">
        <Search size={17} />
        <input
          aria-label="查找可添加的成员"
          placeholder="名字或共鸣号"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {chosen.length > 0 && (
        <div className="conversation-selected">
          {chosen.map((person) => (
            <button
              type="button"
              key={person.id}
              disabled={busy}
              aria-label={`取消选择${person.name}`}
              onClick={() =>
                setSelected((previous) => previous.filter((item) => item.id !== person.id))
              }
            >
              {person.name} <X size={11} />
            </button>
          ))}
        </div>
      )}
      <PlatformError message={error} retry={() => setRevision((value) => value + 1)} />
      <div className="conversation-picker-list" aria-busy={loading}>
        {visible.map((person) => {
          const checked = chosen.some((entry) => entry.id === person.id);
          return (
            <label className="conversation-pick-row" key={person.id}>
              <input
                type="checkbox"
                checked={checked}
                disabled={busy || (!checked && chosen.length >= remaining)}
                onChange={() =>
                  setSelected((previous) =>
                    checked
                      ? previous.filter((entry) => entry.id !== person.id)
                      : [...previous, person],
                  )
                }
              />
              <PlatformAvatar user={person} />
              <span>
                <strong>{person.name}</strong>
                <small>@{person.handle}</small>
              </span>
              <i className={checked ? 'is-checked' : ''}>{checked && <Check size={13} />}</i>
            </label>
          );
        })}
        {!loading && !visible.length && !error && (
          <p className="conversation-subtle">当前结果中没有可添加的新成员。</p>
        )}
        {loading && (
          <p role="status" className="conversation-subtle">
            正在查找…
          </p>
        )}
        {items.length < total && !error && (
          <button
            className="conversation-more"
            type="button"
            disabled={loading}
            onClick={() => setOffset(items.length)}
          >
            查看更多成员
          </button>
        )}
      </div>
      <button
        type="button"
        className="conversation-primary"
        disabled={busy || !chosen.length || chosen.length > remaining}
        onClick={() => onAdd(chosen.map((person) => person.id))}
      >
        {busy ? '正在添加…' : `添加${chosen.length ? ` ${chosen.length} 位` : ''}成员`}
      </button>
      <p className="conversation-subtle">最多 200 位成员。新成员加入后可阅读此会话的历史消息。</p>
    </section>
  );
}
