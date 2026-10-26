import { describe, expect, it } from 'vitest';
import { normalizeNotification, notificationPath, notificationText } from './model';
import type { Notification, NotificationKind, NotificationTarget } from './types';

const circleId = `circle_${'a'.repeat(32)}`;
const worldPostId = `post_${'b'.repeat(32)}`;
const circlePostId = `cpost_${'c'.repeat(32)}`;
const mediaId = `media_${'d'.repeat(32)}`;
const actor = { id: 'user-one', handle: 'reader_one', name: '旧作者', avatar: '', bio: '' };
const item = (patch: Partial<Notification> = {}): Notification => ({
  id: `notice_${'e'.repeat(32)}`,
  kind: 'world-comment',
  category: 'interactions',
  outcome: '',
  actor,
  available: true,
  context: { title: '旧私圈名', excerpt: '旧附言、正文和内部说明' },
  target: { type: 'world-post', postId: worldPostId },
  createdAt: '2026-10-26T10:00:00.000000Z',
  readAt: null,
  ...patch,
});

describe('notification historical text', () => {
  it.each<[NotificationKind, string, string]>([
    ['friend-request', '', '好友申请'],
    ['friend-decision', 'accepted', '好友申请已通过'],
    ['friend-decision', 'declined', '好友申请未通过'],
    ['circle-request', '', '加入申请'],
    ['circle-decision', 'accepted', '加入申请已通过'],
    ['circle-decision', 'declined', '加入申请未通过'],
    ['circle-membership', 'admin', '管理员任命'],
    ['circle-membership', 'member', '圈内角色调整'],
    ['circle-membership', 'owner', '圈主转交'],
    ['circle-membership', 'removed', '成员移除'],
    ['circle-membership', 'banned', '圈内封禁'],
    ['circle-membership', 'unbanned', '圈内解禁'],
    ['circle-status', 'active', '圈子已恢复'],
    ['circle-status', 'suspended', '圈子已暂停'],
    ['circle-status', 'archived', '圈子已归档'],
    ['world-comment', '', '世界评论'],
    ['world-like', '', '世界点赞'],
    ['circle-comment', '', '圈子评论'],
    ['circle-like', '', '圈子点赞'],
    ['world-review', 'published', '世界动态已发布'],
    ['world-review', 'pending', '世界动态待审核'],
    ['world-review', 'hidden', '世界动态已隐藏'],
    ['circle-review', 'published', '圈子帖子已发布'],
    ['circle-review', 'pending', '圈子帖子待审核'],
    ['circle-review', 'hidden', '圈子帖子已隐藏'],
    ['media-review', 'ready', '上传图片已恢复'],
    ['media-review', 'blocked', '上传图片已屏蔽'],
    ['report-review', 'resolved', '举报已处理'],
    ['report-review', 'dismissed', '举报已结案'],
  ])('renders controlled history for %s / %s', (kind, outcome, title) => {
    const text = notificationText(item({ kind, outcome }));
    expect(text.title).toBe(title);
    expect(text.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(text)).not.toMatch(/旧作者|旧私圈名|旧附言|内部说明/);
  });

  it('does not describe a historical acceptance or unban as current membership', () => {
    expect(notificationText(item({ kind: 'circle-decision', outcome: 'accepted' })).body).toBe(
      '你的圈子加入申请已获通过',
    );
    expect(notificationText(item({ kind: 'circle-membership', outcome: 'unbanned' })).body).toBe(
      '圈内封禁已解除，此操作未恢复成员资格',
    );
  });

  it.each([
    { kind: 'not-a-kind', outcome: '任意外部文案' },
    { kind: '__proto__', outcome: 'accepted' },
    { kind: 'world-review', outcome: '__proto__' },
    { kind: 'world-comment', outcome: '请访问 https://evil.test' },
  ])('uses generic fixed text for unknown kind/outcome $kind / $outcome', (patch) => {
    expect(notificationText(item(patch as Partial<Notification>))).toEqual({
      title: '站内通知',
      body: '你收到了一条站内通知',
    });
  });

  it('keeps only a fixed historical title when the original content is unavailable', () => {
    expect(
      notificationText(item({ kind: 'circle-decision', outcome: 'accepted', available: false })),
    ).toEqual({ title: '加入申请已通过', body: '原内容当前不可访问' });
  });
});

describe('notification projection replacement', () => {
  it('removes every stale private field even from a malformed unavailable DTO', () => {
    const previous = item({ target: { type: 'circle', circleId } });
    const hidden = normalizeNotification({ ...previous, available: false });
    expect(hidden).toMatchObject({ available: false, actor: null, context: null, target: null });
    expect(previous.actor).toBe(actor);
    expect(previous.context?.title).toBe('旧私圈名');
    expect(notificationPath(hidden)).toBeNull();
    expect(JSON.stringify(notificationText(hidden))).not.toMatch(/旧/);
  });

  it('requires an explicit true availability flag before retaining private projections', () => {
    expect(
      normalizeNotification(item({ available: undefined } as unknown as Partial<Notification>)),
    ).toMatchObject({ available: false, actor: null, context: null, target: null });
  });

  it('strips concrete platform reviewers from system events even if category is malformed', () => {
    expect(normalizeNotification(item({ category: 'system' })).actor).toBeNull();
    expect(
      normalizeNotification(item({ kind: 'circle-review', category: 'interactions' })).actor,
    ).toBeNull();
    expect(normalizeNotification(item()).actor).toBe(actor);
  });

  it('never exposes report context, actor or target even when an invalid server projection has them', () => {
    const report = item({ kind: 'report-review', outcome: 'resolved' });
    expect(normalizeNotification(report)).toMatchObject({
      available: true,
      actor: null,
      context: null,
      target: null,
    });
    expect(notificationPath(report)).toBeNull();
  });
});

describe('notification internal target mapping', () => {
  it.each<[NotificationTarget, string]>([
    [{ type: 'friend-requests' }, '/contacts?tab=requests'],
    [{ type: 'user', handle: 'reader_one' }, '/u/reader_one'],
    [{ type: 'circle-members', circleId }, `/circles/s/${circleId}/members?tab=requests`],
    [{ type: 'circle', circleId }, `/circles/s/${circleId}`],
    [{ type: 'world-post', postId: worldPostId }, `/world/p/${worldPostId}`],
    [
      { type: 'circle-post', circleId, postId: circlePostId },
      `/circles/s/${circleId}/posts/${circlePostId}`,
    ],
    [{ type: 'uploads', mediaId }, `/account/uploads?image=${mediaId}`],
  ])('maps a valid $type target to its fixed local route', (target, path) => {
    expect(notificationPath(item({ target }))).toBe(path);
    expect(notificationPath(item({ target, available: false }))).toBeNull();
  });

  it.each([
    { type: 'url', url: 'https://evil.test' },
    { type: 'world-post', postId: 'post-one' },
    { type: 'world-post', postId: `post_${'A'.repeat(32)}` },
    { type: 'world-post', postId: `${worldPostId}/../../admin` },
    { type: 'world-post', postId: `${worldPostId}?secret=1` },
    { type: 'circle', circleId: worldPostId },
    { type: 'circle-members', circleId: circleId.slice(0, -1) },
    { type: 'circle-post', circleId, postId: worldPostId },
    { type: 'circle-post', circleId: null, postId: circlePostId },
    { type: 'uploads', mediaId: `https://evil.test/${mediaId}` },
    { type: 'uploads', mediaId: `${mediaId}#invite=secret` },
    { type: 'user', handle: '//evil.test' },
    { type: 'user', handle: 'a/b' },
    { type: 'user', handle: 'ab' },
    { type: 'user', handle: '3reader' },
    { type: 'user', handle: 'Reader' },
    { type: 'user', handle: '读者' },
    { type: 'user', handle: 'a'.repeat(31) },
    { type: 'user', handle: null },
  ])('rejects malformed or unknown target $type', (target) => {
    expect(notificationPath(item({ target: target as NotificationTarget }))).toBeNull();
  });

  it('allows the full existing handle length without accepting URL syntax', () => {
    expect(notificationPath(item({ target: { type: 'user', handle: 'a'.repeat(30) } }))).toBe(
      `/u/${'a'.repeat(30)}`,
    );
  });
});
