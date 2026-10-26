import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountEpoch, advanceAccountEpoch, setExpectedAccount } from './account-guard';
import { prepareAuthContext } from './auth-context';
import { platformApi } from './platformApi';
import { walletIdentityApi } from '@/features/walletidentity/api';
const context = { generation: 'context_generation_1', expiresAt: '2099-01-01T00:00:00Z' };
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status >= 400 ? { error: data } : { data }), { status });
afterEach(() => {
  vi.unstubAllGlobals();
  setExpectedAccount('');
});
describe('browser authentication context CAS', () => {
  it('checks the synchronous wallet guard after context lookup before dispatching verify', async () => {
    let finish!: (value: Response) => void,
      changed = false;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const pending = walletIdentityApi.bind({
      id: 'challenge_one',
      message: 'message',
      signature: 'signature',
      contextGeneration: context.generation,
      assertActive: () => {
        if (changed) throw new Error('wallet changed');
      },
    });
    const rejected = expect(pending).rejects.toThrow('wallet changed');
    changed = true;
    finish(response(context));
    await rejected;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/auth/context');
  });
  it.each(['login', 'register', 'logout'] as const)(
    'gets context before password %s and sends both browser headers',
    async (method) => {
      const fetcher = vi
        .fn()
        .mockImplementation(async (path: string) =>
          response(path.endsWith('/auth/context') ? context : { ok: true }),
        );
      vi.stubGlobal('fetch', fetcher);
      if (method === 'login') await platformApi.login('member@example.test', 'Example2026!');
      else if (method === 'register')
        await platformApi.register({
          email: 'new@example.test',
          password: 'Example2026!',
          name: '新成员',
          handle: 'new_member',
        });
      else await platformApi.logout();
      expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
        '/api/v1/auth/context',
        `/api/v1/auth/${method}`,
      ]);
      const headers = fetcher.mock.calls[1][1].headers as Headers;
      expect(headers.get('X-Gongming-Browser')).toBe('1');
      expect(headers.get('X-Gongming-Auth-Generation')).toBe(context.generation);
    },
  );
  it('refuses malformed context without dispatching credential replacement', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ generation: '', expiresAt: 'invalid' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(platformApi.logout()).rejects.toThrow('无法确认浏览器认证状态');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('does not submit a consumed signature after the browser generation changed', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(context));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      walletIdentityApi.login({
        id: 'challenge_one',
        message: 'message',
        signature: 'sig',
        contextGeneration: 'old',
      }),
    ).rejects.toMatchObject({ code: 'auth_context_changed' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('does not dispatch an auth write if the account changed during context lookup', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const operation = platformApi.login('member@example.test', 'Example2026!');
    const rejected = expect(operation).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
    advanceAccountEpoch();
    finish(response(context));
    await rejected;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(accountEpoch()).toBeGreaterThan(0);
  });
  it('never retries a rejected context CAS write', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(context))
      .mockResolvedValue(response({ code: 'auth_context_changed', message: '已更新' }, 409));
    vi.stubGlobal('fetch', fetcher);
    await expect(platformApi.logout()).rejects.toMatchObject({ code: 'auth_context_changed' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('cancels before any request when the caller has already gone away', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(prepareAuthContext(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
