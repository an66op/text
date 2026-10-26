import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '@/shared/api/client';
import { AuthContext } from '@/features/platform/auth-context';
import { member, otherMember, signedIn } from '@/features/platform/platform-test-fixtures';
import type { PlatformUser } from '@/shared/api/types';
import AccountSyncPage from './AccountSyncPage';
import type { PersonalDocument } from './sync-model';

const document = (key = 'drafts', revision = 1): PersonalDocument => ({
  key,
  revision,
  updatedAt: '2026-10-27T08:00:00Z',
  value: { version: 1, data: key === 'bookshelf' ? ['novel-1'] : '账号上的草稿' },
});
const scene = (user: PlatformUser = member) => (
  <MemoryRouter>
    <AuthContext.Provider value={signedIn(user)}>
      <AccountSyncPage />
    </AuthContext.Provider>
  </MemoryRouter>
);
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('explicit account backup interactions', () => {
  it('never reads account documents for guests', () => {
    const request = vi.spyOn(client, 'apiRequest');
    render(
      <MemoryRouter>
        <AccountSyncPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Faccount%2Fsync',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('uploads only after confirmation and re-reads newer revisions after 409', async () => {
    localStorage.setItem('content-publish-draft', JSON.stringify('本机新草稿'));
    let remote = document();
    let writes = 0;
    const request = vi.spyOn(client, 'apiRequest').mockImplementation(async (path, init) => {
      if (path === '/documents') return { items: [remote], total: 1 } as never;
      writes += 1;
      if (writes === 1) {
        remote = document('drafts', 2);
        throw new client.ApiError('云端资料已更新', 'revision_conflict', 409);
      }
      expect(JSON.parse(String(init?.body))).toEqual({
        value: { version: 1, data: '本机新草稿' },
        revision: 2,
      });
      remote = { ...document('drafts', 3), value: { version: 1, data: '本机新草稿' } };
      return remote as never;
    });
    render(scene());
    await screen.findByText('版本 1');
    fireEvent.click(screen.getByRole('checkbox', { name: /动态草稿/ }));
    fireEvent.click(screen.getByRole('button', { name: '备份所选' }));
    expect(writes).toBe(0);
    const review = screen.getByRole('region', { name: '确认个人备份操作' });
    expect(within(review).getByText('账号版本 1 → 2')).toBeInTheDocument();
    fireEvent.click(within(review).getByRole('button', { name: '确认执行' }));
    await screen.findByText('版本 2');
    expect(screen.getByRole('alert')).toHaveTextContent('云端资料已更新');
    expect(screen.queryByRole('region', { name: '确认个人备份操作' })).not.toBeInTheDocument();
    expect(writes).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '备份所选' }));
    expect(screen.getByText('账号版本 2 → 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await screen.findByText('1 项已备份到当前账号');
    await screen.findByText('版本 3');
    expect(request.mock.calls.filter(([path]) => path === '/documents/drafts')).toHaveLength(2);
  });

  it('does not continue a multi-document upload after the account changes', async () => {
    localStorage.setItem('content-publish-draft', JSON.stringify('本机草稿'));
    localStorage.setItem('content-bookshelf-ids', JSON.stringify(['novel-1']));
    let finishFirst!: (value: PersonalDocument) => void;
    const request = vi.spyOn(client, 'apiRequest').mockImplementation((path) =>
      path === '/documents'
        ? (Promise.resolve({ items: [], total: 0 }) as never)
        : (new Promise<PersonalDocument>((resolve) => {
            finishFirst = resolve;
          }) as never),
    );
    const view = render(scene());
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /动态草稿/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('checkbox', { name: /动态草稿/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /我的书架/ }));
    fireEvent.click(screen.getByRole('button', { name: '备份所选' }));
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    view.rerender(scene(otherMember));
    await screen.findByText('@other');
    await act(async () => {
      finishFirst(document());
    });
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    expect(screen.queryByText(/项已备份到当前账号/)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /动态草稿/ })).toBeEnabled();
  });

  it('discards stale remote backup reads after account switching', async () => {
    let finishOld!: (value: { items: PersonalDocument[] }) => void;
    let reads = 0;
    vi.spyOn(client, 'apiRequest').mockImplementation(() =>
      ++reads === 1
        ? (new Promise((resolve) => {
            finishOld = resolve;
          }) as never)
        : (Promise.resolve({ items: [document('drafts', 2)] }) as never),
    );
    const view = render(scene());
    view.rerender(scene(otherMember));
    await screen.findByText('版本 2');
    await act(async () => {
      finishOld({ items: [document('drafts', 11)] });
    });
    expect(screen.getByText('版本 2')).toBeInTheDocument();
    expect(screen.queryByText('版本 11')).not.toBeInTheDocument();
  });

  it('validates restored domains and changes local state only after confirmation', async () => {
    localStorage.setItem('content-publish-draft', JSON.stringify('本机内容'));
    localStorage.setItem('wallet', JSON.stringify({ balance: 123 }));
    const request = vi.spyOn(client, 'apiRequest').mockResolvedValue({
      items: [document(), { ...document('wallet'), value: { version: 1, data: { balance: 999 } } }],
    });
    render(scene());
    await screen.findByText('版本 1');
    fireEvent.click(screen.getByRole('checkbox', { name: /动态草稿/ }));
    fireEvent.click(screen.getByRole('button', { name: '恢复所选' }));
    expect(JSON.parse(localStorage.getItem('content-publish-draft')!)).toBe('本机内容');
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await screen.findByText('1 项已恢复到这台设备');
    expect(JSON.parse(localStorage.getItem('content-publish-draft')!)).toBe('账号上的草稿');
    expect(JSON.parse(localStorage.getItem('wallet')!)).toEqual({ balance: 123 });
    expect(request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('rejects malformed supported cloud data and disables restore until a valid refresh', async () => {
    vi.spyOn(client, 'apiRequest').mockResolvedValue({
      items: [{ ...document(), value: { version: 2, data: 'unknown format' } }],
    });
    render(scene());
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '恢复所选' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /动态草稿/ })).toBeDisabled();
    expect(localStorage.getItem('content-publish-draft')).toBeNull();
  });
});
