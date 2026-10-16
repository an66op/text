import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import AiPage from './AiPage';
import {
  AI_STORAGE_KEY,
  defaultAiState,
  newAiSession,
  userMessage,
  type AiState,
} from './ai-model';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}
function AiApp({ entry = '/ai' }: { entry?: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Location />
        <Routes>
          <Route path="/ai" element={<AiPage />} />
          <Route path="/ai/chat/:sessionId" element={<AiPage kind="chat" />} />
          <Route path="/ai/history" element={<AiPage kind="history" />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}
const stored = (): AiState => JSON.parse(localStorage.getItem(AI_STORAGE_KEY) || 'null');
const finishReply = () => act(() => vi.runAllTimers());
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AI local demo conversations', () => {
  it('opens editable starter drafts, creates a stable session and continues a conversation', () => {
    render(<AiApp />);
    fireEvent.click(screen.getByRole('button', { name: /写作/ }));
    const stablePath = screen.getByTestId('location').textContent;
    expect(stablePath).toMatch(/^\/ai\/chat\/.+/);
    expect(
      (screen.getByRole('textbox', { name: 'AI消息' }) as HTMLTextAreaElement).value,
    ).toContain('咖啡探店');
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument();
    finishReply();
    expect(within(screen.getByRole('log')).getByText(/周末拐进一家街角小店/)).toBeInTheDocument();
    expect(screen.queryByText(/预置写作示例|本地演示回复/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'AI消息' }), {
      target: { value: '我想再聊一个问题' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'AI消息' }), { key: 'Enter' });
    finishReply();
    expect(screen.getByText(/这是这段会话的第 2 个问题/)).toBeInTheDocument();
    expect(stored().sessions[0].messages).toHaveLength(4);
    expect(screen.getByTestId('location')).toHaveTextContent(stablePath || '');
  });

  it('persists the home and session drafts across a refresh', () => {
    const first = render(<AiApp />);
    fireEvent.change(screen.getByRole('textbox', { name: 'AI消息' }), {
      target: { value: '还没发送的想法' },
    });
    first.unmount();
    const second = render(<AiApp />);
    expect(screen.getByRole('textbox', { name: 'AI消息' })).toHaveValue('还没发送的想法');
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    finishReply();
    const sessionPath = screen.getByTestId('location').textContent || '';
    fireEvent.change(screen.getByRole('textbox', { name: 'AI消息' }), {
      target: { value: '会话中的未发送草稿' },
    });
    second.unmount();
    render(<AiApp entry={sessionPath} />);
    expect(screen.getByRole('textbox', { name: 'AI消息' })).toHaveValue('会话中的未发送草稿');
    expect(screen.getByRole('log')).toHaveTextContent('还没发送的想法');
    expect(screen.getByRole('log')).toHaveTextContent('当前为本地演示');
  });

  it('stops local generation and replaces the stopped reply on regeneration', () => {
    render(<AiApp />);
    fireEvent.change(screen.getByRole('textbox', { name: 'AI消息' }), {
      target: { value: '给我三个周末活动灵感' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    act(() => vi.advanceTimersByTime(270));
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
    expect(stored().sessions[0].messages.at(-1)?.status).toBe('stopped');
    expect(screen.getByText('已停止')).toBeInTheDocument();
    const stoppedText = stored().sessions[0].messages.at(-1)?.text;
    finishReply();
    expect(stored().sessions[0].messages.at(-1)?.text).toBe(stoppedText);
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    finishReply();
    expect(stored().sessions[0].messages).toHaveLength(2);
    expect(stored().sessions[0].messages.at(-1)?.status).toBe('complete');
    expect(stored().sessions[0].messages.at(-1)?.text.length).toBeGreaterThan(
      stoppedText?.length || 0,
    );
  });

  it('does not continue generation after leaving and offers recovery after reloading its URL', () => {
    const first = render(<AiApp />);
    fireEvent.change(screen.getByRole('textbox', { name: 'AI消息' }), {
      target: { value: '说说今天可以做什么' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    const sessionPath = screen.getByTestId('location').textContent || '';
    first.unmount();
    finishReply();
    expect(stored().sessions[0].messages).toHaveLength(1);
    render(<AiApp entry={sessionPath} />);
    expect(screen.getByText('上次回复未完成')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    finishReply();
    expect(stored().sessions[0].messages).toHaveLength(2);
  });

  it('copies completed responses and provides a selection fallback if clipboard access is absent', async () => {
    render(<AiApp />);
    fireEvent.change(screen.getByRole('textbox', { name: 'AI消息' }), {
      target: { value: '你好' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    finishReply();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制回复' }));
    });
    expect(writeText).toHaveBeenCalledWith(stored().sessions[0].messages.at(-1)?.text);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制回复' }));
    });
    expect(screen.getByText(/回复已选中/)).toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe(stored().sessions[0].messages.at(-1)?.text);
  });

  it('renames, confirms deletion and restores a history record without changing its URL', () => {
    const session = newAiSession();
    session.title = '周末灵感';
    localStorage.setItem(
      AI_STORAGE_KEY,
      JSON.stringify({ ...defaultAiState, sessions: [session] }),
    );
    render(<AiApp entry="/ai/history" />);
    fireEvent.click(screen.getByRole('button', { name: '重命名周末灵感' }));
    fireEvent.change(screen.getByRole('textbox', { name: '会话名称' }), {
      target: { value: '我的活动计划' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(stored().sessions[0].title).toBe('我的活动计划');
    fireEvent.click(screen.getByRole('button', { name: '删除我的活动计划' }));
    expect(stored().sessions).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(stored().sessions).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    fireEvent.click(screen.getByRole('link', { name: /我的活动计划/ }));
    expect(screen.getByTestId('location')).toHaveTextContent(`/ai/chat/${session.id}`);
  });

  it('keeps an unsent draft and stays on the page after a storage failure', () => {
    render(<AiApp />);
    const draft = screen.getByRole('textbox', { name: 'AI消息' });
    fireEvent.change(draft, { target: { value: '重要但还没发送的内容' } });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(screen.getByRole('alert')).toHaveTextContent('草稿已保留');
    expect(draft).toHaveValue('重要但还没发送的内容');
    expect(screen.getByTestId('location')).toHaveTextContent('/ai');
    expect(stored().sessions).toHaveLength(0);
  });

  it('keeps a failed chat draft and does not add an unpersisted user message', () => {
    const session = newAiSession('会话草稿');
    localStorage.setItem(
      AI_STORAGE_KEY,
      JSON.stringify({ ...defaultAiState, sessions: [session] }),
    );
    render(<AiApp entry={`/ai/chat/${session.id}`} />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(screen.getByRole('textbox', { name: 'AI消息' })).toHaveValue('会话草稿');
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(stored().sessions[0].messages).toHaveLength(0);
  });

  it('handles unknown IDs and corrupt local records without creating phantom sessions', () => {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify({ version: 1, sessions: [null] }));
    render(<AiApp entry="/ai/chat/does-not-exist" />);
    expect(screen.getByText('会话不存在')).toBeInTheDocument();
    expect(stored().sessions).toEqual([]);
    fireEvent.click(screen.getByRole('link', { name: '返回 AI' }));
    expect(screen.getByRole('button', { name: /总结/ })).toBeInTheDocument();
  });

  it('searches real history text and supports a fresh blank conversation', () => {
    const session = newAiSession();
    session.title = '旅行';
    session.messages = [userMessage('去海边带什么')];
    localStorage.setItem(
      AI_STORAGE_KEY,
      JSON.stringify({ ...defaultAiState, sessions: [session] }),
    );
    render(<AiApp entry="/ai/history" />);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索会话' }), {
      target: { value: '海边' },
    });
    expect(screen.getByRole('heading', { name: '旅行' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索会话' }), {
      target: { value: '不存在的关键词' },
    });
    expect(screen.getByText('没有找到会话')).toBeInTheDocument();
  });
});
