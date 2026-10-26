import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

// This verifier creates disposable QA accounts and conversations, so it is
// deliberately limited to the project's local development ports.
function developmentTarget() {
  try {
    return new URL(process.env.API_URL || 'http://localhost:5173/api/v1');
  } catch {
    throw new Error('API_URL 不是有效的本机开发地址');
  }
}
const target = developmentTarget();
assert.ok(
  target.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) &&
    ['5173', '5174', '8080'].includes(target.port) &&
    target.pathname === '/api/v1' &&
    !target.username &&
    !target.password &&
    !target.search &&
    !target.hash,
  '社交联调只允许本机开发环境 5173 / 5174 / 8080 的 /api/v1',
);
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
const checks = [];
const stamp = randomUUID().replaceAll('-', '').slice(0, 10);
const password = `Qa_${randomUUID()}!`;
function client() {
  let cookie = '';
  let account = '';
  return async (path, method = 'GET', value, expected = 200, headers = {}) => {
    const response = await fetch(target.href + path, {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(account ? { 'X-Gongming-Account': account } : {}),
        ...(value === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload.error)}`);
    const next = response.headers.get('set-cookie');
    if (next) {
      assert.match(next, /HttpOnly/i);
      cookie = next.split(';')[0];
    }
    if (path === '/auth/register' && response.ok) account = payload.data.user.id;
    return payload.data ?? payload.error;
  };
}
async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`✓ ${name}`);
}
function publicProfile(person) {
  assert.ok(person.id && person.name && person.handle);
  for (const key of ['email', 'role', 'status', 'passwordHash']) assert.ok(!(key in person));
}
const guest = client();
const alice = client();
const bob = client();
const carol = client();
let a, b, c, direct, group, channel;
try {
  await check('本机代理、三账号会话与访客边界', async () => {
    assert.equal((await guest('/health')).status, 'ok');
    const records = await Promise.all(
      [
        [alice, 'a', '星岛甲'],
        [bob, 'b', '星岛乙'],
        [carol, 'c', '星岛丙'],
      ].map(
        async ([api, code, name]) =>
          (
            await api(
              '/auth/register',
              'POST',
              {
                email: `social_${code}_${stamp}@example.test`,
                password,
                handle: `social_${code}_${stamp}`,
                name,
              },
              201,
            )
          ).user,
      ),
    );
    [a, b, c] = records;
    await guest('/friends', 'GET', undefined, 401);
    await guest('/friend-requests', 'GET', undefined, 401);
    await alice('/friends', 'GET', undefined, 409, { 'X-Gongming-Account': b.id });
  });
  await check('目录和私聊不自动成为好友，申请单向幂等与隐私隔离', async () => {
    direct = await alice('/conversations', 'POST', {
      title: '星岛私聊联调',
      kind: 'direct',
      memberIds: [b.id],
    });
    await alice(`/conversations/${direct.id}/messages`, 'POST', {
      body: '移除好友后，这条原有私聊仍保留。',
      clientId: randomUUID(),
    });
    assert.equal((await alice(`/relationships/${b.id}`)).status, 'none');
    assert.equal((await alice('/friends')).total, 0);
    const request = await alice('/friend-requests', 'POST', {
      userId: b.id,
      note: '周末一起发现城市新故事。',
    });
    const retry = await alice('/friend-requests', 'POST', {
      userId: b.id,
      note: '重试不会覆盖原备注',
    });
    assert.deepEqual(retry, request);
    const incoming = (await bob('/friend-requests?direction=incoming')).items;
    assert.equal(incoming[0].id, request.id);
    publicProfile(incoming[0].from);
    publicProfile(incoming[0].to);
    await carol(`/friend-requests/${request.id}/respond`, 'POST', { action: 'accept' }, 404);
    await bob(`/friend-requests/${request.id}/respond`, 'POST', { action: 'cancel' }, 403);
    await bob('/friend-requests', 'POST', { userId: a.id }, 409);
    await alice('/friend-requests', 'POST', { userId: a.id }, 400);
    await bob(`/friend-requests/${request.id}/respond`, 'POST', { action: 'decline' });
    await bob(`/friend-requests/${request.id}/respond`, 'POST', { action: 'accept' }, 409);
    const cancelled = await alice('/friend-requests', 'POST', { userId: b.id, note: '稍后再联系' });
    await alice(`/friend-requests/${cancelled.id}/respond`, 'POST', { action: 'cancel' });
    assert.equal((await bob(`/relationships/${a.id}`)).status, 'none');
  });
  await check('接受建立双向好友，重复接受不复制，移除不删除私聊', async () => {
    const request = await bob('/friend-requests', 'POST', {
      userId: a.id,
      note: '现在一起加入吧。',
    });
    const accepted = await alice(`/friend-requests/${request.id}/respond`, 'POST', {
      action: 'accept',
    });
    assert.deepEqual(
      await alice(`/friend-requests/${request.id}/respond`, 'POST', { action: 'accept' }),
      accepted,
    );
    assert.equal((await alice(`/relationships/${b.id}`)).status, 'friends');
    assert.equal((await bob(`/relationships/${a.id}`)).status, 'friends');
    const friends = await alice(`/friends?q=${b.handle}&limit=1`);
    assert.equal(friends.total, 1);
    publicProfile(friends.items[0].user);
    assert.equal((await carol('/friends')).total, 0);
    await alice(`/friends/${b.id}`, 'DELETE');
    await alice(`/friends/${b.id}`, 'DELETE');
    assert.equal((await bob(`/relationships/${a.id}`)).status, 'none');
    assert.equal((await bob(`/conversations/${direct.id}/messages`)).items.length, 1);
    // Leave an accepted pair plus one pending request as inspectable QA examples.
    const again = await alice('/friend-requests', 'POST', { userId: b.id });
    await bob(`/friend-requests/${again.id}/respond`, 'POST', { action: 'accept' });
    await carol('/friend-requests', 'POST', { userId: b.id, note: '这是待处理申请的联调示例。' });
  });
  await check('群组详情、改名、添加与移除成员的服务端权限', async () => {
    group = await alice('/conversations', 'POST', {
      title: `星岛群组 ${stamp}`,
      kind: 'group',
      memberIds: [b.id],
    });
    await carol(`/conversations/${group.id}`, 'GET', undefined, 404);
    const detail = await bob(`/conversations/${group.id}`);
    assert.equal(detail.memberProfiles.length, 2);
    detail.memberProfiles.forEach(publicProfile);
    await bob(`/conversations/${group.id}`, 'PATCH', { title: '普通成员不能改名' }, 403);
    await bob(`/conversations/${group.id}/members`, 'POST', { memberIds: [c.id] }, 403);
    group = await alice(`/conversations/${group.id}`, 'PATCH', { title: `星岛会客厅 ${stamp}` });
    group = await alice(`/conversations/${group.id}/members`, 'POST', { memberIds: [c.id, c.id] });
    assert.equal(group.members.length, 3);
    const message = await alice(`/conversations/${group.id}/messages`, 'POST', {
      body: '成员变更后，历史仍留在当前群组。',
      clientId: randomUUID(),
    });
    await bob(`/conversations/${group.id}/read`, 'POST', { messageId: message.id });
    group = await alice(`/conversations/${group.id}/members/${b.id}`, 'DELETE');
    assert.ok(!group.members.includes(b.id));
    await bob(`/conversations/${group.id}/messages`, 'GET', undefined, 404);
    await bob(`/conversations/${group.id}/messages`, 'POST', { body: '移出后不能发言' }, 404);
    await bob(`/conversations/${group.id}`, 'GET', undefined, 404);
    await alice(`/conversations/${group.id}/members/${b.id}`, 'DELETE');
    await alice(`/conversations/${group.id}/members`, 'POST', { memberIds: [b.id] });
    assert.equal((await bob(`/conversations/${group.id}`)).conversation.readSeq, 0);
  });
  await check('群主转交、离开幂等及旧身份立即失权', async () => {
    await alice(`/conversations/${group.id}/leave`, 'POST', {}, 409);
    await alice(`/conversations/${group.id}/owner`, 'POST', { userId: b.id });
    await alice(`/conversations/${group.id}`, 'PATCH', { title: '旧群主不能管理' }, 403);
    await bob(`/conversations/${group.id}/leave`, 'POST', {}, 409);
    await alice(`/conversations/${group.id}/leave`, 'POST', {});
    await alice(`/conversations/${group.id}/leave`, 'POST', {});
    await alice('/conversations/unknown-conversation/leave', 'POST', {});
    await alice(`/conversations/${group.id}/messages`, 'GET', undefined, 404);
    assert.equal((await bob(`/conversations/${group.id}`)).conversation.ownerId, b.id);
  });
  await check('频道转交后发布权限变化，私聊管理拒绝', async () => {
    channel = await alice('/conversations', 'POST', {
      title: `星岛电台 ${stamp}`,
      kind: 'channel',
      memberIds: [b.id],
    });
    await bob(`/conversations/${channel.id}/messages`, 'POST', { body: '订阅者不能发布' }, 403);
    await alice(`/conversations/${channel.id}/owner`, 'POST', { userId: b.id });
    await alice(`/conversations/${channel.id}/messages`, 'POST', { body: '旧频道主不能发布' }, 403);
    await bob(`/conversations/${channel.id}/messages`, 'POST', {
      body: '新的频道主发布成功',
      clientId: randomUUID(),
    });
    await bob(`/conversations/${channel.id}/members/${a.id}`, 'DELETE');
    await alice(`/conversations/${channel.id}/messages`, 'GET', undefined, 404);
    await alice(`/conversations/${direct.id}`, 'PATCH', { title: '私聊不能改名' }, 400);
    await alice(`/conversations/${direct.id}/leave`, 'POST', {}, 400);
  });
  mkdirSync(new URL('../.runtime/', import.meta.url), { recursive: true, mode: 0o700 });
  writeFileSync(
    new URL('../.runtime/verify-social-result.json', import.meta.url),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks,
        examples: {
          accountIds: [a.id, b.id, c.id],
          direct: direct.id,
          group: group.id,
          channel: channel.id,
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`社交联调通过，共 ${checks.length} 组；本机 QA 示例已保留，未记录口令或 Cookie。`);
} catch (error) {
  console.error(`社交联调失败：${error.message}`);
  process.exitCode = 1;
}
