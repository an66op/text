import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Search, UserRoundPlus, X } from 'lucide-react';
import { Link } from 'react-router';
import { PlatformAvatar, PlatformError } from '@/features/platform/PlatformUi';
import { paths } from '@/shared/config/paths';
import { friendshipApi } from './friendship-api';
import type { Friend } from './friendship-types';
import { useFriendshipList } from './useFriendshipList';

const friendKey = (friend: Friend) => friend.user.id;
export default function FriendsPanel({ onDiscover }: { onDiscover: () => void }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  return (
    <>
      <label className="people-search">
        <Search size={17} />
        <input
          aria-label="搜索好友"
          placeholder="搜索好友名字或共鸣号"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button type="button" aria-label="清空好友搜索" onClick={() => setQuery('')}>
            <X size={15} />
          </button>
        )}
      </label>
      <FriendResults key={search} search={search} onDiscover={onDiscover} />
    </>
  );
}

function FriendResults({ search, onDiscover }: { search: string; onDiscover: () => void }) {
  const load = useCallback(
    (offset: number, signal: AbortSignal) => friendshipApi.friends(search, offset, signal),
    [search],
  );
  const list = useFriendshipList(load, friendKey);
  return (
    <section aria-label="我的好友">
      <div className="people-directory-heading">
        <span>
          我的好友 <small>{list.loading && !list.items.length ? '…' : list.total}</small>
        </span>
        <button className="friendship-text-button" type="button" onClick={onDiscover}>
          <UserRoundPlus size={13} />
          发现成员
        </button>
      </div>
      <PlatformError message={list.error} retry={list.refresh} />
      {list.loading && !list.items.length ? (
        <p className="people-empty" role="status">
          正在读取好友…
        </p>
      ) : list.items.length ? (
        <div className="people-list friendship-friends-list">
          {list.items.map(({ user, since }) => (
            <Link key={user.id} to={paths.user(user.handle)}>
              <PlatformAvatar user={user} />
              <div>
                <strong>{user.name}</strong>
                <small>@{user.handle}</small>
                <p>{user.bio || `相识于 ${new Date(since).toLocaleDateString('zh-CN')}`}</p>
              </div>
              <ChevronRight size={17} />
            </Link>
          ))}
        </div>
      ) : (
        !list.error && (
          <div className="people-empty">
            <UserRoundPlus size={32} strokeWidth={1.4} />
            <h2>{search ? '没有找到这位好友' : '新的友情，从一句问候开始'}</h2>
            <p>
              {search ? '试试其他名字或共鸣号。' : '在发现中认识成员，互相确认后就会出现在这里。'}
            </p>
            <button className="friendship-soft-button" type="button" onClick={onDiscover}>
              去发现成员
            </button>
          </div>
        )
      )}
      {list.items.length < list.total && !list.error && (
        <button
          className="people-load-more"
          type="button"
          disabled={list.loading}
          onClick={list.more}
        >
          {list.loading ? '正在加载…' : '更多好友'}
        </button>
      )}
    </section>
  );
}
