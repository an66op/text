import { UserPlus, Users } from 'lucide-react';
import { useSocialActions } from './useSocialActions';
export default function ContactWelcome({
  groups,
  onAddFriend,
}: {
  groups: number;
  onAddFriend: () => void;
}) {
  const { friends, tags } = useSocialActions();
  return (
    <div className="im-contact-welcome">
      <span className="im-welcome-symbol">
        <Users size={40} />
      </span>
      <h2>每一份连接，都值得珍惜</h2>
      <p>
        找到朋友，开始聊天。
        <br />
        也和志同道合的人，建立新的连接。
      </p>
      <button className="im-primary" onClick={onAddFriend}>
        <UserPlus size={17} />
        添加朋友
      </button>
      <div className="im-contact-stats">
        <span>
          <strong>{friends.length}</strong>朋友
        </span>
        <span>
          <strong>{groups}</strong>群聊
        </span>
        <span>
          <strong>{tags.length}</strong>好友标签
        </span>
      </div>
    </div>
  );
}
