export type AiMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  status?: 'complete' | 'stopped';
};
export type AiSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AiMessage[];
  draft: string;
  needsReply: boolean;
};
export type AiState = {
  version: 1;
  sessions: AiSession[];
  homeDraft: string;
  deleted: AiSession | null;
};
export const AI_STORAGE_KEY = 'ai-local-demo-v1';
export const defaultAiState: AiState = { version: 1, sessions: [], homeDraft: '', deleted: null };
export const aiPaths = {
  home: '/ai',
  history: '/ai/history',
  chat: (id: string) => `/ai/chat/${encodeURIComponent(id)}`,
} as const;
export const aiStarters = [
  {
    id: 'writing',
    label: '写作',
    detail: '把想法写成文字',
    prompt: '写一段周末咖啡探店的短文，语气自然，80 字以内。',
  },
  {
    id: 'summary',
    label: '总结',
    detail: '提炼一段文字的重点',
    prompt:
      '请总结这段文字：周六上午十点在美术馆门口集合。参观后一起午餐，下午可以自由活动。请提前预约门票，并带上水。',
  },
  {
    id: 'translation',
    label: '翻译',
    detail: '换一种语言表达',
    prompt: '把这句话翻译成英文：很高兴认识你，期待周末一起喝咖啡。',
  },
  {
    id: 'ideas',
    label: '灵感',
    detail: '为日常多想几个点子',
    prompt: '给我三个低预算的周末活动灵感，适合和朋友一起。',
  },
] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;
function isAiMessage(value: unknown): value is AiMessage {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id) &&
    ['user', 'assistant'].includes(value.role as string) &&
    validText(value.text, 12000) &&
    Boolean(value.text.trim()) &&
    timestamp(value.createdAt) &&
    (value.status === undefined || value.status === 'complete' || value.status === 'stopped')
  );
}
function isAiSession(value: unknown): value is AiSession {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id) &&
    validText(value.title, 48) &&
    Boolean(value.title.trim()) &&
    timestamp(value.createdAt) &&
    timestamp(value.updatedAt) &&
    validText(value.draft, 4000) &&
    typeof value.needsReply === 'boolean' &&
    Array.isArray(value.messages) &&
    value.messages.length <= 200 &&
    value.messages.every(isAiMessage) &&
    new Set(value.messages.map((message) => message.id)).size === value.messages.length
  );
}
export function isAiState(value: unknown): value is AiState {
  return (
    object(value) &&
    value.version === 1 &&
    validText(value.homeDraft, 4000) &&
    Array.isArray(value.sessions) &&
    value.sessions.length <= 50 &&
    value.sessions.every(isAiSession) &&
    new Set(value.sessions.map((session) => session.id)).size === value.sessions.length &&
    (value.deleted === null || isAiSession(value.deleted))
  );
}
export function newAiSession(draft = ''): AiSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '新会话',
    createdAt: now,
    updatedAt: now,
    messages: [],
    draft,
    needsReply: false,
  };
}
export function titleFromPrompt(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 24) || '新会话';
}
export function userMessage(text: string): AiMessage {
  const clean = text.trim();
  if (!clean || clean.length > 4000) throw new Error('请输入 1–4000 字的消息');
  return { id: crypto.randomUUID(), role: 'user', text: clean, createdAt: Date.now() };
}
export function replaceAiSession(state: AiState, session: AiSession): AiState {
  return {
    ...state,
    sessions: state.sessions.map((item) => (item.id === session.id ? session : item)),
  };
}
const cleanInput = (text: string) => text.replace(/^[^：:]{0,25}[：:]\s*/, '').trim();
export function generateLocalReply(messages: AiMessage[], variation = 0): string {
  const user = [...messages].reverse().find((message) => message.role === 'user');
  const text = user?.text || '';
  if (/总结|摘要|提炼/.test(text)) {
    const content = cleanInput(text);
    const sentences = content
      .split(/[。！？\n]/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4);
    return `整理为以下要点：\n\n${sentences.map((line, index) => `${index + 1}. ${line}`).join('\n')}`;
  }
  if (/翻译|译成|英文|英语/.test(text)) {
    if (/很高兴认识你/.test(text))
      return `Nice to meet you. I’m looking forward to having coffee together this weekend.\n\n语气自然的中文对应：很高兴认识你，期待周末一起喝咖啡。`;
    if (/你好|hello/i.test(text)) return `“你好”可以写成 “Hello”。`;
    return `我已收到这段翻译需求：\n「${cleanInput(text).slice(0, 160)}」\n\n当前演示不支持可靠翻译这段自由文本。可以按这三个步骤处理：\n1. 确认目标语言和使用场景。\n2. 标出专有名词与需要保留的语气。\n3. 逐句翻译后，对照原文检查信息是否完整。`;
  }
  if (/写|文案|润色|短文/.test(text)) {
    if (/咖啡/.test(text))
      return `${variation % 2 ? '周末的计划很简单：找一间小店，点一杯咖啡，把聊天的时间留长一点。阳光慢慢移过桌面，日子也跟着松弛下来。' : '周末拐进一家街角小店，咖啡的香气刚好遇上窗边的阳光。点一杯手冲，和朋友聊些没有期限的小事，这个下午就很值得。'}`;
    return `可以先用这个结构组织文字：\n\n开头：用一个具体场景引出「${text.slice(0, 45)}」。\n中间：补上一个细节和想表达的感受。\n结尾：留下一句清楚、自然的行动或期待。\n\n可以补充主题、用途和字数，继续细化这个框架。`;
  }
  if (/灵感|点子|周末|活动/.test(text))
    return `${variation % 2 ? '1. 公园小野餐：每人带一样家里现有的食物。\n2. 交换书单：在安静的小店聊一本最近读的书。\n3. 城市拍照：用手机记录同一种颜色，最后分享照片。' : '1. 街区散步：选一条没走过的路，各自发现三个小细节。\n2. 家常料理：一起做一道简单的菜，预算先约定。\n3. 免费看展：先确认场馆开放时间，再安排附近的咖啡休息。'}`;
  const previous = messages.filter((message) => message.role === 'user').length;
  return `${previous > 1 ? `这是这段会话的第 ${previous} 个问题。` : '我收到了你的问题。'}\n\n「${text.slice(0, 180)}${text.length > 180 ? '…' : ''}」\n\n当前为本地演示，无法直接解答或联网核实这个问题。可以先这样展开：\n\n1. 说清楚你希望得到的结果。\n2. 补充必要背景、限制或示例。\n3. 把问题拆成一个可以先完成的小步骤。\n\n你可以继续补充条件，或试试写作、总结、翻译和灵感示例。`;
}
