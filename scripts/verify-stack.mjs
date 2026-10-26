import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = process.env.API_URL || 'http://127.0.0.1:8080/api/v1';
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
const checks = [];
function client() {
  let cookie = '';
  return async (path, method = 'GET', body, expected = 200, extra = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
    const nextCookie = response.headers.get('set-cookie');
    if (nextCookie) {
      assert.match(nextCookie, /HttpOnly/i);
      assert.match(nextCookie, /SameSite=Lax/i);
      cookie = nextCookie.split(';')[0];
    }
    return payload.data ?? payload.error;
  };
}
async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`✓ ${name}`);
}
const publicApi = client();
const admin = client();
const alice = client();
const bob = client();
const stamp = randomUUID().replaceAll('-', '').slice(0, 10);
const password = `Verify_${randomUUID()}!`;
let a;
let b;
let post;
let channel;
try {
  await check('Go API 与 PostgreSQL 健康检查', async () => {
    assert.equal((await publicApi('/health')).status, 'ok');
  });
  await check('注册、HttpOnly 会话与账号隔离', async () => {
    a = (
      await alice(
        '/auth/register',
        'POST',
        {
          email: `verify_a_${stamp}@example.test`,
          password,
          name: '联调测试甲',
          handle: `qa_a_${stamp}`,
        },
        201,
      )
    ).user;
    b = (
      await bob(
        '/auth/register',
        'POST',
        {
          email: `verify_b_${stamp}@example.test`,
          password,
          name: '联调测试乙',
          handle: `qa_b_${stamp}`,
        },
        201,
      )
    ).user;
    assert.equal((await alice('/auth/me')).user.id, a.id);
    assert.equal((await bob('/auth/me')).user.id, b.id);
    await publicApi('/auth/me', 'GET', undefined, 401);
    await alice('/admin/overview', 'GET', undefined, 403);
    await alice('/posts', 'POST', { body: '非法来源' }, 403, {
      Origin: 'https://untrusted.example',
    });
  });
  await check('社区发布、评论、点赞幂等与权限校验', async () => {
    post = await alice('/posts', 'POST', {
      body: `全栈联调示例 ${stamp}：内容、评论与审核已串联。`,
      topic: '产品共建',
      images: [],
    });
    assert.ok(!('email' in post.author) && !('role' in post.author));
    const likes = await bob(`/posts/${post.id}/like`, 'POST', { liked: true });
    const repeated = await bob(`/posts/${post.id}/like`, 'POST', { liked: true });
    assert.equal(likes.likeCount, repeated.likeCount);
    await bob(`/posts/${post.id}/comments`, 'POST', { body: '跨账号评论联调成功' });
    const comments = (await publicApi(`/posts/${post.id}/comments`)).items;
    assert.equal(comments.length, 1);
    assert.ok(!('email' in comments[0].author));
    await bob(`/posts/${post.id}`, 'DELETE', undefined, 403);
  });
  await check('成员通讯、频道发布权限与会话隔离', async () => {
    const conversation = await alice('/conversations', 'POST', {
      title: `联调私聊 ${stamp}`,
      kind: 'direct',
      memberIds: [b.id],
    });
    await alice(`/conversations/${conversation.id}/messages`, 'POST', {
      body: '这是一条保存在 PostgreSQL 的消息',
    });
    assert.equal(
      (await bob(`/conversations/${conversation.id}/messages`)).items[0].sender.id,
      a.id,
    );
    await publicApi(`/conversations/${conversation.id}/messages`, 'GET', undefined, 401);
    channel = await alice('/conversations', 'POST', {
      title: `联调广播 ${stamp}`,
      kind: 'channel',
      memberIds: [b.id],
    });
    await bob(`/conversations/${channel.id}/messages`, 'POST', { body: '订阅成员不能发布' }, 403);
    await alice(`/conversations/${channel.id}/messages`, 'POST', { body: '频道主发布成功' });
  });
  await check('个人备份版本冲突、白名单与账号隔离', async () => {
    const document = await alice('/documents/drafts', 'PUT', {
      value: { version: 1, data: '可恢复的演示草稿' },
      revision: 0,
    });
    assert.equal(document.revision, 1);
    await alice(
      '/documents/drafts',
      'PUT',
      { value: { version: 1, data: '过期写入' }, revision: 0 },
      409,
    );
    assert.equal((await bob('/documents')).items.length, 0);
    await alice('/documents/wallet', 'PUT', { value: { balance: 999999 }, revision: 0 }, 400);
  });
  await check('测试账本补给与转送幂等、余额守恒、失败回滚', async () => {
    const faucetId = randomUUID();
    const transferId = randomUUID();
    const first = await alice('/wallet/faucet', 'POST', { requestId: faucetId });
    assert.deepEqual(await alice('/wallet/faucet', 'POST', { requestId: faucetId }), first);
    const result = await alice('/wallet/transfer', 'POST', {
      recipientHandle: b.handle,
      amount: '2900',
      requestId: transferId,
    });
    assert.equal(result.assets[0].balance, '97100');
    assert.deepEqual(
      await alice('/wallet/transfer', 'POST', {
        recipientHandle: b.handle,
        amount: '2900',
        requestId: transferId,
      }),
      result,
    );
    const received = await bob('/wallet');
    assert.equal(received.assets[0].balance, '2900');
    assert.equal(BigInt(result.assets[0].balance) + BigInt(received.assets[0].balance), 100000n);
    await alice(
      '/wallet/transfer',
      'POST',
      { recipientHandle: b.handle, amount: '999999', requestId: randomUUID() },
      422,
    );
    assert.equal((await alice('/wallet')).assets[0].balance, '97100');
    await alice(
      '/wallet/transfer',
      'POST',
      { recipientHandle: b.handle, amount: '3000', requestId: transferId },
      409,
    );
  });
  await check('运营登录、举报处理、下架生效与审计留痕', async () => {
    const session = await admin('/auth/login', 'POST', {
      email: process.env.ADMIN_EMAIL || 'admin@gongming.local',
      password: process.env.ADMIN_PASSWORD || 'Admin2026!',
    });
    assert.equal(session.user.role, 'admin');
    await admin(`/conversations/${channel.id}/messages`, 'GET', undefined, 404);
    const report = await bob('/reports', 'POST', {
      targetType: 'post',
      targetId: post.id,
      reason: '全栈自动联调审核示例',
    });
    assert.equal((await admin(`/admin/posts?q=${post.id}`)).items[0].id, post.id);
    assert.equal((await admin(`/admin/users?q=${a.id}`)).items[0].id, a.id);
    await admin(`/admin/reports/${report.id}`, 'PATCH', { status: 'resolved', note: '' }, 400);
    await admin(`/admin/posts/${post.id}`, 'PATCH', { status: 'hidden' });
    await publicApi(`/posts/${post.id}`, 'GET', undefined, 404);
    await admin(`/admin/reports/${report.id}`, 'PATCH', {
      status: 'resolved',
      note: '联调示例：确认下架并留痕',
    });
    await admin(
      `/admin/reports/${report.id}`,
      'PATCH',
      { status: 'dismissed', note: '重复处理不可覆盖' },
      409,
    );
    assert.ok(
      (await admin('/admin/audit?limit=100')).items.some((entry) => entry.targetId === post.id),
    );
    assert.ok((await admin('/admin/overview')).users >= 4);
    await admin(`/admin/users/${session.user.id}`, 'PATCH', { role: 'member' }, 403);
  });
  await check('退出后旧会话失效', async () => {
    await alice('/auth/logout', 'POST', {});
    await alice('/auth/me', 'GET', undefined, 401);
  });
  const dir = fileURLToPath(new URL('../.runtime/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    new URL('../.runtime/verify-result.json', import.meta.url),
    JSON.stringify({ verifiedAt: new Date().toISOString(), checks }, null, 2),
  );
  console.log(
    `\n${checks.length} 组真实 HTTP / PostgreSQL 联调通过。测试账号与审核记录保留在本地数据库，便于查看。`,
  );
} catch (error) {
  console.error(`\n联调失败：${error.message}`);
  process.exitCode = 1;
}
