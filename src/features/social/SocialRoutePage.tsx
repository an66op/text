import { useParams } from 'react-router';
import { ContactEditPage, ContactPage } from './ContactPages';
import { FriendApplyPage, FriendRequestsPage, FriendSearchPage } from './FriendPages';
import { GroupsPage, GroupCreatePage, ChatInfoPage } from './GroupPages';
import { GroupMembersPage, GroupInvitePage, GroupNoticePage } from './GroupMemberPages';
import { TagsPage, TagEditorPage } from './TagPages';
import { ChatSearchPage, MessageDetailPage } from './MessagePages';
import CallPage from './CallPage';
import type { SocialRouteKind } from './routes';

export default function SocialRoutePage({ kind }: { kind: SocialRouteKind }) {
  const params = useParams();
  const key = [
    kind,
    params.contactId,
    params.conversationId,
    params.tagId,
    params.messageId,
    params.callMode,
  ].join('/');
  const pages = {
    friendSearch: <FriendSearchPage />,
    friendRequests: <FriendRequestsPage />,
    friendApply: <FriendApplyPage />,
    contact: <ContactPage />,
    contactEdit: <ContactEditPage />,
    groups: <GroupsPage />,
    groupCreate: <GroupCreatePage />,
    chatInfo: <ChatInfoPage />,
    groupMembers: <GroupMembersPage />,
    groupInvite: <GroupInvitePage />,
    groupNotice: <GroupNoticePage />,
    tags: <TagsPage />,
    tagCreate: <TagEditorPage creating />,
    tagDetail: <TagEditorPage />,
    call: <CallPage />,
    message: <MessageDetailPage />,
    chatSearch: <ChatSearchPage />,
  };
  return (
    <div key={key} className="im-route-page">
      {pages[kind]}
    </div>
  );
}
