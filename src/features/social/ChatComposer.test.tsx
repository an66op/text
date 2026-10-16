import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import ChatComposer from './ChatComposer';

function renderComposer() {
  const onSend = vi.fn();
  const onCall = vi.fn();
  const onToggleSearch = vi.fn();
  render(
    <ToastProvider>
      <ChatComposer onSend={onSend} onCall={onCall} onToggleSearch={onToggleSearch} />
    </ToastProvider>,
  );
  return { onSend, onCall, onToggleSearch };
}

function openAttachments() {
  fireEvent.click(screen.getByRole('button', { name: '更多聊天功能' }));
}

describe('compact chat composer', () => {
  beforeEach(() => localStorage.clear());
  it('shows extra actions only after opening plus, keeps panels exclusive and closes with Escape', () => {
    renderComposer();
    expect(screen.queryByRole('group', { name: '聊天附件' })).not.toBeInTheDocument();
    openAttachments();
    expect(screen.getByRole('group', { name: '聊天附件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多聊天功能' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '选择表情' }));
    expect(screen.queryByRole('group', { name: '聊天附件' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: '聊天表情' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: '聊天表情' })).not.toBeInTheDocument();
  });

  it('switches plus to send for text, protects IME confirmation and clears after sending', () => {
    const { onSend } = renderComposer();
    const input = screen.getByRole('textbox', { name: '聊天消息' });
    fireEvent.change(input, { target: { value: '你好' } });
    expect(screen.queryByRole('button', { name: '更多聊天功能' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledExactlyOnceWith('你好');
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: '更多聊天功能' })).toBeInTheDocument();
  });

  it('inserts emoji without losing text and routes panel actions to existing call/search handlers', () => {
    const { onSend, onCall, onToggleSearch } = renderComposer();
    fireEvent.click(screen.getByRole('button', { name: '选择表情' }));
    fireEvent.click(screen.getByRole('button', { name: '插入 😊' }));
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('😊');
    expect(screen.queryByRole('group', { name: '聊天表情' })).not.toBeInTheDocument();
    openAttachments();
    fireEvent.click(screen.getByRole('button', { name: '发起语音通话' }));
    expect(onCall).toHaveBeenCalledExactlyOnceWith('语音');
    expect(screen.queryByRole('group', { name: '聊天附件' })).not.toBeInTheDocument();
    openAttachments();
    fireEvent.click(screen.getByRole('button', { name: '查找聊天内容' }));
    expect(onToggleSearch).toHaveBeenCalledOnce();
    expect(screen.queryByRole('group', { name: '聊天附件' })).not.toBeInTheDocument();
  });
  it('persists each conversation draft and restores it after remount without leaking to another chat', () => {
    const onSend = vi.fn();
    const first = render(
      <ToastProvider>
        <ChatComposer draftKey="lin" onSend={onSend} onToggleSearch={() => {}} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), {
      target: { value: '还没发出的旅行计划' },
    });
    first.unmount();
    const second = render(
      <ToastProvider>
        <ChatComposer draftKey="mia" onSend={onSend} onToggleSearch={() => {}} />
      </ToastProvider>,
    );
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('');
    second.unmount();
    render(
      <ToastProvider>
        <ChatComposer draftKey="lin" onSend={onSend} onToggleSearch={() => {}} />
      </ToastProvider>,
    );
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('还没发出的旅行计划');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(JSON.parse(localStorage.getItem('social-draft-lin') || 'null')).toBe('');
  });

  it('keeps the draft when sending is declined and creates a usable text attachment', () => {
    const onSend = vi.fn(() => false);
    render(
      <ToastProvider>
        <ChatComposer onSend={onSend} onToggleSearch={() => {}} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), {
      target: { value: '保留这段话' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(screen.getByRole('textbox', { name: '聊天消息' })).toHaveValue('保留这段话');
    fireEvent.change(screen.getByRole('textbox', { name: '聊天消息' }), { target: { value: '' } });
    openAttachments();
    fireEvent.click(screen.getByRole('button', { name: '发送文件' }));
    expect(onSend).toHaveBeenLastCalledWith(
      '旅行备忘录.txt',
      undefined,
      expect.objectContaining({
        name: '旅行备忘录.txt',
        type: 'text/plain',
        content: expect.stringContaining('集合时间'),
        size: expect.any(Number),
      }),
    );
  });
});
