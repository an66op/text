import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SystemPage from './SystemPage';

afterEach(() => vi.unstubAllGlobals());

describe('wallet capability boundaries', () => {
  it('shows server-provided identity capabilities and security boundaries without fetching wallet owners', async () => {
    const fetcher = vi.fn().mockImplementation((path: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: path.endsWith('/health')
              ? { ok: true }
              : {
                  version: '0.9.0',
                  storage: 'PostgreSQL',
                  environment: 'development',
                  uptimeSeconds: 45,
                  features: [
                    'wallet-identity',
                    'siwe-eoa-authentication',
                    'browser-auth-cas',
                    'wallet-session-revocation',
                  ],
                },
          }),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    render(<SystemPage />);
    expect(await screen.findByText('本人钱包绑定与身份管理')).toBeInTheDocument();
    expect(screen.getByText('EOA 钱包签名登录')).toBeInTheDocument();
    expect(screen.getByText('浏览器认证版本与并发保护')).toBeInTheDocument();
    expect(screen.getByText('解绑钱包与来源会话撤销')).toBeInTheDocument();
    expect(screen.getByText(/工作台只展示能力与安全审计/)).toHaveTextContent(
      '不代绑、代签或转移他人钱包',
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls.map(([path]) => path).sort()).toEqual([
      '/api/v1/admin/system',
      '/api/v1/health',
    ]);
    expect(screen.queryByRole('button', { name: /绑定钱包/ })).not.toBeInTheDocument();
  });

  it('does not claim wallet identity is enabled when the backend omits that feature', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                version: '0.8.0',
                storage: 'PostgreSQL',
                environment: 'development',
                uptimeSeconds: 1,
                features: [],
              },
            }),
          ),
        ),
      ),
    );
    render(<SystemPage />);
    await screen.findByText('服务端未提供能力列表。');
    expect(screen.queryByText('钱包身份与资产分开')).not.toBeInTheDocument();
  });
});
