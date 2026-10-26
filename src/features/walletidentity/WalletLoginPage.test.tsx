import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '@/features/platform/auth-context';
import { signedIn } from '@/features/platform/platform-test-fixtures';
import { ApiError } from '@/shared/api/client';
import WalletLoginPage from './WalletLoginPage';
import { walletIdentityApi } from './api';
import { walletConfig } from './test-helpers';
const guest: AuthState = { ...signedIn(), user: null, status: 'guest' };
const scene = (auth = guest, url = '/login/wallet') => (
  <MemoryRouter initialEntries={[url]}>
    <AuthContext.Provider value={auth}>
      <WalletLoginPage />
    </AuthContext.Provider>
  </MemoryRouter>
);
afterEach(() => vi.restoreAllMocks());
describe('wallet login entry', () => {
  it('shows disabled service honestly and sanitizes external return destinations', async () => {
    vi.spyOn(walletIdentityApi, 'config').mockResolvedValue({ ...walletConfig, enabled: false });
    render(scene(guest, '/login/wallet?returnTo=%2F%2Fevil.test%2Fsteal'));
    await screen.findByText('当前网站尚未启用钱包身份，请使用邮箱和密码登录。');
    expect(screen.getByRole('link', { name: '使用邮箱和密码' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Faccount',
    );
    expect(screen.queryByRole('button', { name: '签名并登录' })).not.toBeInTheDocument();
  });
  it('retains the strict internal destination when returning to email login', async () => {
    vi.spyOn(walletIdentityApi, 'config').mockResolvedValue({ ...walletConfig, enabled: false });
    render(scene(guest, '/login/wallet?returnTo=%2Fcircles%2Fs%2Fcircle_one%3Ftab%3Dmine'));
    expect(screen.getByRole('link', { name: '使用邮箱和密码' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fcircles%2Fs%2Fcircle_one%3Ftab%3Dmine',
    );
    await screen.findByText('当前网站尚未启用钱包身份，请使用邮箱和密码登录。');
  });
  it('does not offer signing when current account verification is unavailable', async () => {
    vi.spyOn(walletIdentityApi, 'config').mockResolvedValue(walletConfig);
    render(scene({ ...guest, status: 'unavailable', error: '当前账号无法验证' }));
    expect(screen.getByRole('alert')).toHaveTextContent('当前账号无法验证');
    expect(screen.queryByRole('region', { name: '钱包登录步骤' })).not.toBeInTheDocument();
    await Promise.resolve();
  });
  it('shows configuration failures with a retry instead of a fabricated wallet session', async () => {
    vi.spyOn(walletIdentityApi, 'config').mockRejectedValue(
      new ApiError('钱包服务暂不可达', 'NETWORK_ERROR', 0),
    );
    render(scene());
    await screen.findByText('钱包服务暂不可达');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '钱包登录步骤' })).not.toBeInTheDocument();
  });
});
