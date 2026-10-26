import assert from 'node:assert/strict';
import { Blob, Buffer } from 'node:buffer';
import { randomFillSync, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// This creates local QA accounts and two inspectable community examples.
// Never send the development credentials or mutations to remote infrastructure.
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
  '圈子联调仅允许本机开发端口 /api/v1',
);
const origin = 'http://localhost:5173';
const stamp = randomUUID().replaceAll('-', '').slice(0, 10);
const checks = [];

function client() {
  let cookie = '',
    account = '';
  const transport = async (path, method, body, headers = {}) => {
    const response = await fetch(
      path.startsWith('/api/v1/') ? target.origin + path : target.href + path,
      {
        method,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: {
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(account ? { 'X-Gongming-Account': account } : {}),
          ...headers,
        },
      },
    );
    const next = response.headers.get('set-cookie');
    if (next) cookie = next.split(';')[0];
    return response;
  };
  async function result(response, method, path, expected) {
    const payload = await response.json();
    const accepted = Array.isArray(expected) ? expected : [expected];
    // Do not log request bodies, cookies or invitation tokens, including failures.
    assert.ok(
      accepted.includes(response.status),
      `${method} ${path.split('?')[0]}: status=${response.status}, code=${payload.error?.code || ''}`,
    );
    if (response.ok && ['/auth/register', '/auth/login'].includes(path))
      account = payload.data.user.id;
    return payload.data ?? payload.error;
  }
  return {
    json: async (path, method = 'GET', value, expected = 200, headers = {}) =>
      result(
        await transport(path, method, value === undefined ? undefined : JSON.stringify(value), {
          ...(value === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        }),
        method,
        path,
        expected,
      ),
    upload: async (circleId, raw, clientId, expected = 200) => {
      const path = circleId ? `/circles/${circleId}/media/images` : '/media/images';
      const form = new globalThis.FormData();
      form.append('file', new Blob([raw], { type: 'image/png' }), '圈子测试图.png');
      form.append('clientId', clientId);
      return result(await transport(path, 'POST', form), 'POST', path, expected);
    },
    image: async (url, expected = 200, method = 'GET') => {
      const response = await transport(url, method);
      await response.arrayBuffer();
      assert.equal(response.status, expected, `${method} circle image status differs`);
      return response;
    },
  };
}

// Procedural test pixels, not scraped photos. The server decodes/re-encodes them.
function png(width = 512, height = 320, noise = false) {
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, bytes) => {
    const name = Buffer.from(type),
      out = Buffer.alloc(bytes.length + 12);
    out.writeUInt32BE(bytes.length);
    name.copy(out, 4);
    bytes.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([name, bytes])), bytes.length + 8);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  if (noise) randomFillSync(rows);
  for (let y = 0; y < height; y++) rows[y * (width * 4 + 1)] = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * (width * 4 + 1) + x * 4 + 1;
      if (!noise) {
        rows[at] = 92 + Math.round((110 * x) / width);
        rows[at + 1] = 140 + Math.round((80 * y) / height);
        rows[at + 2] = 208;
      }
      rows[at + 3] = 255;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const guest = client(),
  owner = client(),
  bob = client(),
  carol = client(),
  admin = client();
const check = async (name, action) => {
  await action();
  checks.push(name);
  console.log(`✓ ${name}`);
};
const base = (circle) => `/circles/${circle.id}`;
const circleInput = (name, options = {}) => ({
  name,
  description: '真实服务联调示例，内容与成员权限由服务器保存。',
  category: '产品共建',
  icon: '🌿',
  cover: '',
  visibility: 'public',
  joinPolicy: 'open',
  clientId: randomUUID(),
  ...options,
});
const publicUser = (user) => {
  assert.ok(user.id && user.name && user.handle);
  for (const field of ['email', 'role', 'status', 'passwordHash']) assert.ok(!(field in user));
};
let a, b, c, community, privateCircle, channel, announcement, staff, image, photoPost, pendingPost;
try {
  await check('访客公开目录、真实三账号及平台管理员无普通成员特权', async () => {
    assert.equal((await guest.json('/health')).status, 'ok');
    a = (
      await owner.json('/auth/login', 'POST', {
        email: 'demo@gongming.local',
        password: 'Demo2026!',
      })
    ).user;
    [b, c] = await Promise.all(
      [
        [bob, 'b', '圈子同行者'],
        [carol, 'c', '圈子访客'],
      ].map(
        async ([api, code, name]) =>
          (
            await api.json(
              '/auth/register',
              'POST',
              {
                email: `circles_${code}_${stamp}@example.test`,
                handle: `circles_${code}_${stamp}`,
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
    assert.ok(Array.isArray((await guest.json('/circles?scope=discover')).items));
    await guest.json('/circles?scope=mine', 'GET', undefined, 401);
    await owner.json('/circles?scope=mine', 'GET', undefined, 409, { 'X-Gongming-Account': b.id });
  });
  await check('创建幂等、公开介绍不泄露正文、加入后默认频道与权限', async () => {
    const input = circleInput(`城市灵感实验室 ${stamp}`);
    community = await owner.json('/circles', 'POST', input, [200, 201]);
    assert.equal((await owner.json('/circles', 'POST', input, [200, 201])).id, community.id);
    await owner.json('/circles', 'POST', { ...input, name: '复用ID不能覆盖' }, 409);
    publicUser((await guest.json(base(community))).owner);
    await carol.json(`${base(community)}/channels`, 'GET', undefined, 404);
    await admin.json(`${base(community)}/channels`, 'GET', undefined, 404);
    assert.equal((await bob.json(`${base(community)}/join`, 'POST', {})).status, 'joined');
    await bob.json(`${base(community)}/join`, 'POST', {});
    assert.equal((await owner.json(base(community))).memberCount, 2);
    channel = (await owner.json(`${base(community)}/channels`)).items[0];
    assert.ok(channel && channel.kind === 'forum');
    await bob.json(
      `${base(community)}/channels`,
      'POST',
      { name: '不能越权', description: '', kind: 'forum', access: 'members' },
      403,
    );
  });
  await check('公告订阅者可互动、私密频道不可枚举、成员角色即时复查', async () => {
    announcement = await owner.json(
      `${base(community)}/channels`,
      'POST',
      {
        name: '圈主手记',
        description: '正式公告与共同讨论',
        kind: 'announcement',
        access: 'members',
      },
      [200, 201],
    );
    staff = await owner.json(
      `${base(community)}/channels`,
      'POST',
      { name: '共建工作间', description: '管理员讨论', kind: 'forum', access: 'staff' },
      [200, 201],
    );
    assert.ok(
      !(await bob.json(`${base(community)}/channels`)).items.some((x) => x.id === staff.id),
    );
    const post = await owner.json(
      `${base(community)}/posts`,
      'POST',
      {
        channelId: announcement.id,
        title: '欢迎加入城市灵感实验室',
        body: '这是服务器保存的公告。成员可以点赞与评论，公告主帖由圈主或管理员发布。',
        clientId: randomUUID(),
      },
      [200, 201],
    );
    await bob.json(
      `${base(community)}/posts`,
      'POST',
      {
        channelId: announcement.id,
        title: '不能冒充公告',
        body: '拒绝普通成员主帖',
        clientId: randomUUID(),
      },
      403,
    );
    assert.equal(
      (await bob.json(`${base(community)}/posts/${post.id}/like`, 'POST', { liked: true }))
        .likeCount,
      1,
    );
    await bob.json(
      `${base(community)}/posts/${post.id}/comments`,
      'POST',
      { body: '从这里开始，一起发现值得记录的小事。' },
      [200, 201],
    );
    await bob.json(`${base(community)}/posts?channelId=${staff.id}`, 'GET', undefined, 404);
    await owner.json(`${base(community)}/members/${b.id}`, 'PATCH', { role: 'admin' });
    assert.ok((await bob.json(`${base(community)}/channels`)).items.some((x) => x.id === staff.id));
    await owner.json(`${base(community)}/members/${b.id}`, 'PATCH', { role: 'member' });
    await bob.json(`${base(community)}/posts?channelId=${staff.id}`, 'GET', undefined, 404);
  });
  await check('私圈邀请、最后一次名额并发、审批与旧决定不可恢复成员', async () => {
    privateCircle = await owner.json(
      '/circles',
      'POST',
      circleInput(`共建内测小组 ${stamp}`, { visibility: 'private', joinPolicy: 'approval' }),
      [200, 201],
    );
    assert.ok(
      !(await guest.json('/circles?scope=discover')).items.some((x) => x.id === privateCircle.id),
    );
    await bob.json(base(privateCircle), 'GET', undefined, 404);
    await bob.json(`${base(privateCircle)}/join`, 'POST', {}, 404);
    const invite = await owner.json(
      `${base(privateCircle)}/invites`,
      'POST',
      { expiresInHours: 1, maxUses: 1 },
      [200, 201],
    );
    assert.ok(invite.token);
    const list = await owner.json(`${base(privateCircle)}/invites`);
    assert.ok(list.items.every((x) => !('token' in x)));
    assert.equal(
      (await bob.json('/circle-invites/preview', 'POST', { token: invite.token })).id,
      privateCircle.id,
    );
    const [first, retry] = await Promise.all(
      [1, 2].map(() =>
        bob.json(`${base(privateCircle)}/join`, 'POST', {
          inviteToken: invite.token,
          note: '这是申请审批的真实示例。',
        }),
      ),
    );
    assert.equal(first.status, 'pending');
    assert.equal(retry.request.id, first.request.id);
    assert.equal((await owner.json(`${base(privateCircle)}/invites`)).items[0].uses, 1);
    await carol.json(`${base(privateCircle)}/join`, 'POST', { inviteToken: invite.token }, 404);
    await owner.json(`${base(privateCircle)}/invites/${invite.id}`, 'DELETE');
    await bob.json(`${base(privateCircle)}/channels`, 'GET', undefined, 404);
    await admin.json(
      `${base(privateCircle)}/requests/${first.request.id}/respond`,
      'POST',
      { action: 'accept' },
      [403, 404],
    );
    await owner.json(`${base(privateCircle)}/requests/${first.request.id}/respond`, 'POST', {
      action: 'accept',
    });
    await owner.json(`${base(privateCircle)}/members/${b.id}/remove`, 'POST', { ban: false });
    await owner.json(`${base(privateCircle)}/requests/${first.request.id}/respond`, 'POST', {
      action: 'accept',
    });
    await bob.json(`${base(privateCircle)}/channels`, 'GET', undefined, 404);
    const another = await owner.json(
      `${base(privateCircle)}/invites`,
      'POST',
      { expiresInHours: 1, maxUses: 2 },
      [200, 201],
    );
    const request = await bob.json(`${base(privateCircle)}/join`, 'POST', {
      inviteToken: another.token,
    });
    await owner.json(`${base(privateCircle)}/requests/${request.request.id}/respond`, 'POST', {
      action: 'accept',
    });
  });
  await check('圈内图片作用域、待审、跨圈和世界引用隔离', async () => {
    const largePNG = png(640, 512, true);
    assert.ok(largePNG.length > 1024 * 1024, '真实圈上传也必须支持超过普通JSON上限的图片');
    const large = await owner.upload(community.id, largePNG, randomUUID());
    await owner.json(`/media/images/${large.id}`, 'DELETE');
    const clientId = randomUUID(),
      raw = png();
    image = await owner.upload(community.id, raw, clientId);
    assert.equal(image.scope, 'circle');
    assert.equal(image.circleId, community.id);
    assert.equal((await owner.upload(community.id, raw, clientId)).id, image.id);
    await owner.upload('', raw, clientId, 409);
    await carol.upload(community.id, raw, randomUUID(), 404);
    await guest.image(image.url, 404);
    await bob.image(image.url, 404);
    await owner.json('/posts', 'POST', { body: '圈图片不可外发到世界', images: [image.url] }, 400);
    const world = await owner.upload('', png(12, 8), randomUUID());
    await owner.json(
      `${base(community)}/posts`,
      'POST',
      {
        channelId: channel.id,
        title: '世界图不可冒充圈图',
        body: '检查固定作用域',
        images: [world.url],
        clientId: randomUUID(),
      },
      400,
    );
    const privateChannel = (await owner.json(`${base(privateCircle)}/channels`)).items[0];
    await owner.json(
      `${base(privateCircle)}/posts`,
      'POST',
      {
        channelId: privateChannel.id,
        title: '跨圈不可引用',
        body: '检查圈绑定',
        images: [image.url],
        clientId: randomUUID(),
      },
      400,
    );
    await owner.json(`/media/images/${world.id}`, 'DELETE');
    const input = {
      channelId: channel.id,
      title: '周末灵感板 · 圈内图片示例',
      body: '这张渐变测试图由真实上传服务保存，已通过圈内审核。只有当前圈成员可以读取，复制链接给访客不会公开原图。',
      images: [image.url],
      clientId: randomUUID(),
    };
    photoPost = await owner.json(`${base(community)}/posts`, 'POST', input, [200, 201]);
    assert.equal(photoPost.status, 'pending');
    assert.ok(
      (await owner.json(`${base(community)}/posts?status=pending`)).items.some(
        (post) => post.id === photoPost.id,
      ),
    );
    await bob.json(`${base(community)}/posts?status=pending`, 'GET', undefined, 403);
    assert.equal(
      (await owner.json(`${base(community)}/posts`, 'POST', input, [200, 201])).id,
      photoPost.id,
    );
    await owner.json(`${base(community)}/posts`, 'POST', { ...input, title: '冲突' }, 409);
    await bob.json(`${base(community)}/posts/${photoPost.id}`, 'GET', undefined, 404);
    await owner.json(`${base(community)}/posts/${photoPost.id}`, 'PATCH', {
      status: 'published',
      featured: true,
      pinned: true,
    });
    await bob.image(image.url);
    await guest.image(image.url, 404);
    await carol.image(image.url, 404);
    await owner.json(`/media/images/${image.id}`, 'DELETE', undefined, 409);
  });
  await check('圈子后台与举报、屏蔽联动、暂停与恢复均重新检查权限', async () => {
    await bob.json('/admin/circles', 'GET', undefined, 403);
    await bob.json(
      '/reports',
      'POST',
      {
        targetType: 'circle-post',
        targetId: photoPost.id,
        reason: '联调示例：请检查圈内图片可见权限。',
      },
      [200, 201],
    );
    await carol.json(
      '/reports',
      'POST',
      { targetType: 'circle-post', targetId: photoPost.id, reason: '非成员不能借举报访问' },
      404,
    );
    let asset = (await admin.json(`/admin/media?q=${image.id}`)).items[0];
    assert.equal(asset.publishedReferenceCount, 0);
    assert.equal(asset.circlePublishedReferenceCount, 1);
    assert.ok(asset.circlePosts.some((x) => x.id === photoPost.id && x.circleId === community.id));
    await admin.json(`/admin/media/${image.id}`, 'PATCH', {
      status: 'blocked',
      note: '联调：核验圈内引用同步隐藏',
    });
    assert.equal((await owner.json(`${base(community)}/posts/${photoPost.id}`)).status, 'hidden');
    await bob.image(image.url, 404);
    await owner.image(image.url, 404);
    await admin.image(image.url);
    await admin.json(`/admin/media/${image.id}`, 'PATCH', {
      status: 'ready',
      note: '联调：恢复原图仍需重新审核帖子',
    });
    await bob.image(image.url, 404);
    await admin.json(`/admin/circle-posts/${photoPost.id}`, 'PATCH', {
      status: 'published',
      note: '联调：重新审核发布',
    });
    await admin.json(`/admin/circles/${community.id}`, 'PATCH', {
      status: 'suspended',
      note: '联调：暂停圈子立即撤销普通内容访问',
    });
    await bob.json(`${base(community)}/posts/${photoPost.id}`, 'GET', undefined, [403, 404]);
    await bob.image(image.url, 404);
    assert.equal((await bob.json(base(community))).status, 'suspended');
    assert.ok(
      (await admin.json(`/admin/circle-posts?circleId=${community.id}`)).items.some(
        (x) => x.id === photoPost.id,
      ),
    );
    await admin.json(
      `/admin/circle-posts/${photoPost.id}`,
      'PATCH',
      { status: 'published', note: '暂停时不得发布' },
      409,
    );
    await admin.json(`/admin/circles/${community.id}`, 'PATCH', {
      status: 'active',
      note: '联调：恢复圈子，成员不变',
    });
    await bob.image(image.url);
  });
  await check('成员封禁、解禁不自动重入、转让与离开即时失权', async () => {
    await owner.json(`${base(community)}/members/${b.id}/remove`, 'POST', { ban: true });
    await bob.image(image.url, 404);
    await bob.json(`${base(community)}/join`, 'POST', {}, 403);
    await owner.json(`${base(community)}/members/${b.id}/unban`, 'POST', {});
    await bob.json(`${base(community)}/posts`, 'GET', undefined, 404);
    await bob.json(`${base(community)}/join`, 'POST', {});
    await bob.image(image.url);
    await owner.json(`${base(community)}/owner`, 'POST', { userId: b.id });
    await owner.json(`${base(community)}/members/${b.id}/remove`, 'POST', { ban: true }, 403);
    await bob.json(`${base(community)}/owner`, 'POST', { userId: a.id });
    await bob.json(`${base(community)}/leave`, 'POST', {});
    await bob.json(`${base(community)}/leave`, 'POST', {});
    await bob.image(image.url, 404);
    await bob.json(`${base(community)}/join`, 'POST', {});
  });
  await check('归档保留历史并禁止写入，私圈留下真实待审示例', async () => {
    const privateChannel = (await owner.json(`${base(privateCircle)}/channels`)).items[0];
    const privateImage = await owner.upload(privateCircle.id, png(320, 200), randomUUID());
    pendingPost = await owner.json(
      `${base(privateCircle)}/posts`,
      'POST',
      {
        channelId: privateChannel.id,
        title: '待审图文 · 共同完善圈子',
        body: '这条私圈图文仍待审核，作者与圈管理可从详情查看。普通成员还不能读取，后台可核验审批链路。',
        images: [privateImage.url],
        clientId: randomUUID(),
      },
      [200, 201],
    );
    await bob.json(`${base(privateCircle)}/posts/${pendingPost.id}`, 'GET', undefined, 404);
    const archived = await owner.json(
      '/circles',
      'POST',
      circleInput(`归档验收 ${stamp}`),
      [200, 201],
    );
    await bob.json(`${base(archived)}/join`, 'POST', {});
    const archivedChannel = (await owner.json(`${base(archived)}/channels`)).items[0];
    const input = {
      channelId: archivedChannel.id,
      title: '历史留存',
      body: '归档后仍可查看，不能新增互动。',
      clientId: randomUUID(),
    };
    const history = await owner.json(`${base(archived)}/posts`, 'POST', input, [200, 201]);
    await owner.json(base(archived), 'DELETE');
    await bob.json(`${base(archived)}/posts/${history.id}`);
    await owner.json(`${base(archived)}/posts`, 'POST', { ...input, clientId: randomUUID() }, 409);
    await bob.json(`${base(archived)}/posts/${history.id}/like`, 'POST', { liked: true }, 409);
    await admin.json(
      `/admin/circles/${archived.id}`,
      'PATCH',
      { status: 'active', note: '归档不可平台冒充恢复' },
      409,
    );
    await owner.json(`${base(archived)}/posts/${history.id}`, 'DELETE');
    await owner.json(`${base(archived)}/posts`, 'POST', input, 409);
  });
  mkdirSync('.runtime', { recursive: true, mode: 0o700 });
  writeFileSync(
    '.runtime/verify-circles-result.json',
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        checks,
        ownerId: a.id,
        memberId: b.id,
        publicCircle: community.id,
        privateCircle: privateCircle.id,
        publishedPost: photoPost.id,
        pendingPost: pendingPost.id,
        mediaId: image.id,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(`圈子真实联调完成：${checks.length}组；示例ID保存在忽略目录，不含凭据或邀请token。`);
} finally {
  await Promise.allSettled(
    [owner, bob, carol, admin].map((api) => api.json('/auth/logout', 'POST')),
  );
}
