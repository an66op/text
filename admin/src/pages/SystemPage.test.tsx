import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SystemPage from './SystemPage';

afterEach(() => vi.unstubAllGlobals());

describe('wallet capability boundaries', () => {
  it('labels private contact capabilities without requesting private policies or block relationships', async () => {
    const fetcher = vi.fn().mockImplementation((path: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: path.endsWith('/health')
              ? { ok: true }
              : {
                  version: '0.11.0',
                  storage: 'PostgreSQL · relational schema v11',
                  environment: 'development',
                  uptimeSeconds: 1,
                  features: [
                    'contact-privacy',
                    'private-blocklist',
                    'contact-write-guards',
                    'permission-aware-discovery',
                  ],
                },
          }),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    render(<SystemPage />);
    await screen.findByText('本人私人联系准入设置');
    for (const label of ['本人私有黑名单', '联系写入权限与并发保护', '按本人设置控制陌生成员发现'])
      expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('版本 0.11.0')).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls.map(([path]) => path).sort()).toEqual([
      '/api/v1/admin/system',
      '/api/v1/health',
    ]);
  });
  it('labels message capabilities and keeps conversation originals outside operational access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                version: '0.10.0',
                storage: 'PostgreSQL',
                environment: 'development',
                uptimeSeconds: 1,
                features: [
                  'conversation-image-messages',
                  'message-replies',
                  'message-retraction',
                  'message-mutation-sync',
                ],
              },
            }),
          ),
        ),
      ),
    );
    render(<SystemPage />);
    await screen.findByText('会话私有图片消息');
    for (const label of ['同会话单层引用回复', '作者撤回与终态保护', '旧消息变更与版本补漏'])
      expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/上传者与平台角色均不能绕过/)).toHaveTextContent(
      '不加载聊天原图、消息正文、参与者或会话关系',
    );
    expect(screen.getByText('版本 0.10.0')).toBeInTheDocument();
  });
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
