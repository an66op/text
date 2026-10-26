import { isReaderSettings, isReading } from '@/features/content/persistence';
import { isAiState } from '@/features/ai/ai-model';
import { isStringArray } from '@/shared/lib/storage';

export type PersonalDocument = { key: string; value: unknown; revision: number; updatedAt: string };
type Domain = {
  key: string;
  storageKey: string;
  label: string;
  detail: string;
  validate: (value: unknown) => boolean;
};
export const syncDomains: Domain[] = [
  {
    key: 'preferences',
    storageKey: 'preferences',
    label: '界面偏好',
    detail: '当前设备的功能开关',
    validate: (value) =>
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every((entry) => typeof entry === 'boolean'),
  },
  {
    key: 'reading',
    storageKey: 'content-reading',
    label: '阅读进度',
    detail: '小说章节与阅读位置',
    validate: isReading,
  },
  {
    key: 'bookshelf',
    storageKey: 'content-bookshelf-ids',
    label: '我的书架',
    detail: '收藏的书籍列表',
    validate: isStringArray,
  },
  {
    key: 'content-preferences',
    storageKey: 'content-reader-settings',
    label: '阅读设置',
    detail: '字号、主题与行距',
    validate: isReaderSettings,
  },
  {
    key: 'drafts',
    storageKey: 'content-publish-draft',
    label: '动态草稿',
    detail: '尚未发布的文字',
    validate: (value) => typeof value === 'string' && value.length <= 20000,
  },
  {
    key: 'ai-history',
    storageKey: 'ai-local-demo-v1',
    label: 'AI 演示历史',
    detail: '包含对话文字，按需备份',
    validate: isAiState,
  },
];
export function localSnapshot(key: string): { version: 1; data: unknown } | null {
  const domain = syncDomains.find((entry) => entry.key === key);
  if (!domain) throw new Error('此数据不在个人备份范围内');
  const raw = localStorage.getItem(domain.storageKey);
  if (raw === null) return null;
  const data: unknown = JSON.parse(raw);
  if (!domain.validate(data)) throw new Error(`${domain.label}的本机数据格式无效`);
  const result = { version: 1 as const, data };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 128 * 1024)
    throw new Error(`${domain.label}超过 128KB，请先精简后备份`);
  return result;
}
export function validateDocument(document: PersonalDocument): { storageKey: string; raw: string } {
  const domain = syncDomains.find((entry) => entry.key === document.key);
  const value = document.value;
  if (
    !domain ||
    !Number.isSafeInteger(document.revision) ||
    document.revision < 1 ||
    typeof document.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(document.updatedAt)) ||
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('data' in value) ||
    !domain.validate(value.data)
  )
    throw new Error('备份格式与当前版本不兼容，未恢复任何数据');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 128 * 1024)
    throw new Error('备份超过 128KB，未恢复任何数据');
  return { storageKey: domain.storageKey, raw: JSON.stringify(value.data) };
}
export function readDocumentList(value: unknown): PersonalDocument[] {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items))
    throw new Error('账号备份列表格式无效');
  const result: PersonalDocument[] = [];
  for (const entry of value.items) {
    if (!entry || typeof entry !== 'object' || !('key' in entry) || typeof entry.key !== 'string')
      throw new Error('账号备份格式无效');
    // Newer server domains stay untouched until this client explicitly supports restoring them.
    if (!syncDomains.some((domain) => domain.key === entry.key)) continue;
    const document = entry as PersonalDocument;
    validateDocument(document);
    if (result.some((previous) => previous.key === document.key))
      throw new Error('账号备份包含重复数据域');
    result.push(document);
  }
  return result;
}
export function restoreDocuments(documents: PersonalDocument[]) {
  if (new Set(documents.map((document) => document.key)).size !== documents.length)
    throw new Error('备份包含重复数据域，未恢复任何数据');
  const updates = documents.map(validateDocument);
  const previous = updates.map(({ storageKey }) => ({
    storageKey,
    raw: localStorage.getItem(storageKey),
  }));
  try {
    for (const entry of updates) localStorage.setItem(entry.storageKey, entry.raw);
  } catch (error) {
    let rollbackFailed = false;
    for (const entry of previous) {
      try {
        if (entry.raw === null) localStorage.removeItem(entry.storageKey);
        else localStorage.setItem(entry.storageKey, entry.raw);
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed)
      throw new Error('恢复未完成，且部分本机数据无法回滚。请释放本机存储空间后重新恢复。', {
        cause: error,
      });
    throw error;
  }
  for (const entry of updates)
    window.dispatchEvent(
      new StorageEvent('storage', { key: entry.storageKey, newValue: entry.raw }),
    );
}
