import type {
  Audit,
  CircleStatus,
  MediaStatus,
  PostStatus,
  ReportStatus,
  UserRole,
  UserStatus,
} from './types';
import { hostedImageId } from '../../src/shared/api/media-url';

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
export const mediaStatusLabels: Record<MediaStatus, string> = { ready: '可用', blocked: '已屏蔽' };
export const circleStatusLabels: Record<CircleStatus, string> = {
  active: '正常',
  suspended: '已暂停',
  archived: '已归档',
};
export const circlePostStatusLabels: Record<PostStatus, string> = {
  published: '圈内已发布',
  hidden: '已隐藏',
  pending: '待审核',
};

export function number(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '大小未知';
  if (bytes < 1024) return `${number(bytes)} B`;
  const unit = bytes < 1024 * 1024 ? 'KiB' : 'MiB';
  const value = bytes / (unit === 'KiB' ? 1024 : 1024 * 1024);
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)} ${unit}`;
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
    'media.update': '审核图片',
    'media.updated': '审核图片',
    'media.moderate': '审核图片',
    'media.upload': '上传图片',
    'media.delete': '删除图片',
    'circle.moderate': '治理圈子',
    'circle.govern': '治理圈子',
    'circle.post.moderate': '审核圈帖',
    'circle.post.govern': '审核圈帖',
    'circle-post.moderate': '审核圈帖',
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
    /^\/(overview|users|content|media|circles(?:\/posts)?|reports|audit|system)(\?|$)/.test(
      value,
    ) &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character === '\\')
    ? value
    : '/overview';
}

export function safeImageUrl(value: string): string {
  // Only this exact same-origin media route may bypass absolute URL parsing.
  // Queries, fragments, encoded segments and alternate relative paths are refused.
  if (hostedImageId(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}
