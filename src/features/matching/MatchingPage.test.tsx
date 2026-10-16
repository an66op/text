import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import MatchingPage from './MatchingPage';
import { defaultMatchingState, MATCHING_STORAGE_KEY, matchingProfiles } from './matching-model';

function MatchingApp({ entry = '/match' }: { entry?: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Routes>
          <Route path="/match" element={<MatchingPage />} />
          <Route path="/match/profile/:profileId" element={<MatchingPage kind="profile" />} />
          <Route path="/match/preferences" element={<MatchingPage kind="preferences" />} />
          <Route path="/match/connections" element={<MatchingPage kind="connections" />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}
const stored = () => JSON.parse(localStorage.getItem(MATCHING_STORAGE_KEY) || 'null');

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('matching demo workflows', () => {
  it('likes a mutually interested profile, opens a useful success view and persists a connection', () => {
    const first = render(<MatchingApp />);
    fireEvent.click(screen.getByRole('button', { name: '喜欢林柚' }));
    expect(screen.getByRole('region', { name: '匹配成功' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '你和林柚已连接' })).toBeInTheDocument();
    expect(stored().decisions).toEqual([
      expect.objectContaining({ profileId: 'lin-you', choice: 'like' }),
    ]);
    fireEvent.click(screen.getByRole('link', { name: '查看资料' }));
    expect(screen.getByText('理想的周末')).toBeInTheDocument();
    expect(screen.getByText('已连接')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '查看连接' }));
    expect(screen.getByRole('heading', { name: /林柚/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /发送|聊天/ })).not.toBeInTheDocument();
    first.unmount();
    render(<MatchingApp entry="/match/connections" />);
    expect(screen.getByRole('heading', { name: /林柚/ })).toBeInTheDocument();
    expect(localStorage.getItem('social-conversations')).toBeNull();
  });

  it('keeps one-sided likes in records without creating a connection', () => {
    render(<MatchingApp entry="/match/profile/chen-yu" />);
    fireEvent.click(screen.getByRole('button', { name: '喜欢陈屿' }));
    expect(screen.queryByRole('region', { name: '匹配成功' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '查看喜欢记录' }));
    expect(screen.getByText('还没有新的连接')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /我喜欢的/ }));
    expect(screen.getByRole('heading', { name: /陈屿/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消喜欢陈屿' }));
    expect(screen.getByText('还没有喜欢的资料')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销上次操作' }));
    expect(screen.getByRole('heading', { name: /陈屿/ })).toBeInTheDocument();
  });

  it('persists skips, restores the exact previous card with undo, and can recommend a skipped profile again', () => {
    const first = render(<MatchingApp />);
    fireEvent.click(screen.getByRole('button', { name: '跳过林柚' }));
    expect(screen.getByRole('button', { name: '喜欢陈屿' })).toBeInTheDocument();
    first.unmount();
    render(<MatchingApp />);
    expect(screen.getByRole('button', { name: '喜欢陈屿' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销上次操作' }));
    expect(screen.getByRole('button', { name: '喜欢林柚' })).toBeInTheDocument();
    expect(stored().decisions).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '跳过林柚' }));
    fireEvent.click(screen.getByRole('link', { name: '查看喜欢与跳过记录' }));
    fireEvent.click(screen.getByRole('button', { name: /已跳过/ }));
    fireEvent.click(screen.getByRole('button', { name: '重新推荐林柚' }));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: '匹配导航' })).getByRole('link', {
        name: '推荐',
      }),
    );
    expect(screen.getByRole('button', { name: '喜欢林柚' })).toBeInTheDocument();
  });

  it('validates adult ages and persists combined filters for discovery', () => {
    render(<MatchingApp entry="/match/preferences" />);
    fireEvent.change(screen.getByRole('spinbutton', { name: '最小年龄' }), {
      target: { value: '17' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存偏好' }));
    expect(screen.getByRole('alert')).toHaveTextContent('18–80');
    expect(stored().preferences.minAge).toBe(18);
    fireEvent.change(screen.getByRole('spinbutton', { name: '最小年龄' }), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: '最大年龄' }), {
      target: { value: '35' },
    });
    fireEvent.change(screen.getByLabelText('想认识'), { target: { value: 'man' } });
    fireEvent.change(screen.getByLabelText('城市'), { target: { value: '成都' } });
    fireEvent.change(screen.getByLabelText('期待的关系'), { target: { value: 'friends' } });
    fireEvent.click(screen.getByRole('button', { name: '摄影' }));
    fireEvent.click(screen.getByRole('button', { name: '保存偏好' }));
    expect(screen.getByRole('button', { name: '喜欢陆安' })).toBeInTheDocument();
    expect(screen.getByText('1 位符合偏好')).toBeInTheDocument();
    expect(stored().preferences).toEqual({
      minAge: 30,
      maxAge: 35,
      gender: 'man',
      city: '成都',
      intention: 'friends',
      interests: ['摄影'],
    });
  });

  it('resets an exhausted round without deleting likes and can undo that reset', () => {
    localStorage.setItem(
      MATCHING_STORAGE_KEY,
      JSON.stringify({
        ...defaultMatchingState,
        decisions: matchingProfiles.map((profile, index) => ({
          profileId: profile.id,
          choice: index === 0 ? 'like' : 'skip',
          createdAt: index + 1,
        })),
      }),
    );
    render(<MatchingApp />);
    expect(screen.getByText('已看完这轮推荐')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重置本轮' }));
    expect(screen.getByRole('button', { name: '喜欢陈屿' })).toBeInTheDocument();
    expect(stored().decisions).toEqual([
      expect.objectContaining({ profileId: 'lin-you', choice: 'like' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: '撤销上次操作' }));
    expect(screen.getByText('已看完这轮推荐')).toBeInTheDocument();
    expect(stored().decisions).toHaveLength(6);
  });

  it('handles a preference empty state and restores default filters without clearing likes', () => {
    localStorage.setItem(
      MATCHING_STORAGE_KEY,
      JSON.stringify({
        ...defaultMatchingState,
        preferences: { ...defaultMatchingState.preferences, minAge: 60, maxAge: 70 },
        decisions: [{ profileId: 'lin-you', choice: 'like', createdAt: 1 }],
      }),
    );
    render(<MatchingApp />);
    expect(screen.getByText('暂时没有符合偏好的资料')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '调整偏好' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    fireEvent.click(screen.getByRole('button', { name: '保存偏好' }));
    expect(screen.getByRole('button', { name: '喜欢陈屿' })).toBeInTheDocument();
    expect(stored().decisions).toHaveLength(1);
  });

  it('recovers corrupt local state and unknown profile links without errors', () => {
    localStorage.setItem(
      MATCHING_STORAGE_KEY,
      JSON.stringify({ version: 1, preferences: null, decisions: [null] }),
    );
    const first = render(<MatchingApp />);
    expect(screen.getByRole('button', { name: '喜欢林柚' })).toBeInTheDocument();
    first.unmount();
    render(<MatchingApp entry="/match/profile/missing" />);
    expect(screen.getByText('这份资料暂时无法查看')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '返回推荐' }));
    expect(screen.getByRole('button', { name: '喜欢林柚' })).toBeInTheDocument();
  });

  it('retains the visible card and reports storage failure without showing a false match', () => {
    render(<MatchingApp />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    fireEvent.click(screen.getByRole('button', { name: '喜欢林柚' }));
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.queryByRole('region', { name: '匹配成功' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '喜欢林柚' })).toBeInTheDocument();
    expect(stored().decisions).toEqual([]);
  });

  it('makes detail-page success links open the profile and continue back to discovery', () => {
    render(<MatchingApp entry="/match/profile/lin-you" />);
    fireEvent.click(screen.getByRole('button', { name: '喜欢林柚' }));
    fireEvent.click(screen.getByRole('link', { name: '查看资料' }));
    expect(screen.getByText('关于我')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '匹配成功' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '继续发现' }));
    expect(screen.getByRole('button', { name: '喜欢陈屿' })).toBeInTheDocument();
  });
});
