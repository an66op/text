import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import EditProfilePage from './EditProfilePage';
import { ProfileProvider } from './profile-store';
import { useProfile } from './useProfile';

function CurrentProfile() {
  const { profile } = useProfile();
  const { pathname } = useLocation();
  return (
    <>
      <output aria-label="当前昵称">{profile.name}</output>
      <output aria-label="当前简介">{profile.bio}</output>
      <output aria-label="当前地址">{pathname}</output>
    </>
  );
}

function EditingApp() {
  return (
    <MemoryRouter initialEntries={['/me/edit']}>
      <ToastProvider>
        <ProfileProvider>
          <Routes>
            <Route path="/me/edit" element={<EditProfilePage />} />
            <Route path="/me" element={<CurrentProfile />} />
          </Routes>
        </ProfileProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('profile editing and recovery', () => {
  beforeEach(() => localStorage.clear());

  it('uses the existing profile and saves trimmed edits before returning to My', () => {
    localStorage.setItem('profile', JSON.stringify({ name: '旧昵称', bio: '原来的简介' }));
    const editing = render(<EditingApp />);

    expect(screen.getByLabelText('昵称')).toHaveValue('旧昵称');
    expect(screen.getByLabelText('个人简介')).toHaveValue('原来的简介');
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '  林间晚风  ' } });
    fireEvent.change(screen.getByLabelText('个人简介'), { target: { value: '  收集新的风景  ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }));

    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/me');
    expect(screen.getByLabelText('当前昵称')).toHaveTextContent('林间晚风');
    expect(screen.getByLabelText('当前简介')).toHaveTextContent('收集新的风景');
    expect(JSON.parse(localStorage.getItem('profile') ?? 'null')).toEqual({
      name: '林间晚风',
      bio: '收集新的风景',
      location: '杭州',
      handle: 'orange_soda',
      gender: '不公开',
    });

    editing.unmount();
    render(<EditingApp />);
    expect(screen.getByLabelText('昵称')).toHaveValue('林间晚风');
    expect(screen.getByLabelText('个人简介')).toHaveValue('收集新的风景');
  });

  it('requires a nonempty nickname before saving', () => {
    render(<EditingApp />);
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: '保存资料' })).toBeDisabled();
  });

  it.each(['{"name":42,"bio":null}', '{"broken":', 'null'])(
    'recovers an unusable saved profile: %s',
    (raw) => {
      localStorage.setItem('profile', raw);
      render(<EditingApp />);

      expect(screen.getByLabelText('昵称')).toHaveValue('橘子汽水');
      expect(screen.getByLabelText('个人简介')).toHaveValue(
        '收集生活里的小确幸。摄影 / 旅行 / 咖啡 ☕',
      );
      expect(JSON.parse(localStorage.getItem('profile') ?? 'null')).toEqual({
        name: '橘子汽水',
        bio: '收集生活里的小确幸。摄影 / 旅行 / 咖啡 ☕',
      });
    },
  );
});
