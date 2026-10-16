import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { defaultSettings, SETTINGS_KEY } from '@/features/profile/settings-model';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import SocialHub from './SocialHub';
import { SocialProvider } from './SocialProvider';

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="pathname">{location.pathname}</output>
      <button onClick={() => navigate(-1)}>浏览器返回</button>
    </>
  );
}
function renderAt(path: string) {
  const page = <SocialHub onOpenModule={() => {}} profileName="测试用户" />;
  return render(
    <ToastProvider>
      <SocialProvider>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <Routes>
            <Route path="/social" element={page} />
            <Route path="/social/chat/:conversationId" element={page} />
          </Routes>
        </MemoryRouter>
      </SocialProvider>
    </ToastProvider>,
  );
}

describe('conversation routes', () => {
  beforeEach(() => localStorage.clear());

  it('opens the URL conversation on a fresh load and saves sent text to that conversation', () => {
    renderAt('/social/chat/mia');
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), {
      target: { value: '路由工程验证' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    const messages = JSON.parse(localStorage.getItem('social-messages') ?? '{}') as Record<
      string,
      { text?: string }[]
    >;
    expect(messages.mia.at(-1)?.text).toBe('路由工程验证');
    expect(messages.lin.some((message) => message.text === '路由工程验证')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '返回会话列表' }));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/social');
  });

  it('changes the URL when selecting a conversation and supports browser history', () => {
    renderAt('/social');
    fireEvent.click(screen.getByRole('button', { name: /^Mia/ }));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/social/chat/mia');
    fireEvent.click(screen.getByRole('button', { name: '浏览器返回' }));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/social');
  });

  it('shows a missing conversation instead of silently opening another person', () => {
    renderAt('/social/chat/missing');
    expect(screen.getByRole('heading', { name: '会话不存在' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '聊天消息' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回会话列表' }));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/social');
  });
  it('honours the shared blacklist and preserves a rejected message draft', () => {
    localStorage.setItem('profile-blocked-contacts', JSON.stringify(['lin']));
    renderAt('/social/chat/lin');
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), {
      target: { value: '这条不能发送' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('这条不能发送');
    expect(
      JSON.parse(localStorage.getItem('social-messages') || '{}').lin.some(
        (message: { text?: string }) => message.text === '这条不能发送',
      ),
    ).toBe(false);
    expect(screen.getByText('该联系人在黑名单中，请先解除拉黑')).toHaveAttribute('role', 'status');
  });
  it('uses the persisted notification setting to hide conversation summaries', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: { ...defaultSettings.notifications, showPreview: false },
      }),
    );
    renderAt('/social');
    expect(screen.getAllByText('消息内容已隐藏').length).toBeGreaterThanOrEqual(8);
    expect(screen.getByRole('button', { name: /^Mia.*消息内容已隐藏/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Mia.*咖啡店/ })).not.toBeInTheDocument();
  });
});
