import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Check, Clock, UserPlus, X } from 'lucide-react';
import { paths } from '@/shared/config/paths';
import { useToast } from '@/shared/ui/useToast';
import { PersonAvatar } from './Avatars';
import { contacts } from './fixtures';
import { socialPaths } from './routes';
import { SocialMissing, SocialPageFrame, SocialSearch, ContactRows } from './SocialPageParts';
import { allContacts, findContact, useSocialActions } from './useSocialActions';
import type { FriendRequest } from './types';

export function FriendSearchPage() {
  const [query, setQuery] = useState('');
  const { accepted } = useSocialActions();
  const navigate = useNavigate();
  const matching = allContacts.filter((contact) =>
    `${contact.name} ${contact.id} ${contact.note}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <SocialPageFrame title="添加朋友">
      <SocialSearch
        query={query}
        setQuery={setQuery}
        label="搜索朋友"
        placeholder="名字 / 社交号"
      />
      <p className="im-page-caption">
        {query ? `${matching.length} 个搜索结果` : '你可能认识 · 连接共同的兴趣'}
      </p>
      <ContactRows
        contacts={matching}
        onClick={(contact) => navigate(socialPaths.contact(contact.id))}
        trailing={(contact) => (
          <small className="im-status">
            {contacts.some((friend) => friend.id === contact.id) || accepted.includes(contact.id)
              ? '已是好友'
              : '查看'}
          </small>
        )}
      />
      {!matching.length && (
        <p className="im-page-caption">试试名字「小满」或社交号「new-reader」。</p>
      )}
    </SocialPageFrame>
  );
}

export function FriendRequestsPage() {
  const { requests, setRequests, accepted, setAccepted, ensureConversation } = useSocialActions();
  const [filter, setFilter] = useState<'incoming' | 'outgoing'>('incoming');
  const notify = useToast();
  function update(request: FriendRequest, status: FriendRequest['status']) {
    const contact = findContact(request.contactId);
    setRequests((current) =>
      current.map((item) => (item.id === request.id ? { ...item, status } : item)),
    );
    if (status === 'accepted' && contact) {
      setAccepted((current) => (current.includes(contact.id) ? current : [...current, contact.id]));
      ensureConversation(contact);
      notify(`已添加 ${contact.name} 为朋友`);
    } else
      notify(
        status === 'rejected' ? '已拒绝申请' : status === 'cancelled' ? '申请已取消' : '已恢复申请',
      );
  }
  const visible = requests.filter((request) => request.direction === filter);
  return (
    <SocialPageFrame
      title="新的朋友"
      action={
        <Link to={socialPaths.friendSearch} aria-label="添加朋友">
          <UserPlus size={21} />
        </Link>
      }
    >
      <div className="im-page-tabs">
        <button
          className={filter === 'incoming' ? 'active' : ''}
          onClick={() => setFilter('incoming')}
        >
          收到的申请
        </button>
        <button
          className={filter === 'outgoing' ? 'active' : ''}
          onClick={() => setFilter('outgoing')}
        >
          发出的申请
        </button>
      </div>
      <div className="im-page-list">
        {visible.map((request) => {
          const contact = findContact(request.contactId);
          if (!contact) return null;
          const status = accepted.includes(contact.id) ? 'accepted' : request.status;
          return (
            <article className="im-request-card" key={request.id}>
              <Link className="im-request-person" to={socialPaths.contact(contact.id)}>
                <PersonAvatar avatar={contact.avatar} name={contact.name} />
                <span>
                  <strong>{contact.name}</strong>
                  <small>{request.date}</small>
                </span>
              </Link>
              <p>{request.greeting}</p>
              {status === 'pending' ? (
                <div className="im-inline-actions">
                  {filter === 'incoming' ? (
                    <>
                      <button className="im-secondary" onClick={() => update(request, 'rejected')}>
                        <X size={16} />
                        拒绝
                      </button>
                      <button className="im-primary" onClick={() => update(request, 'accepted')}>
                        <Check size={16} />
                        接受
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="im-status">
                        <Clock size={15} />
                        等待对方验证
                      </span>
                      <button className="im-secondary" onClick={() => update(request, 'cancelled')}>
                        取消申请
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="im-inline-actions">
                  <span className="im-status">
                    {status === 'accepted' ? '已添加' : status === 'rejected' ? '已拒绝' : '已取消'}
                  </span>
                  {status === 'accepted' ? (
                    <Link className="im-text-link" to={paths.chat(contact.id)}>
                      发消息
                    </Link>
                  ) : (
                    filter === 'incoming' && (
                      <button className="im-text-link" onClick={() => update(request, 'pending')}>
                        恢复申请
                      </button>
                    )
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className="im-page-empty">
          <UserPlus size={36} />
          <h2>暂时没有申请</h2>
          <p>搜索朋友并发送好友申请，会显示在这里。</p>
          <Link className="im-primary" to={socialPaths.friendSearch}>
            添加朋友
          </Link>
        </div>
      )}
    </SocialPageFrame>
  );
}

export function FriendApplyPage() {
  const { contactId } = useParams();
  const contact = findContact(contactId);
  const { requests, setRequests, accepted } = useSocialActions();
  const [greeting, setGreeting] = useState('你好，想和你成为朋友，一起交流我们的热爱。');
  const notify = useToast();
  if (!contact) return <SocialMissing title="朋友不存在" />;
  const pending = requests.find(
    (request) =>
      request.contactId === contact.id &&
      request.direction === 'outgoing' &&
      request.status === 'pending',
  );
  const isFriend =
    contacts.some((friend) => friend.id === contact.id) || accepted.includes(contact.id);
  function apply() {
    if (!greeting.trim()) {
      notify('请填写验证消息');
      return;
    }
    if (!contact || pending || isFriend) return;
    setRequests((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        contactId: contact.id,
        direction: 'outgoing',
        greeting: greeting.trim(),
        status: 'pending',
        date: '刚刚',
      },
    ]);
    notify('好友申请已发送，等待对方验证');
  }
  return (
    <SocialPageFrame title="好友申请" backTo={socialPaths.contact(contact.id)}>
      <div className="im-profile-top">
        <PersonAvatar avatar={contact.avatar} name={contact.name} />
        <div>
          <h2>{contact.name}</h2>
          <p>社交号：{contact.id}</p>
        </div>
      </div>
      {pending || isFriend ? (
        <div className="im-page-result">
          <Check size={38} />
          <h2>{isFriend ? '你们已经是朋友' : '申请已发送'}</h2>
          <p>
            {isFriend
              ? '现在可以开始聊天。'
              : '验证消息已保存在发出的申请中。此原型不会向真实用户发送消息。'}
          </p>
          <Link
            className="im-primary"
            to={isFriend ? paths.chat(contact.id) : socialPaths.friendRequests}
          >
            {isFriend ? '发消息' : '查看申请记录'}
          </Link>
        </div>
      ) : (
        <form
          className="im-page-form"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <label>
            验证消息
            <textarea
              aria-label="验证消息"
              value={greeting}
              maxLength={120}
              rows={4}
              onChange={(event) => setGreeting(event.target.value)}
            />
          </label>
          <small>{greeting.length} / 120</small>
          <p className="im-page-caption">发送后可在「新的朋友」查看并取消申请。</p>
          <button className="im-primary im-wide" type="submit">
            发送申请
          </button>
        </form>
      )}
    </SocialPageFrame>
  );
}
