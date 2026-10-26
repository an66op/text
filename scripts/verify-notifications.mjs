import assert from 'node:assert/strict';
import { Blob, Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// Real development mutations only. Never send seed credentials or invite
// tokens to remote hosts, redirects, logs, or the saved result report.
const target = new URL(process.env.API_URL || 'http://localhost:5173/api/v1');
assert.ok(
  target.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) &&
    ['5173', '5174', '8080'].includes(target.port) &&
    target.pathname === '/api/v1' &&
    !target.username &&
    !target.password &&
    !target.search &&
    !target.hash,
  '通知联调仅允许本机开发端口 /api/v1',
);
const origin = 'http://localhost:5173',
  stamp = randomUUID().replaceAll('-', '').slice(0, 10),
  checks = [];
const internalNote = `内部处理说明_${stamp}_不得返回通知`;
function client() {
  let cookie = '',
    account = '';
  const request = async (
    path,
    method = 'GET',
    value,
    expected = 200,
    upload = false,
    headers = {},
  ) => {
    const response = await fetch(target.href + path, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(account ? { 'X-Gongming-Account': account } : {}),
        ...(value !== undefined && !upload ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(value === undefined ? {} : { body: upload ? value : JSON.stringify(value) }),
    });
    const payload = await response.json(),
      allowed = Array.isArray(expected) ? expected : [expected];
    assert.ok(
      allowed.includes(response.status),
      `${method} ${path.split('?')[0]}: status=${response.status}, code=${payload.error?.code || ''}`,
    );
    const next = response.headers.get('set-cookie');
    if (next) cookie = next.split(';')[0];
    if (response.ok && ['/auth/login', '/auth/register'].includes(path))
      account = payload.data.user.id;
    return payload.data ?? payload.error;
  };
  return {
    json: request,
    upload: async (circleId, clientId) => {
      const data = new globalThis.FormData();
      data.append('file', new Blob([png()], { type: 'image/png' }), '通知测试图.png');
      data.append('clientId', clientId);
      return request(
        circleId ? `/circles/${circleId}/media/images` : '/media/images',
        'POST',
        data,
        200,
        true,
      );
    },
  };
}
function png() {
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, data) => {
    const type = Buffer.from(name),
      out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    type.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc(Buffer.concat([type, data])), data.length + 8);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(3);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.from([0, 112, 175, 220, 255, 170, 150, 210, 255, 200, 180, 230, 255]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const guest = client(),
  owner = client(),
  bob = client(),
  carol = client(),
  admin = client();
const list = (api) => api.json('/notifications?limit=100');
const find = (items, kind, predicate = () => true) => {
  const value = items.find((x) => x.kind === kind && predicate(x));
  assert.ok(value, `missing ${kind} notification`);
  return value;
};
const circlePath = (circle) => `/circles/${circle.id}`;
const createCircle = (name, visibility = 'private', joinPolicy = 'approval') =>
  owner.json(
    '/circles',
    'POST',
    {
      name,
      description: `通知服务真实联调示例 ${stamp}`,
      category: '开发示例',
      icon: '🌱',
      cover: '',
      visibility,
      joinPolicy,
      clientId: randomUUID(),
    },
    [200, 201],
  );
const check = async (name, action) => {
  await action();
  checks.push(name);
  console.log(`✓ ${name}`);
};
function safeNotice(notice) {
  assert.match(notice.id, /^notice_[a-f0-9]{32}$/);
  assert.ok(['requests', 'interactions', 'system'].includes(notice.category));
  if (!notice.available) {
    assert.equal(notice.actor, null);
    assert.equal(notice.context, null);
    assert.equal(notice.target, null);
  }
  if (notice.category === 'system') assert.equal(notice.actor, null);
  if (notice.actor)
    for (const field of ['email', 'role', 'status', 'passwordHash'])
      assert.ok(!(field in notice.actor));
  assert.ok(!JSON.stringify(notice).includes(internalNote));
}
let a,
  b,
  c,
  world,
  privateCircle,
  publicCircle,
  privatePost,
  privateAsset,
  worldAsset,
  bobWorld,
  inviteToken;
let ownerNotice, bobNotice, lastExample;
try {
  await check('正常会话、访客/跨账号/来源隔离与严格已读参数', async () => {
    a = (
      await owner.json('/auth/login', 'POST', {
        email: 'demo@gongming.local',
        password: 'Demo2026!',
      })
    ).user;
    [b, c] = await Promise.all(
      [
        [bob, 'b', '通知同行者'],
        [carol, 'c', '通知申请者'],
      ].map(
        async ([api, code, name]) =>
          (
            await api.json(
              '/auth/register',
              'POST',
              {
                email: `notice_${code}_${stamp}@example.test`,
                handle: `notice_${code}_${stamp}`,
                name,
                password: `Qa_${randomUUID()}!`,
              },
              201,
            )
          ).user,
      ),
    );
    assert.equal(new Set([a.id, b.id, c.id]).size, 3);
    await admin.json('/auth/login', 'POST', {
      email: 'admin@gongming.local',
      password: 'Admin2026!',
    });
    await guest.json('/notifications', 'GET', undefined, 401);
    await guest.json('/notifications/unread', 'GET', undefined, 401);
    await owner.json('/notifications', 'GET', undefined, 409, false, {
      'X-Gongming-Account': b.id,
    });
    await owner.json('/notifications?category=unknown', 'GET', undefined, 400);
    await owner.json('/notifications?unread=maybe', 'GET', undefined, 400);
    await owner.json('/notifications/read-all', 'POST', {}, 400);
    await owner.json('/notifications/read-all', 'POST', { throughId: null }, 403, false, {
      Origin: 'http://untrusted.example',
    });
  });
  await check('好友申请、真实决定、幂等不刷通知与安全人物投影', async () => {
    const request = await owner.json('/friend-requests', 'POST', {
      userId: b.id,
      note: '这是通知收件箱的好友申请示例。',
    });
    await owner.json('/friend-requests', 'POST', { userId: b.id });
    let inbox = await list(bob);
    assert.equal(inbox.items.filter((x) => x.kind === 'friend-request').length, 1);
    bobNotice = find(inbox.items, 'friend-request');
    assert.equal(bobNotice.target.type, 'friend-requests');
    safeNotice(bobNotice);
    await bob.json(`/friend-requests/${request.id}/respond`, 'POST', { action: 'accept' });
    await bob.json(`/friend-requests/${request.id}/respond`, 'POST', { action: 'accept' });
    inbox = await list(owner);
    assert.equal(
      inbox.items.filter((x) => x.kind === 'friend-decision' && x.actor?.id === b.id).length,
      1,
    );
    assert.equal(
      find(inbox.items, 'friend-decision', (x) => x.actor?.id === b.id).outcome,
      'accepted',
    );
    const declined = await carol.json('/friend-requests', 'POST', { userId: a.id });
    await owner.json(`/friend-requests/${declined.id}/respond`, 'POST', { action: 'decline' });
    assert.equal(find((await list(carol)).items, 'friend-decision').outcome, 'declined');
  });
  await check('世界评论/点赞来源、反复点赞终身去重及本人不自通知', async () => {
    world = await owner.json('/posts', 'POST', {
      body: `通知联调 ${stamp}：评论与点赞来自真实账号，通知可打开对应动态。`,
      topic: '开发示例',
    });
    const before = (await list(owner)).total;
    await owner.json(`/posts/${world.id}/comments`, 'POST', { body: '作者本人评论不生成自通知。' });
    await owner.json(`/posts/${world.id}/like`, 'POST', { liked: true });
    assert.equal((await list(owner)).total, before);
    await bob.json(`/posts/${world.id}/comments`, 'POST', { body: '这是一条真实评论通知示例。' });
    for (const liked of [true, true, false, true])
      await bob.json(`/posts/${world.id}/like`, 'POST', { liked });
    const inbox = await list(owner);
    assert.equal(
      inbox.items.filter((x) => x.kind === 'world-like' && x.target?.postId === world.id).length,
      1,
    );
    ownerNotice = find(inbox.items, 'world-comment', (x) => x.target?.postId === world.id);
    assert.ok(ownerNotice.context.excerpt.includes(stamp));
    assert.equal(ownerNotice.actor.id, b.id);
    await carol.json(`/notifications/${ownerNotice.id}/read`, 'POST', {}, 404);
    await owner.json(`/notifications/${bobNotice.id}/read`, 'POST', {}, 404);
  });
  await check('圈内请求/审批与身份变更，管理降权即脱敏申请及私频道', async () => {
    privateCircle = await createCircle(`通知共建小组 ${stamp}`);
    const base = circlePath(privateCircle);
    const invitation = await owner.json(`${base}/invites`, 'POST', {
      maxUses: 3,
      expiresInHours: 2,
    });
    inviteToken = invitation.token;
    const joined = await bob.json(`${base}/join`, 'POST', {
      inviteToken,
      note: '希望一起完善通知体验。',
    });
    assert.ok(find((await list(owner)).items, 'circle-request').context.title.includes(stamp));
    await owner.json(`${base}/requests/${joined.request.id}/respond`, 'POST', { action: 'accept' });
    const decision = find((await list(bob)).items, 'circle-decision');
    assert.equal(decision.outcome, 'accepted');
    assert.equal(decision.available, true);
    await owner.json(`${base}/members/${b.id}`, 'PATCH', { role: 'admin' });
    const staff = await owner.json(`${base}/channels`, 'POST', {
      name: '私密协作',
      description: '管理可读',
      kind: 'forum',
      access: 'staff',
    });
    const staffPost = await bob.json(`${base}/posts`, 'POST', {
      channelId: staff.id,
      title: `管理私帖 ${stamp}`,
      body: '只有当前圈管理可以读取的通知上下文。',
      images: [],
      clientId: randomUUID(),
    });
    await owner.json(`${base}/posts/${staffPost.id}/comments`, 'POST', {
      body: '管理员协作评论。',
    });
    assert.equal(
      find((await list(bob)).items, 'circle-comment', (x) => x.target?.postId === staffPost.id)
        .available,
      true,
    );
    const waiting = await carol.json(`${base}/join`, 'POST', {
      inviteToken,
      note: '这条附言仅当前圈管理可以读取。',
    });
    assert.ok(find((await list(bob)).items, 'circle-request').context.excerpt.includes('附言'));
    await owner.json(`${base}/members/${b.id}`, 'PATCH', { role: 'member' });
    let inbox = await list(bob);
    for (const notice of inbox.items.filter((x) =>
      ['circle-request', 'circle-comment'].includes(x.kind),
    )) {
      assert.equal(notice.available, false);
      safeNotice(notice);
    }
    await owner.json(`${base}/requests/${waiting.request.id}/respond`, 'POST', {
      action: 'decline',
    });
    const rejected = find((await list(carol)).items, 'circle-decision');
    assert.equal(rejected.outcome, 'declined');
    assert.equal(rejected.available, false);
    safeNotice(rejected);
  });
  await check('圈图审核通知、媒体级联、暂停/恢复与离圈后的全量脱敏', async () => {
    const base = circlePath(privateCircle),
      channel = (await owner.json(`${base}/channels`)).items.find((x) => x.access === 'members');
    privateAsset = await bob.upload(privateCircle.id, randomUUID());
    privatePost = await bob.json(`${base}/posts`, 'POST', {
      channelId: channel.id,
      title: `圈内图文 ${stamp}`,
      body: '私圈通知须在读取时检查成员与频道权限。',
      images: [privateAsset.url],
      clientId: randomUUID(),
    });
    await owner.json(`${base}/posts/${privatePost.id}`, 'PATCH', { status: 'published' });
    await owner.json(`${base}/posts/${privatePost.id}/comments`, 'POST', {
      body: '圈图已通过审核，这是评论示例。',
    });
    for (const liked of [true, false, true])
      await owner.json(`${base}/posts/${privatePost.id}/like`, 'POST', { liked });
    let inbox = await list(bob);
    find(inbox.items, 'circle-review', (x) => x.outcome === 'published');
    find(inbox.items, 'circle-comment', (x) => x.target?.postId === privatePost.id);
    assert.equal(
      inbox.items.filter((x) => x.kind === 'circle-like' && x.target?.postId === privatePost.id)
        .length,
      1,
    );
    await admin.json(`/admin/media/${privateAsset.id}`, 'PATCH', {
      status: 'blocked',
      note: internalNote,
    });
    inbox = await list(bob);
    find(inbox.items, 'media-review', (x) => x.outcome === 'blocked');
    find(inbox.items, 'circle-review', (x) => x.outcome === 'hidden');
    await admin.json(`/admin/media/${privateAsset.id}`, 'PATCH', {
      status: 'ready',
      note: internalNote,
    });
    await owner.json(`${base}/posts/${privatePost.id}`, 'PATCH', { status: 'published' });
    await admin.json(`/admin/circles/${privateCircle.id}`, 'PATCH', {
      status: 'suspended',
      note: internalNote,
    });
    inbox = await list(bob);
    assert.ok(
      inbox.items
        .filter((x) => ['circle-comment', 'circle-like', 'circle-review'].includes(x.kind))
        .every((x) => !x.available),
    );
    assert.equal(
      find(inbox.items, 'circle-status', (x) => x.outcome === 'suspended').available,
      true,
    );
    await admin.json(`/admin/circles/${privateCircle.id}`, 'PATCH', {
      status: 'active',
      note: internalNote,
    });
    await owner.json(`${base}/members/${b.id}/remove`, 'POST', { ban: true });
    inbox = await list(bob);
    for (const notice of inbox.items.filter((x) => x.kind.startsWith('circle-'))) {
      assert.equal(notice.available, false);
      safeNotice(notice);
    }
    assert.ok(!JSON.stringify(inbox).includes(privateCircle.name));
    // The author can clear known references without regaining private content.
    await bob.json(`${base}/posts/${privatePost.id}`, 'GET', undefined, 404);
    assert.equal(
      (await bob.json(`/me/media?q=${privateAsset.id}`)).items[0].circleReferenceCount,
      1,
    );
    await bob.json(`${base}/posts/${privatePost.id}`, 'DELETE');
    assert.equal((await bob.json(`/me/media?q=${privateAsset.id}`)).items[0].referenceCount, 0);
    await bob.json(`/media/images/${privateAsset.id}`, 'DELETE');
    assert.equal(find((await list(bob)).items, 'media-review', (x) => !x.available).target, null);
  });
  await check('世界与原图审核、举报结案及内部说明无旁路', async () => {
    worldAsset = await bob.upload('', randomUUID());
    bobWorld = await bob.json('/posts', 'POST', {
      body: `审核通知示例 ${stamp}：此图可在我的上传中管理。`,
      images: [worldAsset.url],
      topic: '开发示例',
    });
    await admin.json(`/admin/posts/${bobWorld.id}`, 'PATCH', { status: 'published' });
    await admin.json(`/admin/media/${worldAsset.id}`, 'PATCH', {
      status: 'blocked',
      note: internalNote,
    });
    const report = await bob.json('/reports', 'POST', {
      targetType: 'post',
      targetId: world.id,
      reason: '开发通知联调示例，请测试结案通知。',
    });
    await admin.json(`/admin/reports/${report.id}`, 'PATCH', {
      status: 'resolved',
      note: internalNote,
    });
    const inbox = await list(bob);
    find(inbox.items, 'world-review', (x) => x.outcome === 'published');
    find(inbox.items, 'world-review', (x) => x.outcome === 'hidden');
    const review = find(inbox.items, 'report-review');
    assert.equal(review.outcome, 'resolved');
    assert.equal(review.context, null);
    assert.equal(review.target, null);
    inbox.items.forEach(safeNotice);
    assert.ok(!JSON.stringify(inbox).includes(inviteToken));
  });
  await check('所有者转交/归档通知、按用户序号分页与一致计数', async () => {
    publicCircle = await createCircle(`通知归档实例 ${stamp}`, 'public', 'open');
    const base = circlePath(publicCircle);
    await bob.json(`${base}/join`, 'POST', {});
    await owner.json(`${base}/owner`, 'POST', { userId: b.id });
    find((await list(bob)).items, 'circle-membership', (x) => x.outcome === 'owner');
    await bob.json(`${base}/owner`, 'POST', { userId: a.id });
    await owner.json(base, 'DELETE');
    const archived = find(
      (await list(bob)).items,
      'circle-status',
      (x) => x.outcome === 'archived',
    );
    assert.equal(archived.available, true);
    const all = await list(bob),
      first = await bob.json('/notifications?limit=2'),
      next = await bob.json('/notifications?limit=2&offset=2');
    assert.equal(first.total, all.total);
    assert.equal(first.throughId, all.throughId);
    assert.equal(next.throughId, all.throughId);
    assert.equal(new Set([...first.items, ...next.items].map((x) => x.id)).size, 4);
    assert.equal((await bob.json('/notifications/unread')).unreadTotal, all.unreadTotal);
    all.items.forEach(safeNotice);
  });
  await check('单条已读幂等、批量截至快照保护新到通知并保留可体验未读', async () => {
    const read = await owner.json(`/notifications/${ownerNotice.id}/read`, 'POST', {});
    const again = await owner.json(`/notifications/${ownerNotice.id}/read`, 'POST', {});
    assert.equal(again.readAt, read.readAt);
    const snapshot = await owner.json('/notifications?category=system&limit=1');
    assert.ok(snapshot.throughId);
    await owner.json('/notifications/read-all', 'POST', { throughId: bobNotice.id }, 404);
    const beforeNull = (await owner.json('/notifications/unread')).unreadTotal;
    const noOp = await owner.json('/notifications/read-all', 'POST', { throughId: null });
    assert.equal(noOp.markedRead, 0);
    assert.equal(noOp.unreadTotal, beforeNull);
    await bob.json(`/posts/${world.id}/comments`, 'POST', {
      body: '列表快照之后到达，这次批量已读不能覆盖。',
    });
    const newId = (await list(owner)).throughId;
    assert.notEqual(newId, snapshot.throughId);
    await owner.json('/notifications/read-all', 'POST', { throughId: snapshot.throughId });
    assert.equal((await list(owner)).items.find((x) => x.id === newId).readAt, null);
    assert.equal(
      (await owner.json('/notifications/read-all', 'POST', { throughId: snapshot.throughId }))
        .markedRead,
      0,
    );
    await owner.json(`/notifications/${newId}/read`, 'POST', {});
    await bob.json(`/posts/${world.id}/comments`, 'POST', {
      body: '欢迎体验站内通知：点击铃铛后可打开这条真实评论对应的动态。',
    });
    const pending = await carol.json(`${circlePath(privateCircle)}/join`, 'POST', {
      inviteToken,
      note: '开发示例：这是一条可从通知打开并处理的真实待审申请。',
    });
    assert.equal(pending.status, 'pending');
    lastExample = (await list(owner)).throughId;
    assert.ok((await owner.json('/notifications/unread')).unreadTotal >= 2);
    (await list(owner)).items.forEach(safeNotice);
  });
  mkdirSync('.runtime', { recursive: true, mode: 0o700 });
  writeFileSync(
    '.runtime/verify-notifications-result.json',
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        checks,
        ownerId: a.id,
        memberId: b.id,
        applicantId: c.id,
        worldPost: world.id,
        privateCircle: privateCircle.id,
        archivedCircle: publicCircle.id,
        unreadExample: lastExample,
        reviewPost: bobWorld.id,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(
    `通知真实联调完成：${checks.length}组，报告只保留示例ID，不含凭据、邀请token或内部说明。`,
  );
} finally {
  await Promise.allSettled(
    [owner, bob, carol, admin].map((api) => api.json('/auth/logout', 'POST')),
  );
}
