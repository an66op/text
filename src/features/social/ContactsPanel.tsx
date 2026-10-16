import { ChevronRight, ShieldCheck, Tag, UserPlus, Users } from 'lucide-react';
import { PersonAvatar } from './Avatars';
import { useSocialActions } from './useSocialActions';
import type { SocialAction } from './types';
type Props = {
  query: string;
  accepted: string[];
  onAction: (dialog: SocialAction) => void;
  onOpenProfile: (id: string) => void;
  onOpenModule: (name: string) => void;
};
export default function ContactsPanel({
  query,
  accepted,
  onAction,
  onOpenProfile,
  onOpenModule,
}: Props) {
  const { friends, notes, requests } = useSocialActions();
  const filteredContacts = friends
    .map((contact) => ({ ...contact, name: notes[contact.id]?.alias || contact.name }))
    .filter((c) => `${c.name} ${c.note}`.toLowerCase().includes(query.toLowerCase()));
  const pendingRequests = requests.filter(
    (request) =>
      request.direction === 'incoming' &&
      request.status === 'pending' &&
      !accepted.includes(request.contactId),
  ).length;
  const letters = [...new Set(filteredContacts.map((friend) => friend.letter))].sort();
  return (
    <div className="im-contacts">
      {!query && (
        <>
          <div className="im-contact-shortcuts">
            <button onClick={() => onAction('newFriends')}>
              <span className="im-shortcut-icon im-orange">
                <UserPlus size={21} />
              </span>
              <span className="im-shortcut-copy">
                <strong>新的朋友</strong>
                <small>
                  {pendingRequests ? `${pendingRequests} 个待处理申请` : '认识新的朋友'}
                </small>
              </span>
              {pendingRequests > 0 && <span className="im-small-dot" />}
              <ChevronRight size={16} />
            </button>
            <button onClick={() => onAction('groups')}>
              <span className="im-shortcut-icon im-green">
                <Users size={21} />
              </span>
              <span className="im-shortcut-copy">
                <strong>群聊</strong>
                <small>同频的人聚在一起</small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button onClick={() => onAction('tags')}>
              <span className="im-shortcut-icon im-blue">
                <Tag size={21} />
              </span>
              <span className="im-shortcut-copy">
                <strong>标签</strong>
                <small>整理你的好友</small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button onClick={() => onOpenModule('圈子')}>
              <span className="im-shortcut-icon im-purple">
                <ShieldCheck size={21} />
              </span>
              <span className="im-shortcut-copy">
                <strong>圈子</strong>
                <small>频道与共同的兴趣</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="im-contact-group-title">
            全部联系人 <span>{friends.length} 位</span>
          </div>
        </>
      )}
      {letters.map((letter) => (
        <section className="im-contact-section" key={letter} aria-label={`${letter} 组联系人`}>
          <h2 className="im-letter" id={`im-letter-${letter}`}>
            {letter}
          </h2>
          <div className="im-contact-section-list">
            {filteredContacts
              .filter((contact) => contact.letter === letter)
              .map((contact) => (
                <button
                  className="im-contact-row"
                  key={contact.id}
                  onClick={() => onOpenProfile(contact.id)}
                >
                  <PersonAvatar avatar={contact.avatar} name={contact.name} />
                  <span>
                    <strong>{contact.name}</strong>
                    <small>{contact.note}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
          </div>
        </section>
      ))}
      {filteredContacts.length === 0 && (
        <div className="im-empty">
          <Users size={30} />
          <p>没有找到这个联系人</p>
        </div>
      )}
      <div className="im-contact-index">
        {letters.map((letter) => (
          <button
            key={letter}
            aria-label={`跳到 ${letter} 组联系人`}
            onClick={() =>
              document
                .getElementById(`im-letter-${letter}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            }
          >
            {letter}
          </button>
        ))}
      </div>
      <div className="im-list-end">{friends.length} 位联系人</div>
    </div>
  );
}
