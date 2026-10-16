import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { ProfileProvider } from './profile-store';
import SettingsPage from './SettingsPage';
import SettingsRoutePage from './SettingsRoutePage';
import { defaultSettings, isAccountSettings } from './settings-model';

function SettingsApp({ entry = '/settings' }: { entry?: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ProfileProvider>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/content" element={<SettingsRoutePage kind="content" />} />
            <Route
              path="/settings/notifications"
              element={<SettingsRoutePage kind="notifications" />}
            />
            <Route path="/settings/blocked" element={<SettingsRoutePage kind="blocked" />} />
            <Route path="/settings/devices" element={<SettingsRoutePage kind="devices" />} />
          </Routes>
        </ProfileProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}
describe('settings page workflows', () => {
  beforeEach(() => localStorage.clear());
  it('navigates to full settings pages and preserves the old preference keys', () => {
    localStorage.setItem('preferences', JSON.stringify({ 消息通知: false, 阅读与写作: false }));
    const first = render(<SettingsApp />);
    expect(screen.getByRole('switch', { name: '消息通知' })).not.toBeChecked();
    expect(screen.getByRole('link', { name: /隐私权限/ })).toHaveAttribute(
      'href',
      '/settings/privacy',
    );
    fireEvent.click(screen.getByRole('link', { name: /内容偏好/ }));
    expect(screen.getByRole('switch', { name: '阅读与写作' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('switch', { name: '自动播放预览' }));
    expect(JSON.parse(localStorage.getItem('preferences') ?? 'null')).toEqual({
      消息通知: false,
      阅读与写作: false,
      自动播放预览: false,
    });
    first.unmount();
    render(<SettingsApp entry="/settings/content" />);
    expect(screen.getByRole('switch', { name: '自动播放预览' })).not.toBeChecked();
  });
  it('disables alert controls with notifications off and retains separate preview choices', () => {
    localStorage.setItem('preferences', JSON.stringify({ 消息通知: false }));
    render(<SettingsApp entry="/settings/notifications" />);
    expect(screen.getByRole('switch', { name: '提示音' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: '振动提醒' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: '显示消息预览' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: '显示消息预览' }));
    expect(
      JSON.parse(localStorage.getItem('account-settings-v1') ?? 'null').notifications.showPreview,
    ).toBe(false);
  });
  it('adds a real fixture contact to the persistent blacklist and can remove it', () => {
    const first = render(<SettingsApp entry="/settings/blocked" />);
    fireEvent.click(screen.getByRole('button', { name: '添加屏蔽联系人' }));
    fireEvent.change(screen.getByLabelText('搜索屏蔽联系人'), { target: { value: '阿川' } });
    fireEvent.click(screen.getByRole('button', { name: '屏蔽' }));
    expect(JSON.parse(localStorage.getItem('profile-blocked-contacts') ?? 'null')).toEqual([
      'achuan',
    ]);
    first.unmount();
    render(<SettingsApp entry="/settings/blocked" />);
    fireEvent.click(screen.getByRole('button', { name: '解除屏蔽' }));
    expect(screen.getByText('黑名单为空')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('profile-blocked-contacts') ?? 'null')).toEqual([]);
  });
  it('removes a demo remote session and protects the current browser entry', () => {
    render(<SettingsApp entry="/settings/devices" />);
    expect(screen.getAllByRole('button', { name: '移除' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0]);
    expect(JSON.parse(localStorage.getItem('account-settings-v1') ?? 'null').devices).toHaveLength(
      2,
    );
    expect(screen.getByText('当前浏览器')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已移除');
  });
  it('rejects corrupt nested device records without throwing', () => {
    expect(isAccountSettings({ ...defaultSettings, devices: [null] })).toBe(false);
    expect(
      isAccountSettings({
        ...defaultSettings,
        privacy: { ...defaultSettings.privacy, visibility: 'unknown' },
      }),
    ).toBe(false);
    localStorage.setItem(
      'account-settings-v1',
      JSON.stringify({ ...defaultSettings, devices: [null] }),
    );
    render(<SettingsApp entry="/settings/devices" />);
    expect(screen.getByText('当前浏览器')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '移除' })).toHaveLength(2);
  });
});
