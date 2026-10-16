import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { CircleContext, type CirclesState } from './circle-context';
import {
  CircleChannelEditPage,
  CircleCreatePage,
  CircleInvitePage,
  CircleJoinPage,
  CircleMembersPage,
  CircleSettingsPage,
} from './ManagePages';
import type { Circle, CircleChannel } from './types';

const circle: Circle = {
  id: 'test-circle',
  name: '周末散步',
  description: '聊聊沿途的风景',
  cover: '/cover.jpg',
  icon: '🌿',
  category: '生活方式',
  joined: true,
  role: 'owner',
  memberCount: 12,
  onlineCount: 3,
  visibility: 'public',
  inviteCode: 'WALK204',
};
const channel: CircleChannel = {
  id: 'general',
  circleId: circle.id,
  name: '日常聊天',
  description: '今天去了哪里',
  type: 'text',
  category: '日常交流',
  access: 'members',
  unread: 0,
};
function state(
  overrides: Partial<CirclesState> = {},
  circleChanges: Partial<Circle> = {},
): CirclesState {
  const currentCircle = { ...circle, ...circleChanges };
  return {
    circles: [currentCircle],
    getCircle: (id) => (id === circle.id ? currentCircle : undefined),
    getChannels: () => [channel],
    getMembers: () => [
      { id: 'owner', name: '阿川', avatar: '/owner.jpg', role: 'owner', online: true },
      { id: 'admin', name: '小林', avatar: '/admin.jpg', role: 'admin', online: false },
      { id: 'member', name: '小满', avatar: '/member.jpg', role: 'member', online: true },
      {
        id: 'me',
        name: '我',
        avatar: '/me.jpg',
        role: currentCircle.role === 'guest' ? 'member' : currentCircle.role,
        online: true,
      },
    ],
    getMessages: () => [],
    getPosts: () => [],
    canViewChannel: () => true,
    markRead: vi.fn(),
    joinCircle: vi.fn(),
    leaveCircle: vi.fn(),
    createCircle: vi.fn(() => circle.id),
    updateCircle: vi.fn(),
    deleteCircle: vi.fn(),
    createChannel: vi.fn(() => 'new-channel'),
    updateChannel: vi.fn(),
    deleteChannel: vi.fn(),
    setMemberRole: vi.fn(),
    removeMember: vi.fn(),
    sendMessage: vi.fn(),
    addPost: vi.fn(() => 'post'),
    addComment: vi.fn(),
    togglePostLike: vi.fn(),
    setPostFeatured: vi.fn(),
    setPostPinned: vi.fn(),
    toggleEvent: vi.fn(),
    isAttending: () => false,
    ...overrides,
  };
}
function renderPage(entry: string, value = state()) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <CircleContext.Provider value={value}>
          <Routes>
            <Route path="/circles/new" element={<CircleCreatePage />} />
            <Route path="/circles/:circleId/settings" element={<CircleSettingsPage />} />
            <Route path="/circles/:circleId/members" element={<CircleMembersPage />} />
            <Route path="/circles/:circleId/invite" element={<CircleInvitePage />} />
            <Route path="/circles/:circleId/join" element={<CircleJoinPage />} />
            <Route
              path="/circles/:circleId/channels/new"
              element={<CircleChannelEditPage creating />}
            />
            <Route
              path="/circles/:circleId/channels/:channelId/edit"
              element={<CircleChannelEditPage />}
            />
            <Route path="/circles/:circleId/channels/:channelId" element={<h1>已进入频道</h1>} />
            <Route path="/circles/:circleId" element={<h1>已进入圈子</h1>} />
            <Route path="/circles" element={<h1>圈子列表</h1>} />
          </Routes>
        </CircleContext.Provider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

describe('circle management pages', () => {
  it('requires a useful name and preserves all selected creation settings', () => {
    const value = state();
    renderPage('/circles/new', value);
    const submit = screen.getByRole('button', { name: '创建圈子' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('圈子名称'), { target: { value: '周' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('圈子名称'), { target: { value: '  周末散步  ' } });
    fireEvent.change(screen.getByLabelText('圈子简介'), { target: { value: '  一起走走  ' } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '户外运动' } });
    fireEvent.click(screen.getByRole('radio', { name: /邀请加入/ }));
    fireEvent.click(screen.getByRole('button', { name: '图标 🌿' }));
    fireEvent.click(screen.getByRole('button', { name: '海边封面' }));
    fireEvent.click(submit);
    expect(value.createCircle).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '周末散步',
        description: '一起走走',
        icon: '🌿',
        category: '户外运动',
        visibility: 'invite',
        cover: expect.stringContaining('photo-1507525428034'),
      }),
    );
    expect(screen.getByRole('heading', { name: '已进入圈子' })).toBeInTheDocument();
  });

  it('keeps the creation form open when persistence fails', () => {
    const value = state({
      createCircle: vi.fn(() => {
        throw new Error('本地存储已满');
      }),
    });
    renderPage('/circles/new', value);
    fireEvent.change(screen.getByLabelText('圈子名称'), { target: { value: '周末散步' } });
    fireEvent.click(screen.getByRole('button', { name: '创建圈子' }));
    expect(screen.getByRole('alert')).toHaveTextContent('本地存储已满');
    expect(screen.getByLabelText('圈子名称')).toHaveValue('周末散步');
    expect(screen.getByRole('button', { name: '创建圈子' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: '已进入圈子' })).not.toBeInTheDocument();
  });

  it('protects settings from ordinary members and dissolution from administrators', () => {
    const first = renderPage('/circles/test-circle/settings', state({}, { role: 'member' }));
    expect(screen.getByText('只有圈主和管理员可以管理圈子。')).toBeInTheDocument();
    expect(screen.queryByLabelText('圈子名称')).not.toBeInTheDocument();
    first.unmount();
    renderPage('/circles/test-circle/settings', state({}, { role: 'admin' }));
    expect(screen.getByLabelText('圈子名称')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解散圈子' })).not.toBeInTheDocument();
  });

  it('requires the exact circle name before an owner can dissolve it', () => {
    const value = state();
    renderPage('/circles/test-circle/settings', value);
    fireEvent.click(screen.getByRole('button', { name: '解散圈子' }));
    const confirm = screen.getByRole('button', { name: '确认解散' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('输入「周末散步」以确认解散'), {
      target: { value: '周末' },
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('输入「周末散步」以确认解散'), {
      target: { value: '周末散步' },
    });
    fireEvent.click(confirm);
    expect(value.deleteCircle).toHaveBeenCalledWith(circle.id);
    expect(screen.getByRole('heading', { name: '圈子列表' })).toBeInTheDocument();
  });

  it('restricts administrator member actions and confirms removal inline', () => {
    const value = state({}, { role: 'admin' });
    renderPage('/circles/test-circle/members', value);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '移除阿川' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '移除小林' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '移除我' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除小满' }));
    expect(value.removeMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));
    expect(value.removeMember).toHaveBeenCalledWith(circle.id, 'member');
  });

  it('lets the owner change other member roles and search by role', () => {
    const value = state();
    renderPage('/circles/test-circle/members', value);
    expect(screen.queryByLabelText('设置阿川的角色')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('设置我的角色')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('设置小满的角色'), { target: { value: 'admin' } });
    expect(value.setMemberRole).toHaveBeenCalledWith(circle.id, 'member', 'admin');
    fireEvent.change(screen.getByLabelText('搜索成员'), { target: { value: '管理员' } });
    expect(screen.getByText('小林')).toBeInTheDocument();
    expect(screen.queryByText('小满')).not.toBeInTheDocument();
  });

  it('validates invite query codes before joining and accepts case-insensitive input', () => {
    const value = state({}, { joined: false, role: 'guest', visibility: 'invite' });
    renderPage('/circles/test-circle/join?code=INVALID', value);
    expect(screen.getByRole('alert')).toHaveTextContent('邀请码无效');
    fireEvent.click(screen.getByRole('button', { name: '加入圈子' }));
    expect(value.joinCircle).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('邀请码'), { target: { value: '  walk204  ' } });
    fireEvent.click(screen.getByRole('button', { name: '加入圈子' }));
    expect(value.joinCircle).toHaveBeenCalledWith(circle.id, 'WALK204');
    expect(screen.getByRole('heading', { name: '已进入圈子' })).toBeInTheDocument();
  });

  it('allows public joining without a code and redirects already joined users', () => {
    const value = state({}, { joined: false, role: 'guest' });
    const first = renderPage('/circles/test-circle/join?code=INVALID', value);
    fireEvent.click(screen.getByRole('button', { name: '清除邀请码，直接加入' }));
    fireEvent.click(screen.getByRole('button', { name: '加入圈子' }));
    expect(value.joinCircle).toHaveBeenCalledWith(circle.id, undefined);
    first.unmount();
    const joined = state();
    renderPage('/circles/test-circle/join?code=INVALID', joined);
    expect(screen.getByRole('heading', { name: '已进入圈子' })).toBeInTheDocument();
    expect(joined.joinCircle).not.toHaveBeenCalled();
  });

  it('generates a local invitation URL and selects it when the clipboard is unavailable', async () => {
    renderPage('/circles/test-circle/invite');
    const input = screen.getByRole('textbox', { name: '邀请链接' }) as HTMLTextAreaElement;
    const parsed = new URL(input.value);
    expect(parsed.origin).toBe(window.location.origin);
    expect(parsed.pathname).toBe('/circles/test-circle/join');
    expect(parsed.searchParams.get('code')).toBe('WALK204');
    fireEvent.click(screen.getByRole('button', { name: '复制邀请链接' }));
    expect(await screen.findByRole('status')).toHaveTextContent('链接已选中');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('copies the full invite URL when clipboard access succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderPage('/circles/test-circle/invite');
    const input = screen.getByRole('textbox', { name: '邀请链接' }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: '复制邀请链接' }));
    expect(writeText).toHaveBeenCalledWith(input.value);
    expect(await screen.findAllByRole('status')).toHaveLength(2);
  });

  it('blocks duplicate channels and saves the chosen type, grouping, and permission', () => {
    const value = state();
    renderPage('/circles/test-circle/channels/new', value);
    fireEvent.change(screen.getByLabelText('频道名称'), { target: { value: '日常聊天' } });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    expect(screen.getByRole('alert')).toHaveTextContent('已有同名频道');
    expect(value.createChannel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('频道名称'), { target: { value: '晚间语音' } });
    fireEvent.change(screen.getByLabelText('频道分组'), { target: { value: '兴趣交流' } });
    fireEvent.click(screen.getByRole('button', { name: /语音语音房间/ }));
    fireEvent.click(screen.getByRole('radio', { name: /仅圈主与管理员/ }));
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    expect(value.createChannel).toHaveBeenCalledWith(
      circle.id,
      expect.objectContaining({
        name: '晚间语音',
        category: '兴趣交流',
        type: 'voice',
        access: 'staff',
      }),
    );
    expect(screen.getByRole('heading', { name: '已进入频道' })).toBeInTheDocument();
  });

  it('keeps a channel when deletion fails and guards direct member edit links', () => {
    const value = state({
      deleteChannel: vi.fn(() => {
        throw new Error('保存失败');
      }),
    });
    const first = renderPage('/circles/test-circle/channels/general/edit', value);
    fireEvent.click(screen.getByRole('button', { name: '删除频道' }));
    expect(value.deleteChannel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.getByLabelText('频道名称')).toHaveValue('日常聊天');
    first.unmount();
    renderPage('/circles/test-circle/channels/general/edit', state({}, { role: 'member' }));
    expect(screen.getByText('只有圈主和管理员可以管理频道。')).toBeInTheDocument();
    expect(screen.queryByLabelText('频道名称')).not.toBeInTheDocument();
  });
});
