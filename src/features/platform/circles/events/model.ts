import type { CircleEvent, EventInput, EventRegistration } from './types';
export const phaseLabel = {
  upcoming: '即将开始',
  ongoing: '进行中',
  ended: '已结束',
  cancelled: '已取消',
};
const reasonLabel = {
  '': '',
  user: '本人取消',
  membership: '因成员身份变化取消',
  account: '因账号状态变化取消',
  event: '活动取消',
};
export function registrationLabel(value: EventRegistration | null) {
  if (!value) return '尚未报名';
  if (value.status === 'registered') return '已确认报名';
  if (value.status === 'waitlisted')
    return value.queuePosition ? `候补第 ${value.queuePosition} 位` : '已加入候补';
  return reasonLabel[value.reason] || '报名已取消';
}
export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区';
export function eventTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '时间暂不可用';
}
export function localDateInput(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function localInputUtc(value: string, original?: string) {
  if (original && value === localDateInput(original)) return original;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('请完整填写活动时间');
  const date = new Date(`${value}:00`);
  if (!Number.isFinite(date.getTime()) || localDateInput(date.toISOString()) !== value)
    throw new Error('日期或时间无效，请重新选择');
  return date.toISOString();
}
export type EventFormValue = Omit<EventInput, 'capacity'> & { capacity: string };
export function eventForm(value?: CircleEvent): EventFormValue {
  const start = Date.now() + 24 * 60 * 60000;
  return {
    title: value?.title || '',
    description: value?.description || '',
    mode: value?.mode || 'offline',
    location: value?.location || '',
    startsAt: localDateInput(value?.startsAt || new Date(start).toISOString()),
    endsAt: localDateInput(value?.endsAt || new Date(start + 2 * 60 * 60000).toISOString()),
    registrationClosesAt: localDateInput(
      value?.registrationClosesAt || new Date(start - 60 * 60000).toISOString(),
    ),
    capacity: String(value?.capacity ?? 20),
  };
}
export function eventInput(value: EventFormValue, original?: CircleEvent): EventInput {
  const capacity = Number(value.capacity);
  const input = {
    title: value.title.trim(),
    description: value.description.trim(),
    location: value.location.trim(),
    mode: value.mode,
    capacity,
    startsAt: localInputUtc(value.startsAt, original?.startsAt),
    endsAt: localInputUtc(value.endsAt, original?.endsAt),
    registrationClosesAt: localInputUtc(value.registrationClosesAt, original?.registrationClosesAt),
  };
  if (
    !input.title ||
    input.title.length > 80 ||
    !input.description ||
    input.description.length > 4000 ||
    !input.location ||
    input.location.length > 200
  )
    throw new Error('请填写标题、介绍和地点，并遵守字数上限');
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000)
    throw new Error('报名名额须为 1–1000 的整数');
  const start = Date.parse(input.startsAt),
    end = Date.parse(input.endsAt),
    closes = Date.parse(input.registrationClosesAt);
  if (end <= start || end - start > 7 * 24 * 60 * 60000)
    throw new Error('结束须晚于开始，活动最长持续 7 天');
  if (closes > start) throw new Error('报名截止不能晚于活动开始');
  if (original && capacity < original.registeredCount)
    throw new Error('名额不能少于服务器已确认的报名人数');
  return input;
}
