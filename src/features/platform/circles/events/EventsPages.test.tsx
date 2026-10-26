import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { AuthContext, type AuthState } from '../../auth-context';
import { member, otherMember, signedIn } from '../../platform-test-fixtures';
import { circlesApi } from '../api';
import { circle, deferred } from '../test-fixtures';
import { eventsApi } from './api';
import { activity, activityPath, eventsPath, registration, secondActivity } from './test-fixtures';
import type { CircleEvent, RegistrationResult } from './types';
import EventsPage from './EventsPage';
import EventPage from './EventPage';
import EventEditorPage from './EventEditorPage';
import AttendeesPage from './AttendeesPage';
function Navigation() {
  const navigate = useNavigate(),
    location = useLocation();
  return (
    <>
      <output aria-label="当前路径">{location.pathname + location.search}</output>
      <button onClick={() => navigate(`${eventsPath}/${secondActivity.id}`)}>下一场</button>
    </>
  );
}
const page = (path = activityPath, auth: AuthState = signedIn()) => (
  <AuthContext.Provider value={auth}>
    <MemoryRouter initialEntries={[path]}>
      <Navigation />
      <Routes>
        <Route path="/circles/s/:circleId/events" element={<EventsPage />} />
        <Route path="/circles/s/:circleId/events/new" element={<EventEditorPage creating />} />
        <Route path="/circles/s/:circleId/events/:eventId" element={<EventPage />} />
        <Route path="/circles/s/:circleId/events/:eventId/edit" element={<EventEditorPage />} />
        <Route path="/circles/s/:circleId/events/:eventId/attendees" element={<AttendeesPage />} />
      </Routes>
    </MemoryRouter>
  </AuthContext.Provider>
);
beforeEach(() => {
  vi.spyOn(circlesApi, 'circle').mockResolvedValue(circle);
  vi.spyOn(eventsApi, 'detail').mockImplementation(async (_circle, id) =>
    id === secondActivity.id ? secondActivity : activity,
  );
  vi.spyOn(eventsApi, 'list').mockResolvedValue({ items: [activity], total: 1 });
});
afterEach(() => vi.restoreAllMocks());
describe('real circle event discovery and access', () => {
  it('keeps loading, empty and retryable failure separate and never falls back to local events', async () => {
    const first = deferred<{ items: CircleEvent[]; total: number }>();
    vi.mocked(eventsApi.list)
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new ApiError('活动服务暂不可用', 'unavailable', 503))
      .mockResolvedValue({ items: [], total: 0 });
    render(page(eventsPath));
    await screen.findByText('正在读取活动…');
    await act(async () => first.resolve({ items: [], total: 0 }));
    await screen.findByText('暂无符合条件的活动');
    fireEvent.click(screen.getByRole('button', { name: '刷新活动' }));
    await screen.findByText('活动服务暂不可用');
    expect(screen.queryByText(activity.title)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('暂无符合条件的活动');
  });
  it('paginates server activity views without reusing another filter response', async () => {
    vi.mocked(eventsApi.list).mockResolvedValue({ items: [activity], total: 21 });
    render(page(eventsPath));
    fireEvent.click(await screen.findByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(eventsApi.list).toHaveBeenLastCalledWith(
        circle.id,
        { view: 'upcoming', limit: 20, offset: 20 },
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(screen.getByRole('tab', { name: '我的' }));
    await waitFor(() =>
      expect(eventsApi.list).toHaveBeenLastCalledWith(
        circle.id,
        { view: 'mine', limit: 20, offset: 0 },
        expect.any(AbortSignal),
      ),
    );
    expect(screen.getByRole('tab', { name: '我的' })).toHaveAttribute('aria-selected', 'true');
  });
  it('does not read event titles, locations, counts or attendees for a guest', async () => {
    const attendees = vi.spyOn(eventsApi, 'attendees');
    render(page(activityPath, { ...signedIn(), user: null, status: 'guest' }));
    await screen.findByRole('link', { name: '登录' });
    expect(eventsApi.detail).not.toHaveBeenCalled();
    expect(attendees).not.toHaveBeenCalled();
    expect(screen.queryByText(activity.title)).not.toBeInTheDocument();
    expect(screen.queryByText(activity.location)).not.toBeInTheDocument();
  });
  it('denies a creator or global administrator a management roster without a current circle role', async () => {
    const attendees = vi.spyOn(eventsApi, 'attendees');
    render(page(`${activityPath}/attendees`, signedIn({ ...member, role: 'admin' })));
    await screen.findByText('只有当前圈主或圈管理员可以管理。');
    expect(eventsApi.detail).not.toHaveBeenCalled();
    expect(attendees).not.toHaveBeenCalled();
  });
  it('uses the server phase rather than the browser date and leaves an online location as text', async () => {
    vi.mocked(eventsApi.detail).mockResolvedValue({
      ...activity,
      phase: 'ended',
      registrationOpen: false,
      mode: 'online',
      location: 'https://example.test/private-meeting',
    });
    render(page());
    await screen.findByText('已结束');
    expect(screen.queryByRole('button', { name: '报名参加' })).not.toBeInTheDocument();
    expect(screen.getByText('线上 · https://example.test/private-meeting')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /private-meeting/ })).not.toBeInTheDocument();
  });
});
describe('server confirmed registration and waiting list', () => {
  it('makes full-capacity waiting explicit and does not add a participant locally before the receipt', async () => {
    const write = deferred<RegistrationResult>(),
      full = { ...activity, registeredCount: 2 };
    vi.mocked(eventsApi.detail).mockResolvedValue(full);
    const register = vi.spyOn(eventsApi, 'registration').mockReturnValue(write.promise);
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '加入候补 · 同意自动递补' }));
    expect(screen.queryByText('候补第 3 位')).not.toBeInTheDocument();
    expect(register).toHaveBeenCalledWith(
      circle.id,
      activity.id,
      'waitlist',
      expect.any(String),
      expect.any(AbortSignal),
    );
    const waiting = { ...registration, status: 'waitlisted' as const, queuePosition: 3 };
    vi.mocked(eventsApi.detail).mockResolvedValue({
      ...full,
      waitlistedCount: 3,
      myRegistration: waiting,
    });
    await act(async () => write.resolve({ ok: true, registration: waiting }));
    await screen.findByText('候补第 3 位');
    expect(screen.getByText(/已确认 2 \/ 2 位/)).toBeInTheDocument();
    expect(screen.getByText(/截止后不会临时确认/)).toBeInTheDocument();
  });
  it('refreshes a lost final-seat conflict and requires a new explicit waitlist intent', async () => {
    const register = vi
      .spyOn(eventsApi, 'registration')
      .mockRejectedValueOnce(new ApiError('名额已满，请选择候补', 'conflict', 409))
      .mockResolvedValue({
        ok: true,
        registration: { ...registration, status: 'waitlisted', queuePosition: 1 },
      });
    render(page());
    await screen.findByRole('button', { name: '报名参加' });
    vi.mocked(eventsApi.detail).mockResolvedValue({ ...activity, registeredCount: 2 });
    fireEvent.click(screen.getByRole('button', { name: '报名参加' }));
    await screen.findByText('名额已满，请选择候补');
    const waitlist = await screen.findByRole('button', { name: '加入候补 · 同意自动递补' });
    expect(register).toHaveBeenCalledOnce();
    const clientId = register.mock.calls[0][3];
    fireEvent.click(waitlist);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    expect(register.mock.calls[1][2]).toBe('waitlist');
    expect(register.mock.calls[1][3]).not.toBe(clientId);
  });
  it('refreshes after an uncertain timeout, retries only on demand with the same ID and displays a replay current state', async () => {
    const cancelled = { ...registration, status: 'cancelled' as const, reason: 'user' as const };
    const register = vi
      .spyOn(eventsApi, 'registration')
      .mockRejectedValueOnce(
        new ApiError('请求超时，操作可能已完成；请先刷新确认，再重试', 'TIMEOUT', 0),
      )
      .mockResolvedValue({ ok: true, registration: cancelled });
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '报名参加' }));
    await screen.findByText(/请求超时，操作可能已完成/);
    await waitFor(() => expect(eventsApi.detail).toHaveBeenCalledTimes(2));
    const id = register.mock.calls[0][3];
    expect(register).toHaveBeenCalledOnce();
    vi.mocked(eventsApi.detail).mockResolvedValue({ ...activity, myRegistration: cancelled });
    fireEvent.click(screen.getByRole('button', { name: '报名参加' }));
    await screen.findByText('服务器确认：本人取消。');
    expect(register.mock.calls[1][3]).toBe(id);
    expect(screen.queryByText('报名已确认，正在更新活动名额。')).not.toBeInTheDocument();
  });
  it('requires a concrete leave confirmation, preserves a failed registration and then uses a new ID for the next join cycle', async () => {
    const registered = { ...activity, myRegistration: registration };
    vi.mocked(eventsApi.detail).mockResolvedValue(registered);
    const register = vi
      .spyOn(eventsApi, 'registration')
      .mockRejectedValueOnce(new ApiError('网络中断，请重试', 'network', 0))
      .mockResolvedValue({
        ok: true,
        registration: { ...registration, status: 'cancelled', reason: 'user' },
      });
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '取消报名' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(activity.title);
    expect(dialog).toHaveTextContent('不保证有名额');
    expect(register).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认取消报名' }));
    await within(dialog).findByText('网络中断，请重试');
    expect(screen.getByText('已确认报名')).toBeInTheDocument();
    const leaveId = register.mock.calls[0][3];
    vi.mocked(eventsApi.detail).mockResolvedValue({
      ...activity,
      myRegistration: { ...registration, status: 'cancelled', reason: 'user' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认取消报名' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(register.mock.calls[1][3]).toBe(leaveId);
    register.mockResolvedValue({ ok: true, registration });
    fireEvent.click(await screen.findByRole('button', { name: '报名参加' }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(3));
    expect(register.mock.calls[2][3]).not.toBe(leaveId);
  });
  it('ignores a late registration receipt when navigating to a different activity in the same circle', async () => {
    const write = deferred<RegistrationResult>(),
      register = vi.spyOn(eventsApi, 'registration').mockReturnValue(write.promise);
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '报名参加' }));
    fireEvent.click(screen.getByRole('button', { name: '下一场' }));
    await screen.findByRole('heading', { name: secondActivity.title });
    expect(register.mock.calls[0][4]?.aborted).toBe(true);
    await act(async () => write.resolve({ ok: true, registration }));
    expect(screen.queryByText(activity.description)).not.toBeInTheDocument();
    expect(screen.queryByText('报名已确认，正在更新活动名额。')).not.toBeInTheDocument();
    expect(screen.getByText('尚未报名')).toBeInTheDocument();
  });
  it('clears revoked private content and prevents a late read from reviving it while leaving generic cleanup available', async () => {
    const stale = deferred<CircleEvent>();
    vi.mocked(eventsApi.detail).mockResolvedValueOnce(activity).mockReturnValueOnce(stale.promise);
    vi.spyOn(eventsApi, 'registration').mockRejectedValue(
      new ApiError('当前不再拥有圈内访问权', 'forbidden', 403),
    );
    render(page());
    await screen.findByRole('button', { name: '报名参加' });
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(eventsApi.detail).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '报名参加' }));
    await screen.findByText('当前不再拥有圈内访问权');
    expect(screen.queryByText(activity.location)).not.toBeInTheDocument();
    await act(async () => stale.resolve(activity));
    expect(screen.queryByText(activity.title)).not.toBeInTheDocument();
    expect(screen.getByText('无法查看活动？清理本人登记')).toBeInTheDocument();
  });
});
describe('event management and conflict recovery', () => {
  it('preserves creation input and idempotency key after an uncertain failure and converts local dates to UTC', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'admin' });
    const create = vi
      .spyOn(eventsApi, 'create')
      .mockRejectedValueOnce(new ApiError('请求超时，请刷新后确认', 'TIMEOUT', 0))
      .mockResolvedValue(activity);
    render(page(`${eventsPath}/new`));
    fireEvent.change(await screen.findByRole('textbox', { name: '活动标题' }), {
      target: { value: '新活动' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '活动介绍' }), {
      target: { value: '新的圈内安排' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '活动地点' }), {
      target: { value: '新集合点' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发布活动' }));
    await screen.findByText('请求超时，请刷新后确认');
    const input = create.mock.calls[0][1];
    expect(input.startsAt.endsWith('Z')).toBe(true);
    expect(input.clientId).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '活动标题' })).toHaveValue('新活动');
    expect(create).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '发布活动' }));
    await screen.findByRole('heading', { name: activity.title });
    expect(create.mock.calls[1][1].clientId).toBe(input.clientId);
  });
  it('keeps a draft at its reviewed revision after a newer poll and reloads only after explicit confirmation', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'admin' });
    const newer = { ...activity, title: '其他管理更新的标题', revision: 4 };
    const update = vi
      .spyOn(eventsApi, 'update')
      .mockRejectedValueOnce(new ApiError('活动已更新，请刷新后核实', 'conflict', 409))
      .mockResolvedValue({ ...newer, revision: 5 });
    render(page(`${activityPath}/edit`));
    fireEvent.change(await screen.findByRole('textbox', { name: '活动标题' }), {
      target: { value: '我尚未保存的草稿' },
    });
    vi.mocked(eventsApi.detail).mockResolvedValue(newer);
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByText('活动已更新，当前草稿保留。请重新载入后核实。');
    expect(screen.getByRole('textbox', { name: '活动标题' })).toHaveValue('我尚未保存的草稿');
    fireEvent.click(screen.getByRole('button', { name: '保存活动' }));
    await screen.findByText('活动已更新，请刷新后核实');
    expect(update.mock.calls[0][2]).toMatchObject({
      revision: 3,
      title: '我尚未保存的草稿',
      registrationClosesAt: activity.registrationClosesAt,
    });
    fireEvent.click(screen.getByRole('button', { name: '重新载入服务器资料' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('替换当前尚未保存的草稿');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认重新载入' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: '活动标题' })).toHaveValue(newer.title),
    );
    fireEvent.click(screen.getByRole('button', { name: '保存活动' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][2].revision).toBe(4);
  });
  it('keeps cancelled or started activities readonly rather than presenting a reopen action', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'owner' });
    vi.mocked(eventsApi.detail).mockResolvedValue({
      ...activity,
      lifecycle: 'cancelled',
      phase: 'cancelled',
      registrationOpen: false,
    });
    render(page(`${activityPath}/edit`));
    await screen.findByText('已取消或已开始的活动不可编辑，当前草稿已保留。');
    expect(screen.getByRole('button', { name: '保存活动' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '重新开启' })).not.toBeInTheDocument();
  });
  it('confirms cancellation with reviewed counts and does not revive it from an older polling response', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'admin' });
    const stale = deferred<CircleEvent>(),
      fresh = deferred<CircleEvent>(),
      write = deferred<CircleEvent>();
    vi.mocked(eventsApi.detail)
      .mockResolvedValueOnce(activity)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const cancel = vi.spyOn(eventsApi, 'cancel').mockReturnValue(write.promise);
    render(page());
    await screen.findByRole('button', { name: '取消活动' });
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(eventsApi.detail).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '取消活动' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(activity.title);
    expect(dialog).toHaveTextContent('1 位确认');
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认取消活动' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const cancelled = {
      ...activity,
      lifecycle: 'cancelled' as const,
      phase: 'cancelled' as const,
      registrationOpen: false,
      revision: 4,
      registeredCount: 0,
    };
    await act(async () => write.resolve(cancelled));
    await screen.findByText('已取消');
    expect(cancel).toHaveBeenCalledWith(circle.id, activity.id, 3, expect.any(AbortSignal));
    await act(async () => stale.resolve(activity));
    expect(screen.getByText('已取消')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '报名参加' })).not.toBeInTheDocument();
    await act(async () => fresh.resolve(cancelled));
  });
  it('closes an outdated cancellation dialog after a revision change or circle role downgrade', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'admin' });
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '取消活动' }));
    vi.mocked(eventsApi.detail).mockResolvedValue({ ...activity, revision: 4, capacity: 3 });
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByText('活动或本人登记状态已变化，请重新确认。');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消活动' }));
    vi.mocked(circlesApi.circle).mockResolvedValue(circle);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '取消活动' })).not.toBeInTheDocument();
  });
  it('refreshes and requires a new cancellation confirmation after a revision conflict', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'admin' });
    const cancel = vi
      .spyOn(eventsApi, 'cancel')
      .mockRejectedValue(new ApiError('活动已更新，请刷新后核实', 'conflict', 409));
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '取消活动' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认取消活动' }));
    await within(dialog).findByText('活动已更新，请刷新后核实');
    vi.mocked(eventsApi.detail).mockResolvedValue({
      ...activity,
      revision: 4,
      title: '已经调整的安排',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }));
    await screen.findByText('活动或本人登记状态已变化，请重新确认。');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '取消活动' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('已经调整的安排');
    fireEvent.click(screen.getByRole('button', { name: '确认取消活动' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    expect(cancel.mock.calls[1][2]).toBe(4);
  });
  it('provides narrow status-filtered roster pages only for a current manager', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'admin' });
    const attendees = vi.spyOn(eventsApi, 'attendees').mockResolvedValue({
      items: [
        {
          user: otherMember,
          registration: { ...registration, status: 'waitlisted', queuePosition: 4 },
        },
      ],
      total: 21,
    });
    render(page(`${activityPath}/attendees`));
    await screen.findByText('候补第 4 位');
    fireEvent.click(screen.getByRole('tab', { name: '候补' }));
    await waitFor(() =>
      expect(attendees).toHaveBeenLastCalledWith(
        circle.id,
        activity.id,
        { status: 'waitlisted', limit: 20, offset: 0 },
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(attendees).toHaveBeenLastCalledWith(
        circle.id,
        activity.id,
        { status: 'waitlisted', limit: 20, offset: 20 },
        expect.any(AbortSignal),
      ),
    );
    expect(screen.queryByText(otherMember.email)).not.toBeInTheDocument();
  });
  it('reports the current activity with a plain reason and waits for the service receipt', async () => {
    const report = vi
      .spyOn(eventsApi, 'report')
      .mockResolvedValue({ id: 'report-event', status: 'open' });
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '举报活动' }));
    fireEvent.change(screen.getByRole('textbox', { name: '举报原因' }), {
      target: { value: '  活动安排有问题  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交举报' }));
    await screen.findByText('举报已提交，等待平台处理。');
    expect(report).toHaveBeenCalledWith(
      circle.id,
      activity.id,
      '活动安排有问题',
      expect.any(AbortSignal),
    );
  });
});
describe('private-free registration cleanup', () => {
  it('releases the session gate when permission loss unmounts a pending detail write so known-ID cleanup remains usable', async () => {
    const late = deferred<RegistrationResult>();
    const register = vi
      .spyOn(eventsApi, 'registration')
      .mockReturnValueOnce(late.promise)
      .mockResolvedValue({
        ok: true,
        registration: { ...registration, status: 'cancelled', reason: 'user' },
      });
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '报名参加' }));
    vi.mocked(circlesApi.circle).mockRejectedValue(
      new ApiError('成员权限已失效', 'forbidden', 403),
    );
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByText('成员权限已失效');
    expect(register.mock.calls[0][4]?.aborted).toBe(true);
    fireEvent.click(screen.getByText('无法查看活动？清理本人登记'));
    expect(screen.getByRole('button', { name: '取消本人的登记' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '取消本人的登记' }));
    fireEvent.click(screen.getByRole('button', { name: '确认清理本人登记' }));
    await screen.findByText('服务器确认本人当前状态：本人取消。');
    await act(async () => late.resolve({ ok: true, registration }));
    expect(screen.queryByText('报名已确认，正在更新活动名额。')).not.toBeInTheDocument();
    expect(screen.queryByText(activity.title)).not.toBeInTheDocument();
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('serializes opposite registration intents across the readable detail and generic cleanup', async () => {
    const join = deferred<RegistrationResult>(),
      leave = deferred<RegistrationResult>();
    const register = vi
      .spyOn(eventsApi, 'registration')
      .mockReturnValueOnce(join.promise)
      .mockReturnValueOnce(leave.promise);
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '报名参加' }));
    fireEvent.click(screen.getByText('无法查看活动？清理本人登记'));
    expect(screen.getByRole('button', { name: '取消本人的登记' })).toBeDisabled();
    expect(register).toHaveBeenCalledOnce();
    vi.mocked(eventsApi.detail).mockResolvedValue({ ...activity, myRegistration: registration });
    await act(async () => join.resolve({ ok: true, registration }));
    await screen.findByRole('button', { name: '取消报名' });
    fireEvent.click(screen.getByRole('button', { name: '取消本人的登记' }));
    fireEvent.click(screen.getByRole('button', { name: '确认清理本人登记' }));
    expect(screen.getByRole('button', { name: '取消报名' })).toBeDisabled();
    expect(register.mock.calls[1][2]).toBe('leave');
    vi.mocked(eventsApi.detail).mockResolvedValue({
      ...activity,
      myRegistration: { ...registration, status: 'cancelled', reason: 'user' },
    });
    await act(async () =>
      leave.resolve({
        ok: true,
        registration: { ...registration, status: 'cancelled', reason: 'user' },
      }),
    );
    expect(await screen.findByRole('button', { name: '报名参加' })).toBeEnabled();
  });

  it('refreshes an already mounted readable detail after cleanup without applying local participant counts', async () => {
    vi.mocked(eventsApi.detail).mockResolvedValue({ ...activity, myRegistration: registration });
    const register = vi.spyOn(eventsApi, 'registration').mockResolvedValue({
      ok: true,
      registration: { ...registration, status: 'cancelled', reason: 'user' },
    });
    render(page());
    await screen.findByText('已确认报名');
    fireEvent.click(screen.getByText('无法查看活动？清理本人登记'));
    fireEvent.click(screen.getByRole('button', { name: '取消本人的登记' }));
    vi.mocked(eventsApi.detail).mockResolvedValue({
      ...activity,
      registeredCount: 0,
      myRegistration: { ...registration, status: 'cancelled', reason: 'user' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认清理本人登记' }));
    await screen.findByText('本人取消');
    expect(screen.queryByText('已确认报名')).not.toBeInTheDocument();
    expect(eventsApi.detail).toHaveBeenCalledTimes(2);
    expect(register).toHaveBeenCalledOnce();
    expect(screen.getByText(/已确认 0 \/ 2 位/)).toBeInTheDocument();
  });

  it.each(['suspended', 'removed'] as const)(
    'allows known-ID leave after %s without fetching an activity or roster',
    async (mode) => {
      if (mode === 'suspended')
        vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, status: 'suspended' });
      else
        vi.mocked(circlesApi.circle).mockRejectedValue(
          new ApiError('圈内访问权限已失效', 'forbidden', 403),
        );
      const register = vi.spyOn(eventsApi, 'registration').mockResolvedValue({
        ok: true,
        registration: { ...registration, status: 'cancelled', reason: 'user' },
      });
      render(page());
      await screen.findByText(mode === 'suspended' ? '圈子已暂停' : '圈内访问权限已失效');
      fireEvent.click(screen.getByText('无法查看活动？清理本人登记'));
      fireEvent.click(screen.getByRole('button', { name: '取消本人的登记' }));
      const dialog = screen.getByRole('dialog');
      expect(dialog).not.toHaveTextContent(activity.title);
      expect(register).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole('button', { name: '确认清理本人登记' }));
      await screen.findByText('服务器确认本人当前状态：本人取消。');
      expect(register).toHaveBeenCalledWith(
        circle.id,
        activity.id,
        'leave',
        expect.any(String),
        expect.any(AbortSignal),
      );
      expect(eventsApi.detail).not.toHaveBeenCalled();
      expect(screen.queryByText(activity.location)).not.toBeInTheDocument();
    },
  );
  it('aborts an old-account cleanup receipt without displaying it in the next account or opening private data', async () => {
    vi.mocked(circlesApi.circle).mockRejectedValue(new ApiError('当前不可访问', 'forbidden', 403));
    const write = deferred<RegistrationResult>(),
      register = vi.spyOn(eventsApi, 'registration').mockReturnValue(write.promise);
    const view = render(page());
    await screen.findByText('当前不可访问');
    fireEvent.click(screen.getByText('无法查看活动？清理本人登记'));
    fireEvent.click(screen.getByRole('button', { name: '取消本人的登记' }));
    fireEvent.click(screen.getByRole('button', { name: '确认清理本人登记' }));
    view.rerender(page(activityPath, signedIn(otherMember)));
    await screen.findByText('当前不可访问');
    expect(register.mock.calls[0][4]?.aborted).toBe(true);
    await act(async () =>
      write.resolve({
        ok: true,
        registration: { ...registration, status: 'cancelled', reason: 'user' },
      }),
    );
    expect(screen.queryByText('服务器确认本人当前状态：本人取消。')).not.toBeInTheDocument();
    expect(eventsApi.detail).not.toHaveBeenCalled();
  });
});
