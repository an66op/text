import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, Search, UserRound, UsersRound, X } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/features/platform/useAuth';
import SocialPage from '@/features/social/SocialPage';
import AppTopbar from '@/shared/ui/AppTopbar';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import { LoginNotice, PlatformAvatar, PlatformError } from '@/features/platform/PlatformUi';
import type { PublicUser } from '@/shared/api/types';
import { paths } from '@/shared/config/paths';
import { peopleApi } from './people-api';
import './people.css';

export default function ContactsPage() {
  const { user, status, error, refresh } = useAuth();
  if (status === 'checking')
    return (
      <div className="route-status" role="status">
        正在验证账号…
      </div>
    );
  if (status === 'unavailable')
    return (
      <section className="people-directory">
        <AppTopbar title="通讯录" />
        <div className="people-directory-content">
          <PlatformError message={error || '账号服务暂时无法连接'} retry={() => void refresh()} />
          <LoginNotice returnTo={paths.contacts} />
          <Link to={paths.localContacts}>查看本机通讯录演示</Link>
        </div>
      </section>
    );
  return user ? <MemberDirectory key={user.id} /> : <SocialPage view="通讯录" />;
}

function MemberDirectory() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
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
    setBusy(true);
    setError('');
    void peopleApi
      .directory(search, offset, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setPeople((previous) =>
          offset
            ? [
                ...previous.filter(
                  (person) => !result.items.some((entry) => entry.id === person.id),
                ),
                ...result.items,
              ]
            : result.items,
        );
        setTotal(result.total);
      })
      .catch((caught) => {
        if (!controller.signal.aborted && current === generation.current && !isAbort(caught)) {
          setError(apiErrorMessage(caught));
          if (!offset) setPeople([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current) setBusy(false);
      });
    return () => {
      controller.abort();
      generation.current += 1;
    };
  }, [search, offset, revision]);
  return (
    <section className="people-directory">
      <AppTopbar
        title="通讯录"
        actions={
          <Link to={paths.account} aria-label="我的共鸣资料">
            <UserRound size={21} />
          </Link>
        }
      />
      <div className="people-directory-content">
        <label className="people-search">
          <Search size={17} />
          <input
            aria-label="搜索社区成员"
            value={query}
            placeholder="搜索名字或共鸣号"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button aria-label="清空成员搜索" onClick={() => setQuery('')}>
              <X size={15} />
            </button>
          )}
        </label>
        <div className="people-directory-heading">
          <span>
            社区成员 <small>{busy && !people.length ? '…' : total}</small>
          </span>
          <Link to={paths.localContacts}>
            本机通讯录 <ArrowUpRight size={12} />
          </Link>
        </div>
        <PlatformError message={error} retry={() => setRevision((value) => value + 1)} />
        {busy && !people.length ? (
          <div className="people-empty" role="status">
            正在寻找你的同频伙伴…
          </div>
        ) : people.length ? (
          <div className="people-list">
            {people.map((person) => (
              <Link key={person.id} to={paths.user(person.handle)}>
                <PlatformAvatar user={person} />
                <div>
                  <strong>
                    {person.name}
                    {person.id === user?.id && <small className="people-self">我</small>}
                  </strong>
                  <small>@{person.handle}</small>
                  {person.bio && <p>{person.bio}</p>}
                </div>
                <ChevronRight size={17} />
              </Link>
            ))}
          </div>
        ) : (
          !error && (
            <div className="people-empty">
              <UsersRound size={33} strokeWidth={1.4} />
              <h2>还没找到这位朋友</h2>
              <p>换个名字，或输入完整的共鸣号试试。</p>
            </div>
          )
        )}
        {people.length < total && !error && (
          <button
            className="people-load-more"
            disabled={busy}
            onClick={() => setOffset(people.length)}
          >
            {busy ? '正在加载…' : '发现更多成员'}
          </button>
        )}
        <p className="people-footnote">这是已加入共鸣的成员目录。点开资料，即可发起私聊。</p>
      </div>
    </section>
  );
}
