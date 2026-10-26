import type { Audit, PostStatus, ReportStatus, UserRole, UserStatus } from './types';

export const roleLabels: Record<UserRole, string> = {
  member: '成员',
  moderator: '审核员',
  admin: '管理员',
};
export const userStatusLabels: Record<UserStatus, string> = { active: '正常', suspended: '已停用' };
export const postStatusLabels: Record<PostStatus, string> = {
  published: '已发布',
  hidden: '已隐藏',
  pending: '待审核',
};
export const reportStatusLabels: Record<ReportStatus, string> = {
  open: '待处理',
  resolved: '已处理',
  dismissed: '已驳回',
};

export function number(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
}

export function detailText(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (detail === null || detail === undefined) return '—';
  return JSON.stringify(detail, null, 2);
}

export function actionLabel(action: Audit['action']): string {
  const labels: Record<string, string> = {
    'user.update': '更新用户',
    'user.updated': '更新用户',
    'post.update': '审核内容',
    'post.moderate': '审核内容',
    'post.updated': '审核内容',
    'report.update': '处理举报',
    'report.resolve': '处理举报',
    'report.updated': '处理举报',
    'report.review': '处理举报',
    'system.seed': '开发数据初始化',
    'system.bootstrap': '初始化管理员',
    'auth.login': '账号登录',
    'auth.register': '注册账号',
  };
  return labels[action] || action;
}

export function safeOffset(value: string | null, limit = 20): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.floor(parsed / limit) * limit : 0;
}

export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' &&
    /^\/(overview|users|content|reports|audit|system)(\?|$)/.test(value) &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character === '\\')
    ? value
    : '/overview';
}

export function safeImageUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}
