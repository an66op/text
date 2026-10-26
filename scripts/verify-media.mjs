import assert from 'node:assert/strict';
import { Blob, Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// Creates local QA assets/posts, including two readable product examples.
// Refuse redirects and non-local targets before using development credentials.
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
  '媒体联调仅允许本机开发端口 /api/v1',
);
const origin = 'http://localhost:5173';
const stamp = randomUUID().slice(0, 10);
const checks = [];

function png(width, height, variant = 0) {
  function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const name = Buffer.from(type);
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    name.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
    return out;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * (width * 4 + 1) + 1 + x * 4;
      rows[at] = 180 + Math.round((65 * x) / width);
      rows[at + 1] = 150 + Math.round((85 * y) / height);
      rows[at + 2] = 190 + (variant ? 30 : Math.round(50 * (1 - x / width)));
      rows[at + 3] = 255;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function client() {
  let cookie = '',
    account = '';
  const transport = async (path, method, body, headers = {}) => {
    const url = path.startsWith('/api/v1/') ? target.origin + path : target.href + path;
    const res = await fetch(url, {
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
    });
    const next = res.headers.get('set-cookie');
    if (next) cookie = next.split(';')[0];
    return res;
  };
  const json = async (path, method = 'GET', value, expected = 200, headers) => {
    const res = await transport(
      path,
      method,
      value === undefined ? undefined : JSON.stringify(value),
      { ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    );
    const payload = await res.json();
    assert.equal(
      res.status,
      expected,
      `${method} ${path}: status=${res.status}, code=${payload.error?.code || ''}`,
    );
    if (res.ok && ['/auth/login', '/auth/register'].includes(path)) account = payload.data.user.id;
    return payload.data ?? payload.error;
  };
  return {
    json,
    upload: async (raw, clientId, expected = 200, headers) => {
      const form = new globalThis.FormData();
      // The original filename/type do not determine server decoding or disk paths.
      form.append('file', new Blob([raw], { type: 'image/png' }), '../qa-photo.png');
      form.append('clientId', clientId);
      const res = await transport('/media/images', 'POST', form, headers);
      const payload = await res.json();
      assert.equal(
        res.status,
        expected,
        `upload: status=${res.status}, code=${payload.error?.code || ''}`,
      );
      return payload.data ?? payload.error;
    },
    image: async (url, expected = 200, method = 'GET') => {
      const res = await transport(url, method);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(res.status, expected, `${method} image status differs`);
      return { res, bytes };
    },
  };
}
const guest = client(),
  alice = client(),
  outsider = client(),
  admin = client();
const check = async (name, action) => {
  await action();
  checks.push(name);
  console.log(`✓ ${name}`);
};
const logout = async (api) => {
  try {
    await api.json('/auth/logout', 'POST');
  } catch {
    /* Original failure remains authoritative. */
  }
};
let asset, post, approved, pending, actor;

try {
  await check('本机代理、真实登录与未登录上传拒绝', async () => {
    assert.equal((await guest.json('/health')).status, 'ok');
    actor = (
      await alice.json('/auth/login', 'POST', {
        email: 'demo@gongming.local',
        password: 'Demo2026!',
      })
    ).user;
    await outsider.json(
      '/auth/register',
      'POST',
      {
        email: `media_${stamp}@example.test`,
        handle: `media_${stamp.replaceAll('-', '')}`,
        name: '图片权限联调',
        password: `Qa_${randomUUID()}!`,
      },
      201,
    );
    await admin.json('/auth/login', 'POST', {
      email: 'admin@gongming.local',
      password: 'Admin2026!',
    });
    await guest.upload(png(3, 2), randomUUID(), 401);
  });
  await check('实际PNG上传、重编码、同clientId去重与冲突', async () => {
    const raw = Buffer.concat([png(3, 2), Buffer.from('qa-only-extra-metadata')]);
    const id = randomUUID();
    asset = await alice.upload(raw, id);
    assert.match(asset.id, /^media_[a-f0-9]{32}$/);
    assert.equal(asset.url, `/api/v1/media/images/${asset.id}`);
    assert.equal(asset.width, 3);
    assert.equal(asset.height, 2);
    assert.deepEqual(await alice.upload(raw, id), asset);
    await alice.upload(png(3, 2, 1), id, 409);
    const { res, bytes } = await alice.image(asset.url);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(bytes.length, asset.bytes);
    assert.equal(bytes.includes(Buffer.from('qa-only-extra-metadata')), false);
    const head = await alice.image(asset.url, 200, 'HEAD');
    assert.equal(head.bytes.length, 0);
    assert.equal(Number(head.res.headers.get('content-length')), asset.bytes);
  });
  await check('私人图片、本人恢复列表与跨账号引用/删除隔离', async () => {
    await guest.image(asset.url, 404);
    await outsider.image(asset.url, 404);
    await outsider.json(`/media/images/${asset.id}`, 'DELETE', undefined, 404);
    await outsider.json('/posts', 'POST', { body: '不可冒用他人上传', images: [asset.url] }, 400);
    assert.equal((await alice.json(`/me/media?q=${asset.id}`)).items[0].id, asset.id);
    assert.equal((await outsider.json(`/me/media?q=${asset.id}`)).total, 0);
    await guest.json('/me/media', 'GET', undefined, 401);
  });
  await check('伪造图片、Origin和账号变化拒绝', async () => {
    await alice.upload(Buffer.from('<svg onload="alert(1)"/>'), randomUUID(), 400);
    await alice.upload(png(3, 2), randomUUID(), 403, { Origin: 'https://untrusted.example' });
    await alice.upload(png(3, 2), randomUUID(), 409, { 'X-Gongming-Account': 'another-account' });
    await alice.json(
      '/posts',
      'POST',
      { body: '不可绝对化托管路径', images: [target.origin + asset.url] },
      400,
    );
  });
  await check('带上传图的新帖待审核，发布后访客才可读取', async () => {
    post = await alice.json('/posts', 'POST', {
      body: `媒体审核联调 ${stamp}`,
      images: [asset.url],
      topic: '产品共建',
    });
    assert.equal(post.status, 'pending');
    await guest.json(`/posts/${post.id}`, 'GET', undefined, 404);
    await guest.image(asset.url, 404);
    await alice.json(`/media/images/${asset.id}`, 'DELETE', undefined, 409);
    assert.equal((await admin.json(`/admin/media?q=${post.id}`)).items[0].id, asset.id);
    await admin.json(`/admin/posts/${post.id}`, 'PATCH', { status: 'published' });
    await guest.image(asset.url);
    await guest.json(`/posts/${post.id}`);
  });
  await check('屏蔽原图同步下架引用帖，解封不自动恢复发布', async () => {
    await outsider.json(
      `/admin/media/${asset.id}`,
      'PATCH',
      { status: 'blocked', note: '不应允许' },
      403,
    );
    await admin.json(`/admin/media/${asset.id}`, 'PATCH', { status: 'blocked', note: '' }, 400);
    const hidden = await admin.json(`/admin/media/${asset.id}`, 'PATCH', {
      status: 'blocked',
      note: '联调：验证原图访问及关联内容撤下',
    });
    assert.equal(hidden.publishedReferenceCount, 0);
    assert.equal(hidden.posts[0].status, 'hidden');
    await guest.image(asset.url, 404);
    await alice.image(asset.url, 404);
    await admin.image(asset.url);
    await admin.json(`/admin/posts/${post.id}`, 'PATCH', { status: 'published' }, 409);
    await admin.json(`/admin/media/${asset.id}`, 'PATCH', {
      status: 'ready',
      note: '联调：解除屏蔽，仍需重新审核帖子',
    });
    assert.equal((await alice.json(`/posts/${post.id}`)).status, 'hidden');
    await guest.image(asset.url, 404);
    await admin.json(`/admin/posts/${post.id}`, 'PATCH', { status: 'published' });
    await guest.image(asset.url);
    const audits = (await admin.json(`/admin/audit?q=${asset.id}`)).items;
    assert.ok(audits.some((item) => item.action === 'media.moderate'));
  });
  await check('删除引用后可清理原图，软删不可再读取并支持重复删除', async () => {
    await alice.json(`/posts/${post.id}`, 'DELETE');
    await guest.image(asset.url, 404);
    await alice.json(`/media/images/${asset.id}`, 'DELETE');
    await alice.json(`/media/images/${asset.id}`, 'DELETE');
    await alice.image(asset.url, 404);
    await admin.image(asset.url, 404);
    assert.equal((await alice.json(`/me/media?q=${asset.id}`)).total, 0);
  });
  await check('保留可体验的已发布与待审图片实例', async () => {
    const photo = await alice.upload(png(512, 320), randomUUID());
    approved = await alice.json('/posts', 'POST', {
      body: `真实上传示例 ${stamp}：这张渐变测试图已由服务器保存并审核发布。可在“我的上传”查看引用，在后台体验屏蔽与恢复。`,
      images: [photo.url],
      topic: '产品共建',
    });
    approved = await admin.json(`/admin/posts/${approved.id}`, 'PATCH', { status: 'published' });
    const privatePhoto = await alice.upload(png(512, 320, 1), randomUUID());
    pending = await alice.json('/posts', 'POST', {
      body: `待审图片示例 ${stamp}：登录成员示例可查看，审核员从内容审核发布后才向社区开放。`,
      images: [privatePhoto.url],
      topic: '产品共建',
    });
    assert.equal(pending.status, 'pending');
    await guest.image(photo.url);
    await guest.image(privatePhoto.url, 404);
  });
  mkdirSync('.runtime', { recursive: true, mode: 0o700 });
  writeFileSync(
    '.runtime/verify-media-result.json',
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        checks,
        ownerId: actor.id,
        approvedPost: approved.id,
        pendingPost: pending.id,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `${checks.length} 组真实媒体联调通过；已发布和待审示例保存在成员示例账号，报告不含凭据。`,
  );
} catch (error) {
  console.error(`媒体联调失败：${error instanceof Error ? error.message : '未知错误'}`);
  process.exitCode = 1;
} finally {
  await Promise.all([alice, outsider, admin].map(logout));
}
