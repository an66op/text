import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

// This mutates the local development database only. Never forward seeded
// credentials, private activity data, or moderation notes to remote targets.
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
  '活动联调仅允许本机开发端口 /api/v1',
);
const origin = 'http://localhost:5173',
  stamp = randomUUID().replaceAll('-', '').slice(0, 10),
  checks = [],
  internalNote = `活动内部处理_${stamp}_不得进入普通DTO或通知`;
function client() {
  let cookie = '',
    account = '';
  const attempt = async (path, method = 'GET', value, expected = 200, headers = {}) => {
    const response = await fetch(target.href + path, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(account && !['/auth/login', '/auth/register'].includes(path)
          ? { 'X-Gongming-Account': account }
          : {}),
        ...(value === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    const payload = await response.json(),
      accepted = Array.isArray(expected) ? expected : [expected];
    assert.ok(
      accepted.includes(response.status),
      `${method} ${path.split('?')[0]}: status=${response.status}, code=${payload.error?.code || ''}`,
    );
    const next = response.headers.get('set-cookie');
    if (next) cookie = next.split(';')[0];
    if (response.ok && ['/auth/login', '/auth/register'].includes(path))
      account = payload.data.user.id;
    return { status: response.status, value: payload.data ?? payload.error };
  };
  return {
    attempt,
    json: async (...args) => (await attempt(...args)).value,
  };
}
const owner = client(),
  bob = client(),
  carol = client(),
  admin = client(),
  guest = client();
const check = async (name, action) => {
  await action();
  checks.push(name);
  console.log(`✓ ${name}`);
};
const safeUser = (user) => {
  assert.ok(user.id && user.handle && user.name);
  for (const field of ['email', 'role', 'status', 'passwordHash']) assert.ok(!(field in user));
};
const safeEvent = (event) => {
  assert.match(event.id, /^cevent_[a-f0-9]{32}$/);
  safeUser(event.creator);
  assert.ok(Number.isSafeInteger(event.revision) && event.revision > 0);
  assert.ok(event.registeredCount <= event.capacity && event.registeredCount >= 0);
  assert.ok(Number.isSafeInteger(event.waitlistedCount) && event.waitlistedCount >= 0);
  for (const field of ['moderationNote', 'note', 'attendees', 'receipts', 'fingerprint'])
    assert.ok(!(field in event));
  assert.ok(!JSON.stringify(event).includes(internalNote));
};
const input = (title, capacity = 1, hours = 48) => {
  const start = Date.now() + hours * 3600000;
  return {
    title,
    description: '明确标注的开发活动示例：报名、候补和名额来自真实服务。',
    mode: 'offline',
    location: '开发示例集合点 · 请勿据此实际出行',
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 7200000).toISOString(),
    registrationClosesAt: new Date(start - 3600000).toISOString(),
    capacity,
  };
};
const circleInput = (name) => ({
  name,
  description: '开发示例：圈内活动、真实名额和候补流程体验。',
  icon: '🗓',
  cover: '',
  category: '产品共建',
  visibility: 'public',
  joinPolicy: 'open',
  clientId: randomUUID(),
});
const password = `Events_${randomUUID()}!`,
  bobEmail = `events_b_${stamp}@example.test`,
  carolEmail = `events_c_${stamp}@example.test`;
let a, b, c, circle, otherCircle, event, moderated, showcase, winner, waiting;
let eventInput, winnerJoinId, winnerLeaveId, winnerWaitId, waitingId, reportId;
const base = () => `/circles/${circle.id}`,
  path = (item = event) => `${base()}/events/${item.id}`,
  inbox = (api) => api.json('/notifications?limit=100'),
  register = (api, item, intent, clientId = randomUUID(), expected = 200) =>
    api.json(`${path(item)}/registration`, 'POST', { intent, clientId }, expected),
  fresh = (api = owner, item = event) => api.json(path(item)),
  noticeFor = (page, kind, id, outcome) =>
    page.items.find(
      (notice) =>
        notice.kind === kind &&
        (!outcome || notice.outcome === outcome) &&
        notice.target?.eventId === id,
    );
try {
  await check('真实账号、活动成员边界、平台角色无普通入口特权', async () => {
    assert.equal((await guest.json('/health')).status, 'ok');
    a = (
      await owner.json('/auth/login', 'POST', {
        email: 'demo@gongming.local',
        password: 'Demo2026!',
      })
    ).user;
    [b, c] = await Promise.all(
      [
        [bob, bobEmail, `events_b_${stamp}`, '活动同行者'],
        [carol, carolEmail, `events_c_${stamp}`, '活动候补者'],
      ].map(
        async ([api, email, handle, name]) =>
          (await api.json('/auth/register', 'POST', { email, handle, name, password }, 201)).user,
      ),
    );
    await admin.json('/auth/login', 'POST', {
      email: 'admin@gongming.local',
      password: 'Admin2026!',
    });
    circle = await owner.json('/circles', 'POST', circleInput(`活动共建圈 ${stamp}`), [200, 201]);
    await guest.json(`${base()}/events`, 'GET', undefined, 401);
    await admin.json(`${base()}/events`, 'GET', undefined, [403, 404]);
    await bob.json(`${base()}/join`, 'POST', {});
    await carol.json(`${base()}/join`, 'POST', {});
    await owner.json(`${base()}/events?view=unknown`, 'GET', undefined, 400);
    await owner.json(`${base()}/events`, 'GET', undefined, 409, {
      'X-Gongming-Account': b.id,
    });
  });
  await check('活动创建幂等、载荷冲突、时间校验与跨圈隔离', async () => {
    eventInput = input(`最后一个名额 · 开发示例 ${stamp}`);
    const clientId = randomUUID(),
      create = { ...eventInput, clientId };
    event = await owner.json(`${base()}/events`, 'POST', create, [200, 201]);
    assert.equal((await owner.json(`${base()}/events`, 'POST', create, [200, 201])).id, event.id);
    await owner.json(
      `${base()}/events`,
      'POST',
      { ...create, title: '改变载荷不得复用创建键' },
      409,
    );
    await bob.json(`${base()}/events`, 'POST', { ...eventInput, clientId: randomUUID() }, 403);
    await owner.json(
      `${base()}/events`,
      'POST',
      { ...eventInput, clientId: randomUUID(), endsAt: eventInput.startsAt },
      400,
    );
    await owner.json(`${base()}/events`, 'POST', { ...eventInput, clientId: randomUUID() }, 403, {
      Origin: 'http://untrusted.example',
    });
    otherCircle = await bob.json(
      '/circles',
      'POST',
      circleInput(`活动隔离圈 ${stamp}`),
      [200, 201],
    );
    await bob.json(`/circles/${otherCircle.id}/events/${event.id}`, 'GET', undefined, 404);
    safeEvent(event);
  });
  await check('管理revision防覆盖、完整编辑与普通成员写入拒绝', async () => {
    const old = event.revision;
    eventInput = {
      ...eventInput,
      description: '这是修改后的真实活动说明，用于验证旧版本不能覆盖。',
    };
    event = await owner.json(path(), 'PATCH', { ...eventInput, revision: old });
    assert.equal(event.revision, old + 1);
    await owner.json(path(), 'PATCH', { ...eventInput, revision: old }, 409);
    await bob.json(path(), 'PATCH', { ...eventInput, revision: event.revision }, 403);
    await owner.json(
      path(),
      'PATCH',
      { ...eventInput, revision: event.revision, unknown: true },
      400,
    );
    const stable = await owner.json(path(), 'PATCH', { ...eventInput, revision: event.revision });
    assert.equal(stable.revision, event.revision);
    safeEvent(stable);
  });
  await check('最后名额并发唯一、满额失败与明确候补顺序', async () => {
    const attempts = [bob, carol].map((api) => ({ api, clientId: randomUUID() })),
      results = await Promise.all(
        attempts.map(({ api, clientId }) =>
          api.attempt(`${path()}/registration`, 'POST', { intent: 'join', clientId }, [200, 409]),
        ),
      );
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    const at = results.findIndex((result) => result.status === 200);
    winner = attempts[at].api;
    winnerJoinId = attempts[at].clientId;
    waiting = attempts[1 - at].api;
    waitingId = randomUUID();
    const joined = await register(waiting, event, 'waitlist', waitingId);
    assert.equal(joined.registration.status, 'waitlisted');
    assert.equal(joined.registration.queuePosition, 1);
    const current = await fresh();
    assert.equal(current.registeredCount, 1);
    assert.equal(current.waitlistedCount, 1);
    assert.equal((await fresh(waiting)).myRegistration.status, 'waitlisted');
  });
  await check('释放后自动递补、旧成功报名及取消回执不复活或误取消', async () => {
    winnerLeaveId = randomUUID();
    await register(winner, event, 'leave', winnerLeaveId);
    let current = await fresh(waiting);
    assert.equal(current.myRegistration.status, 'registered');
    assert.equal(current.registeredCount, 1);
    assert.equal(current.waitlistedCount, 0);
    const notice = noticeFor(
      await inbox(waiting),
      'circle-event-registration',
      event.id,
      'promoted',
    );
    assert.ok(notice?.available);
    assert.equal(notice.actor, null);
    assert.equal(
      (await register(winner, event, 'join', winnerJoinId)).registration.status,
      'cancelled',
    );
    assert.equal((await fresh(winner)).myRegistration.status, 'cancelled');
    winnerWaitId = randomUUID();
    await register(winner, event, 'waitlist', winnerWaitId);
    assert.equal(
      (await register(winner, event, 'leave', winnerLeaveId)).registration.status,
      'waitlisted',
    );
    current = await fresh();
    assert.equal(current.waitlistedCount, 1);
    assert.equal(
      (await register(waiting, event, 'waitlist', waitingId)).registration.status,
      'registered',
    );
    await register(waiting, event, 'join', waitingId, 409);
  });
  await check('容量扩充顺序递补、编辑通知与管理名单隐私', async () => {
    event = await fresh();
    eventInput = { ...eventInput, capacity: 2 };
    event = await owner.json(path(), 'PATCH', { ...eventInput, revision: event.revision });
    assert.equal(event.registeredCount, 2);
    assert.equal(event.waitlistedCount, 0);
    for (const api of [bob, carol]) {
      assert.equal((await fresh(api)).myRegistration.status, 'registered');
      assert.ok(noticeFor(await inbox(api), 'circle-event-update', event.id, 'updated'));
      await api.json(`${path()}/attendees`, 'GET', undefined, 403);
    }
    const list = await owner.json(`${path()}/attendees?status=registered&limit=1`),
      next = await owner.json(`${path()}/attendees?status=registered&limit=1&offset=1`);
    assert.equal(list.total, 2);
    assert.equal(next.total, 2);
    assert.notEqual(list.items[0].user.id, next.items[0].user.id);
    [...list.items, ...next.items].forEach((item) => safeUser(item.user));
    await owner.json(
      path(),
      'PATCH',
      { ...eventInput, capacity: 1, revision: event.revision },
      409,
    );
  });
  await check('移除成员同事务释放，失权通知脱敏且重入不恢复报名', async () => {
    await owner.json(`${base()}/members/${b.id}/remove`, 'POST', { ban: false });
    assert.equal((await fresh()).registeredCount, 1);
    await bob.json(path(), 'GET', undefined, [403, 404]);
    const notices = (await inbox(bob)).items.filter((item) => item.kind.startsWith('circle-event'));
    assert.ok(notices.length > 0);
    for (const notice of notices) {
      assert.equal(notice.available, false);
      assert.equal(notice.actor, null);
      assert.equal(notice.context, null);
      assert.equal(notice.target, null);
    }
    await register(bob, event, 'leave');
    await bob.json(`${base()}/join`, 'POST', {});
    assert.equal((await fresh(bob)).myRegistration.status, 'cancelled');
    assert.equal((await fresh(bob)).myRegistration.reason, 'membership');
  });
  await check('账号停用释放名额，恢复登录不恢复旧登记', async () => {
    await admin.json(`/admin/users/${c.id}`, 'PATCH', { status: 'suspended' });
    assert.equal((await fresh()).registeredCount, 0);
    await carol.json('/auth/me', 'GET', undefined, 401);
    await carol.json(path(), 'GET', undefined, 409);
    await admin.json(`/admin/users/${c.id}`, 'PATCH', { status: 'active' });
    await carol.json('/auth/login', 'POST', { email: carolEmail, password });
    const current = await fresh(carol);
    assert.equal(current.myRegistration.status, 'cancelled');
    assert.equal(current.myRegistration.reason, 'account');
  });
  await check('圈暂停保留登记、盲取消与恢复候补递补', async () => {
    event = await fresh();
    eventInput = { ...eventInput, capacity: 1 };
    event = await owner.json(path(), 'PATCH', { ...eventInput, revision: event.revision });
    await register(bob, event, 'join');
    await register(carol, event, 'waitlist');
    await admin.json(`/admin/circles/${circle.id}`, 'PATCH', {
      status: 'suspended',
      note: internalNote,
    });
    await bob.json(path(), 'GET', undefined, [403, 404]);
    const before = await admin.json(`/admin/circle-events?q=${event.id}`);
    assert.equal(before.items[0].registeredCount, 1);
    assert.equal(before.items[0].waitlistedCount, 1);
    const result = await register(bob, event, 'leave');
    assert.equal(result.registration.status, 'cancelled');
    assert.ok(!('event' in result));
    const paused = await admin.json(`/admin/circle-events?q=${event.id}`);
    assert.equal(paused.items[0].registeredCount, 0);
    assert.equal(paused.items[0].waitlistedCount, 1);
    await admin.json(`/admin/circles/${circle.id}`, 'PATCH', {
      status: 'active',
      note: internalNote,
    });
    assert.equal((await fresh()).registeredCount, 1);
    assert.equal((await fresh(bob)).myRegistration.status, 'cancelled');
    assert.equal((await fresh(carol)).myRegistration.status, 'registered');
    assert.ok(noticeFor(await inbox(carol), 'circle-event-registration', event.id, 'promoted'));
  });
  await check('独立平台屏蔽/恢复、动态通知与圈活动举报结案', async () => {
    const data = input(`活动治理示例 ${stamp}`, 1, 72);
    moderated = await owner.json(
      `${base()}/events`,
      'POST',
      { ...data, clientId: randomUUID() },
      [200, 201],
    );
    await register(bob, moderated, 'join');
    await register(carol, moderated, 'waitlist');
    await admin.json(
      `/admin/circle-events/${moderated.id}`,
      'PATCH',
      {
        moderation: 'hidden',
        revision: moderated.revision,
      },
      400,
    );
    let reviewed = await admin.json(`/admin/circle-events/${moderated.id}`, 'PATCH', {
      moderation: 'hidden',
      note: internalNote,
      revision: moderated.revision,
    });
    assert.equal(reviewed.moderation, 'hidden');
    assert.equal(reviewed.registeredCount, 1);
    for (const field of ['attendees', 'receipts']) assert.ok(!(field in reviewed));
    await bob.json(path(moderated), 'GET', undefined, 404);
    safeEvent(await fresh(owner, moderated));
    assert.ok(
      (await inbox(bob)).items.some(
        (item) => item.kind === 'circle-event-review' && !item.available,
      ),
    );
    await register(bob, moderated, 'leave');
    const hidden = await admin.json(`/admin/circle-events?q=${moderated.id}`);
    assert.equal(hidden.items[0].registeredCount, 0);
    assert.equal(hidden.items[0].waitlistedCount, 1);
    await admin.json(
      `/admin/circle-events/${moderated.id}`,
      'PATCH',
      {
        moderation: 'visible',
        note: internalNote,
        revision: moderated.revision,
      },
      409,
    );
    reviewed = await admin.json(`/admin/circle-events/${moderated.id}`, 'PATCH', {
      moderation: 'visible',
      note: internalNote,
      revision: reviewed.revision,
    });
    assert.equal(reviewed.lifecycle, 'published');
    assert.equal((await fresh(carol, moderated)).myRegistration.status, 'registered');
    assert.equal((await fresh(bob, moderated)).myRegistration.status, 'cancelled');
    const notice = noticeFor(await inbox(carol), 'circle-event-review', moderated.id, 'visible');
    assert.ok(notice?.available);
    assert.equal(notice.actor, null);
    assert.ok(!JSON.stringify(notice).includes(internalNote));
    const report = await bob.json(
      `${path(moderated)}/report`,
      'POST',
      {
        reason: '开发示例：验证圈活动举报与后台处理闭环。',
      },
      201,
    );
    reportId = report.id;
    assert.equal(report.targetType, 'circle-event');
    await admin.json(`/admin/reports/${report.id}`, 'PATCH', {
      status: 'resolved',
      note: internalNote,
    });
    const closed = (await inbox(bob)).items.find(
      (item) => item.kind === 'report-review' && item.outcome === 'resolved',
    );
    assert.ok(closed);
    assert.equal(closed.context, null);
    assert.equal(closed.target, null);
    await register(carol, moderated, 'leave');
    await register(bob, moderated, 'join');
  });
  await check('取消终态、报名释放、重复回执与平台不可复活', async () => {
    event = await fresh();
    const result = await owner.json(`${path()}/cancel`, 'POST', { revision: event.revision });
    assert.equal(result.lifecycle, 'cancelled');
    assert.equal(result.phase, 'cancelled');
    assert.equal(result.registeredCount, 0);
    assert.equal(result.waitlistedCount, 0);
    const repeat = await owner.json(`${path()}/cancel`, 'POST', { revision: event.revision });
    assert.equal(repeat.revision, result.revision);
    const current = await fresh(carol);
    assert.equal(current.myRegistration.status, 'cancelled');
    assert.equal(current.myRegistration.reason, 'event');
    await register(carol, event, 'join', randomUUID(), 409);
    await owner.json(path(), 'PATCH', { ...eventInput, revision: result.revision }, 409);
    await admin.json(
      `/admin/circle-events/${event.id}`,
      'PATCH',
      {
        moderation: 'visible',
        note: internalNote,
        revision: result.revision,
      },
      409,
    );
    assert.ok(noticeFor(await inbox(carol), 'circle-event-update', event.id, 'cancelled'));
  });
  await check('保留确认/候补/我的活动真实示例，过滤和分页一致', async () => {
    await register(carol, moderated, 'waitlist');
    const data = {
      ...input(`线上共创 · 开发示例 ${stamp}`, 8, 96),
      mode: 'online',
      location: '圈内交流空间（示例活动，不会自动开启通话）',
    };
    showcase = await owner.json(
      `${base()}/events`,
      'POST',
      { ...data, clientId: randomUUID() },
      [200, 201],
    );
    await register(owner, showcase, 'join');
    const mine = await owner.json(`${base()}/events?view=mine`);
    assert.ok(mine.items.some((item) => item.id === showcase.id));
    const all = await owner.json(`${base()}/events?view=all&limit=1`),
      next = await owner.json(`${base()}/events?view=all&limit=1&offset=1`);
    assert.equal(all.total, 3);
    assert.equal(next.total, 3);
    assert.notEqual(all.items[0].id, next.items[0].id);
    const upcoming = await owner.json(`${base()}/events?view=upcoming`);
    assert.equal(upcoming.total, 2);
    assert.equal((await fresh(bob, moderated)).myRegistration.status, 'registered');
    assert.equal((await fresh(carol, moderated)).myRegistration.status, 'waitlisted');
    for (const item of upcoming.items) safeEvent(item);
    for (const api of [owner, bob, carol])
      assert.ok(!JSON.stringify(await inbox(api)).includes(internalNote));
  });
  mkdirSync('.runtime', { recursive: true, mode: 0o700 });
  writeFileSync(
    '.runtime/verify-circle-events-result.json',
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        checks,
        circleId: circle.id,
        isolationCircleId: otherCircle.id,
        ownerId: a.id,
        memberIds: [b.id, c.id],
        cancelledEventId: event.id,
        capacityExampleId: moderated.id,
        upcomingExampleId: showcase.id,
        reportId,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(
    `圈子活动真实联调完成：${checks.length}组；示例保留，报告只含ID，不含凭据或内部说明。`,
  );
} finally {
  await Promise.allSettled(
    [owner, bob, carol, admin].map((api) =>
      api.json('/auth/logout', 'POST', undefined, [200, 401]),
    ),
  );
}
