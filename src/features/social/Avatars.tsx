import { FolderOpen } from 'lucide-react';
import { contacts, suggestedContacts, avatarUrl } from './fixtures';
import type { Conversation } from './types';

export function PersonAvatar({
  avatar,
  name,
  className = '',
  image,
}: {
  avatar?: number;
  name: string;
  className?: string;
  image?: string;
}) {
  return image ? (
    <img className={`im-avatar ${className}`} src={image} alt={`${name}头像`} />
  ) : avatar ? (
    <img className={`im-avatar ${className}`} src={avatarUrl(avatar)} alt={`${name}头像`} />
  ) : (
    <span className={`im-avatar im-letter-avatar ${className}`}>{name.slice(0, 1)}</span>
  );
}
export function ConversationAvatar({ conversation }: { conversation: Conversation }) {
  if (conversation.kind === 'file')
    return (
      <span className="im-avatar im-file-avatar">
        <FolderOpen size={25} />
      </span>
    );
  if (conversation.kind === 'group')
    return (
      <span className="im-avatar im-group-avatar">
        {(conversation.members || []).slice(0, 4).map((id) => {
          const c = [...contacts, ...suggestedContacts].find((person) => person.id === id);
          return <img key={id} src={avatarUrl(c?.avatar || 12)} alt="" />;
        })}
      </span>
    );
  return <PersonAvatar avatar={conversation.avatar} name={conversation.name} />;
}
