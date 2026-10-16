import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { ProfileProvider } from '@/features/profile/profile-store';
import { SocialProvider } from './SocialProvider';
import SocialRoutePage from './SocialRoutePage';
import SocialHub from './SocialHub';
import type { SocialRouteKind } from './routes';
import type { Conversation, FriendRequest, ChatMessage } from './types';

const routeCases: [string, SocialRouteKind][] = [
  ['/contacts/search', 'friendSearch'],
  ['/contacts/requests', 'friendRequests'],
  ['/contacts/add/:contactId', 'friendApply'],
  ['/contacts/:contactId/edit', 'contactEdit'],
  ['/contacts/:contactId', 'contact'],
  ['/social/groups', 'groups'],
  ['/social/groups/new', 'groupCreate'],
  ['/social/chat/:conversationId/info', 'chatInfo'],
  ['/social/chat/:conversationId/members', 'groupMembers'],
  ['/social/chat/:conversationId/invite', 'groupInvite'],
  ['/social/chat/:conversationId/notice', 'groupNotice'],
  ['/social/chat/:conversationId/search', 'chatSearch'],
  ['/social/chat/:conversationId/call/:callMode', 'call'],
  ['/social/chat/:conversationId/message/:messageId', 'message'],
  ['/contacts/tags', 'tags'],
  ['/contacts/tags/new', 'tagCreate'],
  ['/contacts/tags/:tagId', 'tagDetail'],
];
function Probe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location">{location.pathname}</output>
      <output data-testid="route-state">{JSON.stringify(location.state)}</output>
    </>
  );
}
function renderAt(path: string) {
  return render(
    <ToastProvider>
      <ProfileProvider>
        <SocialProvider>
          <MemoryRouter initialEntries={[path]}>
            <Probe />
            <Routes>
              {routeCases.map(([route, kind]) => (
                <Route key={route} path={route} element={<SocialRoutePage kind={kind} />} />
              ))}
              <Route
                path="/social/chat/:conversationId"
                element={<SocialHub profileName="测试用户" onOpenModule={() => {}} />}
              />
              <Route
                path="/contacts"
                element={
                  <SocialHub initialView="通讯录" profileName="测试用户" onOpenModule={() => {}} />
                }
              />
            </Routes>
          </MemoryRouter>
        </SocialProvider>
      </ProfileProvider>
    </ToastProvider>,
  );
}
const savedConversations = () =>
  JSON.parse(localStorage.getItem('social-conversations') || '[]') as Conversation[];
const savedMessages = () =>
  JSON.parse(localStorage.getItem('social-messages') || '{}') as Record<string, ChatMessage[]>;

describe('routed social workflows', () => {
  beforeEach(() => localStorage.clear());

  it('accepts a request, persists it and adds the actual friend to contacts after remount', () => {
    const view = renderAt('/contacts/requests');
    fireEvent.click(screen.getAllByRole('button', { name: '接受' })[0]);
    expect(JSON.parse(localStorage.getItem('social-accepted') || '[]')).toContain('new-designer');
    expect(savedConversations().some((conversation) => conversation.id === 'new-designer')).toBe(
      true,
    );
    view.unmount();
    renderAt('/contacts');
    expect(screen.getByRole('button', { name: /小满.*来自灵感研究所/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('persists an outgoing application without adding a friend or allowing duplicate sends', () => {
    const view = renderAt('/contacts/add/new-reader');
    fireEvent.change(screen.getByRole('textbox', { name: '验证消息' }), {
      target: { value: '我们一起读书吧' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送申请' }));
    const requests = JSON.parse(localStorage.getItem('social-requests') || '[]') as FriendRequest[];
    expect(requests.filter((request) => request.contactId === 'new-reader')).toEqual([
      expect.objectContaining({
        direction: 'outgoing',
        status: 'pending',
        greeting: '我们一起读书吧',
      }),
    ]);
    expect(savedConversations().some((conversation) => conversation.id === 'new-reader')).toBe(
      false,
    );
    expect(screen.getByRole('heading', { name: '申请已发送' })).toBeInTheDocument();
    view.unmount();
    renderAt('/contacts/add/new-reader');
    expect(screen.queryByRole('button', { name: '发送申请' })).not.toBeInTheDocument();
  });

  it('saves a contact alias, description and tag membership and renders them on the routed profile', () => {
    renderAt('/contacts/lin/edit');
    fireEvent.change(screen.getByRole('textbox', { name: '备注名' }), {
      target: { value: '周末搭子' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '备注描述' }), {
      target: { value: '海边徒步认识' },
    });
    fireEvent.click(screen.getByLabelText('设计同行'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/contacts/lin');
    expect(screen.getByRole('heading', { name: '周末搭子' })).toBeInTheDocument();
    expect(screen.getByText('海边徒步认识')).toBeInTheDocument();
    expect(savedConversations().find((conversation) => conversation.id === 'lin')?.name).toBe(
      '周末搭子',
    );
    expect(JSON.parse(localStorage.getItem('social-tags') || '[]')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'design', contactIds: expect.arrayContaining(['lin']) }),
      ]),
    );
  });

  it('creates a real persisted group with selected members and opens its chat URL', () => {
    renderAt('/social/groups/new');
    fireEvent.change(screen.getByRole('textbox', { name: '群聊名称' }), {
      target: { value: '测试读书群' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '选择阿川' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择北岛' }));
    fireEvent.click(screen.getByRole('button', { name: '创建群聊（3 人）' }));
    const group = savedConversations().find((conversation) => conversation.name === '测试读书群');
    expect(group).toMatchObject({ kind: 'group', members: ['achuan', 'beidao'], owner: 'me' });
    expect(screen.getByTestId('location')).toHaveTextContent(`/social/chat/${group?.id}`);
    expect(savedMessages()[group?.id || ''][0].text).toContain('邀请了 2 位好友');
  });

  it('invites a selected friend into a group and records the result', () => {
    renderAt('/social/chat/group-weekend/invite');
    fireEvent.click(screen.getByRole('checkbox', { name: '选择北岛' }));
    fireEvent.click(screen.getByRole('button', { name: '确认邀请（1）' }));
    expect(
      savedConversations().find((conversation) => conversation.id === 'group-weekend')?.members,
    ).toContain('beidao');
    expect(savedMessages()['group-weekend'].at(-1)?.text).toContain('北岛');
    expect(screen.getByTestId('location')).toHaveTextContent('/social/chat/group-weekend/members');
  });

  it('requires an inline confirmation before removing a member and saves a group announcement', () => {
    const view = renderAt('/social/chat/group-weekend/members');
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    fireEvent.click(screen.getByRole('button', { name: '移除阿川' }));
    expect(
      savedConversations().find((conversation) => conversation.id === 'group-weekend')?.members,
    ).toContain('achuan');
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));
    expect(
      savedConversations().find((conversation) => conversation.id === 'group-weekend')?.members,
    ).not.toContain('achuan');
    view.unmount();
    renderAt('/social/chat/group-weekend/notice');
    fireEvent.change(screen.getByRole('textbox', { name: '群公告内容' }), {
      target: { value: '周六九点海边集合' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发布公告' }));
    expect(
      savedConversations().find((conversation) => conversation.id === 'group-weekend')?.notice,
    ).toBe('周六九点海边集合');
    expect(savedMessages()['group-weekend'].at(-1)?.text).toContain('周六九点海边集合');
  });

  it('saves tag membership and survives a direct URL reload', () => {
    const view = renderAt('/contacts/tags/new');
    fireEvent.change(screen.getByRole('textbox', { name: '标签名称' }), {
      target: { value: '周末电影' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '选择Mia' }));
    fireEvent.click(screen.getByRole('button', { name: '保存标签' }));
    const tags = JSON.parse(localStorage.getItem('social-tags') || '[]') as {
      id: string;
      name: string;
      contactIds: string[];
    }[];
    const tag = tags.find((item) => item.name === '周末电影');
    expect(tag?.contactIds).toEqual(['mia']);
    view.unmount();
    renderAt(`/contacts/tags/${tag?.id}`);
    expect(screen.getByRole('textbox', { name: '标签名称' })).toHaveValue('周末电影');
    expect(screen.getByRole('checkbox', { name: '选择Mia' })).toBeChecked();
  });

  it('opens images and files as route pages, routes quoted replies and persists message revocation', () => {
    const view = renderAt('/social/chat/lin/message/l4');
    expect(screen.getByRole('img', { name: '聊天图片完整预览' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '引用回复' }));
    expect(screen.getByTestId('route-state')).toHaveTextContent('[图片]');
    view.unmount();
    const fileView = renderAt('/social/chat/file-helper/message/f2');
    expect(screen.getByRole('button', { name: '下载文件' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '旅行清单.txt' })).toBeInTheDocument();
    fileView.unmount();
    renderAt('/social/chat/lin/message/l5');
    fireEvent.click(screen.getByRole('button', { name: '撤回消息' }));
    fireEvent.click(screen.getByRole('button', { name: '确认撤回' }));
    expect(savedMessages().lin.find((message) => message.id === 'l5')).toMatchObject({
      text: '你撤回了一条消息',
      mine: true,
    });
    expect(screen.getByTestId('location')).toHaveTextContent('/social/chat/lin');
  });

  it('runs a complete simulated call and writes one call record without requesting device permissions', () => {
    renderAt('/social/chat/lin/call/video');
    expect(screen.getByText(/不访问麦克风、摄像头/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '立即模拟接听' }));
    fireEvent.click(screen.getByRole('button', { name: '静音麦克风' }));
    expect(screen.getByRole('button', { name: '打开麦克风' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '结束通话' }));
    expect(screen.getByRole('heading', { name: '通话已结束' })).toBeInTheDocument();
    expect(
      savedMessages().lin.filter((message) => message.text?.includes('视频通话（模拟）')),
    ).toHaveLength(1);
  });

  it('handles unknown group/contact/message IDs with a full page instead of opening unrelated data', () => {
    const view = renderAt('/contacts/missing');
    expect(screen.getByRole('heading', { name: '联系人不存在' })).toBeInTheDocument();
    view.unmount();
    const groupView = renderAt('/social/chat/missing/members');
    expect(screen.getByRole('heading', { name: '群聊不存在' })).toBeInTheDocument();
    groupView.unmount();
    renderAt('/social/chat/lin/message/missing');
    expect(screen.getByRole('heading', { name: '消息不存在' })).toBeInTheDocument();
  });
  it('migrates earlier group fixtures once while preserving messages and later group exits', () => {
    localStorage.setItem(
      'social-conversations',
      JSON.stringify([
        {
          id: 'lin',
          name: '我的备注',
          avatar: 47,
          kind: 'person',
          preview: '用户自己的会话',
          time: '12:00',
          unread: 0,
        },
      ]),
    );
    localStorage.setItem(
      'social-messages',
      JSON.stringify({
        lin: [{ id: 'own-saved', mine: true, text: '用户自己的消息', time: '12:00' }],
      }),
    );
    const view = renderAt('/social/groups');
    expect(
      savedConversations().filter((conversation) => conversation.kind === 'group'),
    ).toHaveLength(8);
    expect(savedConversations().find((conversation) => conversation.id === 'lin')?.name).toBe(
      '我的备注',
    );
    expect(savedMessages().lin).toEqual([
      { id: 'own-saved', mine: true, text: '用户自己的消息', time: '12:00' },
    ]);
    expect(JSON.parse(localStorage.getItem('social-fixture-version') || '0')).toBe(2);
    view.unmount();
    const detail = renderAt('/social/chat/group-reading/info');
    fireEvent.click(screen.getByRole('button', { name: '退出群聊' }));
    fireEvent.click(screen.getByRole('button', { name: '确认退出' }));
    expect(savedConversations().some((conversation) => conversation.id === 'group-reading')).toBe(
      false,
    );
    detail.unmount();
    renderAt('/social/groups');
    expect(savedConversations().some((conversation) => conversation.id === 'group-reading')).toBe(
      false,
    );
  });

  it('clearly recovers old file messages as text excerpts rather than generating an empty fake PDF', () => {
    localStorage.setItem(
      'social-messages',
      JSON.stringify({
        'file-helper': [{ id: 'old-file', mine: true, text: '📄 旅行清单.pdf', time: '此前' }],
      }),
    );
    renderAt('/social/chat/file-helper/message/old-file');
    expect(screen.getByRole('heading', { name: '旅行清单-历史文字.txt' })).toBeInTheDocument();
    expect(
      screen.getByText('历史版本只保存了文件消息的文字，此下载不包含原始附件。'),
    ).toBeInTheDocument();
    expect(screen.getByText(/此记录仅保留了文件名，没有原始文件内容/)).toBeInTheDocument();
  });
});
