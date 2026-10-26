import type { Notification, NotificationKind } from './types';

type Text = { title: string; body: string };
const generic: Text = { title: '站内通知', body: '你收到了一条站内通知' };
const unavailable = '原内容当前不可访问';
const systemKinds = new Set<NotificationKind>([
  'circle-membership',
  'circle-status',
  'world-review',
  'circle-review',
  'media-review',
  'report-review',
]);
const simpleText: Partial<Record<NotificationKind, Text>> = {
  'friend-request': { title: '好友申请', body: '收到一条好友申请' },
  'circle-request': { title: '加入申请', body: '收到一条圈子加入申请' },
  'world-comment': { title: '世界评论', body: '有人评论了你的世界动态' },
  'world-like': { title: '世界点赞', body: '有人赞了你的世界动态' },
  'circle-comment': { title: '圈子评论', body: '有人评论了你的圈子帖子' },
  'circle-like': { title: '圈子点赞', body: '有人赞了你的圈子帖子' },
};
const outcomeText: Partial<Record<NotificationKind, Record<string, Text>>> = {
  'friend-decision': {
    accepted: { title: '好友申请已通过', body: '你的好友申请已获通过' },
    declined: { title: '好友申请未通过', body: '你的好友申请未获通过' },
  },
  'circle-decision': {
    accepted: { title: '加入申请已通过', body: '你的圈子加入申请已获通过' },
    declined: { title: '加入申请未通过', body: '你的圈子加入申请未获通过' },
  },
  'circle-membership': {
    admin: { title: '管理员任命', body: '你被任命为圈子管理员' },
    member: { title: '圈内角色调整', body: '你的圈内角色被调整为普通成员' },
    owner: { title: '圈主转交', body: '圈主已将圈子转交给你' },
    removed: { title: '成员移除', body: '你被移出了圈子' },
    banned: { title: '圈内封禁', body: '你被圈子封禁' },
    unbanned: { title: '圈内解禁', body: '圈内封禁已解除，此操作未恢复成员资格' },
  },
  'circle-status': {
    active: { title: '圈子已恢复', body: '圈子在此次操作中恢复了正常状态' },
    suspended: { title: '圈子已暂停', body: '圈子在此次操作中被暂停' },
    archived: { title: '圈子已归档', body: '圈主已将圈子归档' },
  },
  'world-review': {
    published: { title: '世界动态已发布', body: '你的世界动态在此次审核中获准发布' },
    pending: { title: '世界动态待审核', body: '你的世界动态在此次操作中转为待审核' },
    hidden: { title: '世界动态已隐藏', body: '你的世界动态在此次审核中被隐藏' },
  },
  'circle-review': {
    published: { title: '圈子帖子已发布', body: '你的圈子帖子在此次审核中获准发布' },
    pending: { title: '圈子帖子待审核', body: '你的圈子帖子在此次操作中转为待审核' },
    hidden: { title: '圈子帖子已隐藏', body: '你的圈子帖子在此次审核中被隐藏' },
  },
  'media-review': {
    ready: { title: '上传图片已恢复', body: '你的上传图片在此次审核中恢复了可用状态' },
    blocked: { title: '上传图片已屏蔽', body: '你的上传图片在此次审核中被屏蔽' },
  },
  'report-review': {
    resolved: { title: '举报已处理', body: '你的举报已处理完成' },
    dismissed: { title: '举报已结案', body: '你的举报已结案，未予采纳' },
  },
};

/** Replace a server projection as a whole; never revive fields from an older item. */
export function normalizeNotification(item: Notification): Notification {
  if (item.available !== true)
    return { ...item, available: false, actor: null, context: null, target: null };
  if (item.kind === 'report-review') return { ...item, actor: null, context: null, target: null };
  return {
    ...item,
    actor: item.category === 'system' || systemKinds.has(item.kind) ? null : item.actor,
  };
}

/** Text describes the historical event, never a current role or membership guarantee. */
export function notificationText(item: Notification): Text {
  const simple = Object.hasOwn(simpleText, item.kind) ? simpleText[item.kind] : undefined;
  const outcomes = Object.hasOwn(outcomeText, item.kind) ? outcomeText[item.kind] : undefined;
  const text =
    (simple && item.outcome === '' ? simple : undefined) ||
    (outcomes && Object.hasOwn(outcomes, item.outcome) ? outcomes[item.outcome] : undefined) ||
    generic;
  return item.available === true ? { ...text } : { title: text.title, body: unavailable };
}

const idPatterns = {
  circle: /^circle_[a-f0-9]{32}$/,
  post: /^post_[a-f0-9]{32}$/,
  cpost: /^cpost_[a-f0-9]{32}$/,
  media: /^media_[a-f0-9]{32}$/,
};
const validId = (value: unknown, type: keyof typeof idPatterns): value is string =>
  typeof value === 'string' && idPatterns[type].test(value);
const handlePattern = /^[a-z][a-z0-9_]{2,29}$/;

/** Only fixed, validated same-app paths are accepted; no URL comes from the DTO. */
export function notificationPath(item: Notification): string | null {
  const safe = normalizeNotification(item);
  const target = safe.target;
  if (!safe.available || !target || typeof target !== 'object') return null;
  const segment = encodeURIComponent;
  switch (target.type) {
    case 'friend-requests':
      return '/contacts?tab=requests';
    case 'user':
      return typeof target.handle === 'string' && handlePattern.test(target.handle)
        ? `/u/${segment(target.handle)}`
        : null;
    case 'circle-members':
      return validId(target.circleId, 'circle')
        ? `/circles/s/${segment(target.circleId)}/members?tab=requests`
        : null;
    case 'circle':
      return validId(target.circleId, 'circle') ? `/circles/s/${segment(target.circleId)}` : null;
    case 'world-post':
      return validId(target.postId, 'post') ? `/world/p/${segment(target.postId)}` : null;
    case 'circle-post':
      return validId(target.circleId, 'circle') && validId(target.postId, 'cpost')
        ? `/circles/s/${segment(target.circleId)}/posts/${segment(target.postId)}`
        : null;
    case 'uploads':
      return validId(target.mediaId, 'media')
        ? `/account/uploads?image=${segment(target.mediaId)}`
        : null;
    default:
      return null;
  }
}
