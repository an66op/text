import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { ChevronRight, Search, UserRound } from 'lucide-react';
import PageHeader from '@/shared/ui/PageHeader';
import { paths } from '@/shared/config/paths';
import { PersonAvatar } from './Avatars';
import type { Contact } from './types';

export function SocialPageFrame({
  title,
  backTo = paths.contacts,
  children,
  action,
}: {
  title: string;
  backTo?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="im-page">
      <PageHeader title={title} backTo={backTo} action={action} />
      <div className="im-page-body">{children}</div>
    </section>
  );
}
export function SocialMissing({
  title = '页面不存在',
  backTo = paths.contacts,
}: {
  title?: string;
  backTo?: string;
}) {
  return (
    <SocialPageFrame title={title} backTo={backTo}>
      <div className="im-page-empty">
        <UserRound size={36} />
        <h2>{title}</h2>
        <p>资料可能已经删除，或未保存在当前设备。</p>
        <Link className="im-primary" to={backTo}>
          返回列表
        </Link>
      </div>
    </SocialPageFrame>
  );
}
export function SocialSearch({
  query,
  setQuery,
  placeholder = '搜索',
  label = '搜索',
}: {
  query: string;
  setQuery: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="im-page-search">
      <Search size={18} />
      <input
        aria-label={label}
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </label>
  );
}
export function ContactRows({
  contacts,
  onClick,
  trailing,
}: {
  contacts: Contact[];
  onClick: (contact: Contact) => void;
  trailing?: (contact: Contact) => ReactNode;
}) {
  return (
    <div className="im-page-list">
      {contacts.map((contact) => (
        <button className="im-page-person" key={contact.id} onClick={() => onClick(contact)}>
          <PersonAvatar name={contact.name} avatar={contact.avatar} />
          <span>
            <strong>{contact.name}</strong>
            <small>{contact.note}</small>
          </span>
          {trailing?.(contact) || <ChevronRight size={18} />}
        </button>
      ))}
      {!contacts.length && (
        <div className="im-page-empty">
          <p>暂无联系人</p>
        </div>
      )}
    </div>
  );
}
export function ContactSelection({
  contacts,
  selected,
  onChange,
}: {
  contacts: Contact[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="im-page-list">
      {contacts.map((contact) => (
        <label className="im-page-person" key={contact.id}>
          <PersonAvatar name={contact.name} avatar={contact.avatar} />
          <span>
            <strong>{contact.name}</strong>
            <small>{contact.note}</small>
          </span>
          <input
            type="checkbox"
            aria-label={`选择${contact.name}`}
            checked={selected.includes(contact.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, contact.id]
                  : selected.filter((id) => id !== contact.id),
              )
            }
          />
        </label>
      ))}
    </div>
  );
}
