import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Search, ShieldCheck } from 'lucide-react';
import PageHeader from '@/shared/ui/PageHeader';
import { apiErrorMessage } from '@/shared/api/client';
import { paths } from '@/shared/config/paths';
import { useAuth } from '../useAuth';
import { LoginNotice, PlatformAvatar, PlatformError } from '../PlatformUi';
import { useContactScope } from './contact-scope';
import { privacyApi } from './privacy-api';
import { privacyReadEpoch } from './operation-registry';
import { usePrivacyOperation } from './usePrivacyOperation';
import type { BlockList } from './types';
import BlockActions, { BlockOperationNotice } from './BlockActions';
import './privacy-blocks.css';

export default function RealBlockedContactsPage() {
  const auth = useAuth(),
    { scope } = useContactScope();
  return (
    <section className="settings-page privacy-blocked-page">
      <PageHeader title="黑名单" backTo="/settings/privacy" />
      {auth.status === 'checking' ? (
        <p role="status" className="privacy-block-hint">
          正在验证账号…
        </p>
      ) : auth.status === 'unavailable' ? (
        <div className="settings-content">
          <PlatformError
            message={auth.error || '账号服务暂时不可用'}
            retry={() => void auth.refresh()}
          />
        </div>
      ) : auth.status === 'authenticated' && auth.user ? (
        <BlockedList key={scope} scope={scope} />
      ) : (
        <div className="settings-content">
          <LoginNotice returnTo="/settings/blocked" text="登录后管理当前账号的黑名单" />
        </div>
      )}
    </section>
  );
}
function BlockedList({ scope }: { scope: string }) {
  const { valid } = useContactScope(),
    guard = useRef(valid);
  guard.current = valid;
  const operation = usePrivacyOperation(scope),
    epoch = privacyReadEpoch(scope);
  const [data, setData] = useState<BlockList | null>(null),
    [query, setQuery] = useState(''),
    [q, setQ] = useState(''),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const request = new AbortController(),
      readEpoch = privacyReadEpoch(scope);
    setLoading(true);
    setError('');
    setData(null);
    void privacyApi
      .blocks({ q, offset, limit: 20 }, request.signal)
      .then((result) => {
        if (request.signal.aborted || !guard.current() || privacyReadEpoch(scope) !== readEpoch)
          return;
        if (offset && result.total <= offset) {
          setOffset(Math.max(0, Math.floor(Math.max(0, result.total - 1) / 20) * 20));
          return;
        }
        setData(result);
      })
      .catch((caught) => {
        if (!request.signal.aborted && guard.current() && privacyReadEpoch(scope) === readEpoch)
          setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!request.signal.aborted && guard.current() && privacyReadEpoch(scope) === readEpoch)
          setLoading(false);
      });
    return () => request.abort();
  }, [scope, q, offset, refresh, epoch]);
  useEffect(() => {
    const changed = () => setRefresh((value) => value + 1);
    window.addEventListener('gongming:privacy-changed', changed);
    const focus = () => {
      if (!document.hidden) changed();
    };
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('gongming:privacy-changed', changed);
      window.removeEventListener('focus', focus);
    };
  }, []);
  const search = (event: FormEvent) => {
    event.preventDefault();
    setOffset(0);
    setQ(query.trim());
    setRefresh((value) => value + 1);
  };
  return (
    <div className="settings-content privacy-blocked-content">
      <p className="privacy-block-hint">
        仅你可以查看和管理此名单。拉黑保留好友关系与聊天历史，共同空间仍按原有权限互动。
      </p>
      <form className="privacy-block-search" onSubmit={search}>
        <Search size={17} />
        <input
          aria-label="搜索账号黑名单"
          placeholder="搜索姓名、用户名或账号"
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit">搜索</button>
      </form>
      <BlockOperationNotice scope={scope} />
      <PlatformError message={error} retry={() => setRefresh((value) => value + 1)} />
      {loading ? (
        <p role="status" className="privacy-block-hint">
          正在读取当前账号的黑名单…
        </p>
      ) : (
        data && (
          <>
            <p className="privacy-block-count">
              {q ? '搜索结果' : '已拉黑'} · {data.total}
            </p>
            {data.items.length ? (
              <div className="settings-card">
                {data.items.map((entry) => (
                  <article className="privacy-block-row" key={entry.userId}>
                    <div className="privacy-block-person">
                      {entry.available && entry.user ? (
                        <>
                          <PlatformAvatar user={entry.user} />
                          <div>
                            <strong>{entry.user.name}</strong>
                            <small>@{entry.user.handle}</small>
                          </div>
                        </>
                      ) : (
                        <>
                          <ShieldCheck size={26} />
                          <div>
                            <strong>暂不可用的账号</strong>
                            <small>{entry.userId}</small>
                          </div>
                        </>
                      )}
                    </div>
                    <BlockActions
                      userId={entry.userId}
                      person={entry.available ? entry.user : null}
                      showOperationStatus={false}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <div className="privacy-block-empty">
                <ShieldCheck size={32} />
                <h2>{q ? '未找到匹配的账号' : '黑名单为空'}</h2>
                <p>你可以在成员资料或私聊信息中管理拉黑状态。</p>
              </div>
            )}
            <nav className="privacy-block-pagination" aria-label="黑名单分页">
              <button
                type="button"
                disabled={offset === 0 || loading || operation.phase === 'pending'}
                onClick={() => setOffset((value) => Math.max(0, value - 20))}
              >
                上一页
              </button>
              <span>第 {Math.floor(offset / 20) + 1} 页</span>
              <button
                type="button"
                disabled={offset + 20 >= data.total || loading || operation.phase === 'pending'}
                onClick={() => setOffset((value) => value + 20)}
              >
                下一页
              </button>
            </nav>
          </>
        )
      )}
      <Link className="privacy-block-link" to={paths.contacts}>
        前往通讯录
      </Link>
    </div>
  );
}
