import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, Cloud, RefreshCw } from 'lucide-react';
import PageHeader from '@/shared/ui/PageHeader';
import { apiRequest, apiErrorMessage, isAbort } from '@/shared/api/client';
import { useAuth } from '@/features/platform/useAuth';
import { LoginNotice, PlatformError } from '@/features/platform/PlatformUi';
import {
  localSnapshot,
  readDocumentList,
  restoreDocuments,
  syncDomains,
  validateDocument,
  type PersonalDocument,
} from './sync-model';
import './sync.css';

type Review = { kind: 'upload' | 'restore'; documents: PersonalDocument[]; userId: string };
export default function AccountSyncPage() {
  const { user } = useAuth();
  return <AccountSyncForUser key={user?.id ?? 'guest'} />;
}

function AccountSyncForUser() {
  const { user } = useAuth();
  const userId = user?.id;
  const [documents, setDocuments] = useState<PersonalDocument[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generation, setGeneration] = useState(0);
  const currentUser = useRef(user?.id);
  const saving = useRef(false);
  currentUser.current = user?.id;
  useEffect(() => {
    currentUser.current = userId;
    return () => {
      currentUser.current = undefined;
    };
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void apiRequest<unknown>('/documents', { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted || currentUser.current !== userId) return;
        setDocuments(readDocumentList(value));
      })
      .catch((caught) => {
        if (!controller.signal.aborted && currentUser.current === userId && !isAbort(caught)) {
          setDocuments([]);
          setLoadError(apiErrorMessage(caught));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId, generation]);
  const prepare = (kind: Review['kind']) => {
    if (!user || !selected.length || loading || loadError || busy) return;
    setError('');
    setMessage('');
    try {
      const previews = selected.map((key) => {
        const existing = documents.find((entry) => entry.key === key);
        const label = syncDomains.find((entry) => entry.key === key)!.label;
        if (kind === 'restore') {
          if (!existing) throw new Error(`${label}还没有账号备份`);
          validateDocument(existing);
          return existing;
        }
        const value = localSnapshot(key);
        if (!value) throw new Error(`${label}还没有本机数据，取消该项后继续`);
        return { key, value, revision: existing?.revision ?? 0, updatedAt: '' };
      });
      setReview({ kind, documents: previews, userId: user.id });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };
  const confirm = async () => {
    if (!review || saving.current || review.userId !== user?.id) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const plan = review;
    let completed = 0;
    try {
      if (plan.kind === 'restore') {
        restoreDocuments(plan.documents);
        completed = plan.documents.length;
      } else {
        for (const document of plan.documents) {
          if (currentUser.current !== plan.userId) return;
          await apiRequest<PersonalDocument>(`/documents/${encodeURIComponent(document.key)}`, {
            method: 'PUT',
            body: JSON.stringify({ value: document.value, revision: document.revision }),
          });
          completed += 1;
        }
      }
      if (currentUser.current !== plan.userId) return;
      setMessage(
        `${completed} 项${plan.kind === 'restore' ? '已恢复到这台设备' : '已备份到当前账号'}`,
      );
    } catch (caught) {
      if (currentUser.current === plan.userId)
        setError(
          `${apiErrorMessage(caught)}${completed ? `；已有 ${completed} 项完成。` : '。'}将重新读取账号版本，请检查后再操作。`,
        );
    } finally {
      saving.current = false;
      if (currentUser.current === plan.userId) {
        setReview(null);
        setLoading(true);
        setGeneration((value) => value + 1);
        setBusy(false);
      }
    }
  };
  return (
    <section className="sync-page">
      <PageHeader
        title="个人备份"
        backTo="/account"
        action={
          <button
            aria-label="刷新账号备份"
            disabled={busy || loading}
            onClick={() => {
              setReview(null);
              setGeneration((value) => value + 1);
            }}
          >
            <RefreshCw size={19} />
          </button>
        }
      />
      <div className="sync-content">
        <section className="sync-intro">
          <span>
            <Cloud size={24} />
          </span>
          <h1>把喜欢带在身边</h1>
          <p>选择要备份的个人数据，换一台设备也能接着开始。</p>
        </section>
        {!user ? (
          <LoginNotice returnTo="/account/sync" text="登录后管理你的个人备份" />
        ) : (
          <>
            <div className="sync-current-account">
              当前账号 <strong>@{user.handle}</strong>
              <span>{loading ? '正在读取…' : '手动备份'}</span>
            </div>
            <PlatformError
              message={[error, loadError].filter(Boolean).join(' ')}
              retry={loadError ? () => setGeneration((value) => value + 1) : undefined}
            />
            {message && (
              <p className="sync-success" role="status">
                <Check size={17} />
                {message}
              </p>
            )}
            <div className="sync-domains">
              {syncDomains.map((domain) => {
                const remote = documents.find((entry) => entry.key === domain.key);
                return (
                  <label key={domain.key}>
                    <input
                      type="checkbox"
                      checked={selected.includes(domain.key)}
                      disabled={busy || !!review || loading || !!loadError}
                      onChange={() =>
                        setSelected((previous) =>
                          previous.includes(domain.key)
                            ? previous.filter((key) => key !== domain.key)
                            : [...previous, domain.key],
                        )
                      }
                    />
                    <div>
                      <strong>{domain.label}</strong>
                      <small>{domain.detail}</small>
                    </div>
                    <span>
                      {remote ? `版本 ${remote.revision}` : '未备份'}
                      <small>
                        {remote
                          ? new Date(remote.updatedAt).toLocaleDateString('zh-CN')
                          : '等待首次保存'}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="sync-actions">
              <button
                disabled={!selected.length || loading || busy || !!review || !!loadError}
                onClick={() => prepare('upload')}
              >
                <ArrowUpFromLine size={18} />
                备份所选
              </button>
              <button
                disabled={!selected.length || loading || busy || !!review || !!loadError}
                onClick={() => prepare('restore')}
              >
                <ArrowDownToLine size={18} />
                恢复所选
              </button>
            </div>
            {review && (
              <section className="sync-review" aria-label="确认个人备份操作">
                <h2>{review.kind === 'upload' ? '确认备份到账号' : '确认恢复到这台设备'}</h2>
                <p>
                  {review.kind === 'upload'
                    ? '所选本机内容将替换当前账号对应的备份。'
                    : '所选账号备份将替换这台设备的对应内容，包括原有本机内容。'}
                </p>
                <ul>
                  {review.documents.map((entry) => (
                    <li key={entry.key}>
                      {syncDomains.find((domain) => domain.key === entry.key)?.label}
                      <span>
                        {review.kind === 'upload'
                          ? `账号版本 ${entry.revision} → ${entry.revision + 1}`
                          : `来自账号版本 ${entry.revision}`}
                      </span>
                    </li>
                  ))}
                </ul>
                <button className="sync-confirm" disabled={busy} onClick={() => void confirm()}>
                  {busy ? '正在保存…' : '确认执行'}
                </button>
                <button className="sync-cancel" disabled={busy} onClick={() => setReview(null)}>
                  取消
                </button>
              </section>
            )}
          </>
        )}
        <p className="sync-disclosure">
          备份仅在你确认后上传。每份最多
          128KB，更新冲突时保留账号新版本。账号之间独立保存；恢复后会影响当前浏览器中的本机演示内容。
        </p>
      </div>
    </section>
  );
}
