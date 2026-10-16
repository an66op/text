import { useEffect, useRef, useState } from 'react';
import { Bot, Copy, History, RotateCcw } from 'lucide-react';
import { Link } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { useToast } from '@/shared/ui/useToast';
import { AiComposer } from './AiComposer';
import {
  aiPaths,
  generateLocalReply,
  titleFromPrompt,
  userMessage,
  type AiMessage,
  type AiSession,
} from './ai-model';
import type { AiSave } from './useAiStore';

type PendingReply = { text: string; generating: boolean; unsaved?: boolean };

export function AiChatPage({ session, save }: { session: AiSession; save: AiSave }) {
  const [error, setError] = useState('');
  const [request, setRequest] = useState(session.needsReply ? crypto.randomUUID() : '');
  const [pending, setPending] = useState<PendingReply | null>(null);
  const [copyHint, setCopyHint] = useState('');
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const variation = useRef(0);
  const stopRef = useRef<(() => void) | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const notify = useToast();
  const last = session.messages.at(-1);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const regions = [
      { element: controlsRef.current, property: '--ai-chat-header-clearance', extra: 8 },
      { element: composerRef.current, property: '--ai-chat-composer-clearance', extra: 20 },
    ];
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const region = regions.find((item) => item.element === entry.target);
        if (!region) continue;
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        entry.target.parentElement?.style.setProperty(
          region.property,
          `${Math.ceil(height) + region.extra}px`,
        );
      }
    });
    for (const region of regions) if (region.element) observer.observe(region.element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!request) return;
    const current = sessionRef.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let output = '';
    const lastUser = [...current.messages].reverse().find((message) => message.role === 'user');
    if (!lastUser) return;
    const reply = generateLocalReply(current.messages, variation.current);
    const persistReply = (text: string, status: 'complete' | 'stopped') => {
      const message: AiMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text,
        createdAt: Date.now(),
        status,
      };
      save((previous) => ({
        ...previous,
        sessions: previous.sessions.map((item) =>
          item.id === current.id && item.messages.at(-1)?.id === lastUser.id
            ? {
                ...item,
                messages: [...item.messages, message],
                needsReply: false,
                updatedAt: Date.now(),
              }
            : item,
        ),
      }));
    };
    try {
      save((previous) => ({
        ...previous,
        sessions: previous.sessions.map((item) =>
          item.id === current.id ? { ...item, needsReply: false } : item,
        ),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法开始回复');
      return;
    }
    setPending({ text: '', generating: true });
    setError('');
    const finish = (stopped: boolean) => {
      cancelled = true;
      clearTimeout(timer);
      stopRef.current = null;
      const text = stopped ? output || '已停止生成。' : reply;
      try {
        persistReply(text, stopped ? 'stopped' : 'complete');
        setPending(null);
      } catch (caught) {
        setPending({ text, generating: false, unsaved: true });
        setError(caught instanceof Error ? caught.message : '回复暂未保存，可以复制或重新生成');
      }
    };
    const tick = () => {
      if (cancelled) return;
      output = reply.slice(0, output.length + 14);
      setPending({ text: output, generating: true });
      if (output.length >= reply.length) finish(false);
      else timer = setTimeout(tick, 35);
    };
    stopRef.current = () => finish(true);
    timer = setTimeout(tick, 230);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopRef.current = null;
    };
  }, [request, save]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [session.messages.length, pending?.text]);

  const send = (text: string) => {
    if (pending?.generating) return false;
    setError('');
    try {
      const message = userMessage(text);
      if (session.messages.length >= 198) throw new Error('这个会话已满，请返回 AI 开始新会话');
      save((previous) => ({
        ...previous,
        sessions: previous.sessions.map((item) =>
          item.id === session.id
            ? {
                ...item,
                title: item.messages.length ? item.title : titleFromPrompt(text),
                messages: [...item.messages, message],
                draft: '',
                needsReply: true,
                updatedAt: Date.now(),
              }
            : item,
        ),
      }));
      setPending(null);
      setRequest(crypto.randomUUID());
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送失败，草稿已保留');
      return false;
    }
  };
  const draft = (text: string) => {
    try {
      save((previous) => ({
        ...previous,
        sessions: previous.sessions.map((item) =>
          item.id === session.id ? { ...item, draft: text } : item,
        ),
      }));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '草稿暂未保存');
    }
  };
  const regenerate = () => {
    setError('');
    try {
      save((previous) => ({
        ...previous,
        sessions: previous.sessions.map((item) =>
          item.id === session.id
            ? {
                ...item,
                messages:
                  item.messages.at(-1)?.role === 'assistant'
                    ? item.messages.slice(0, -1)
                    : item.messages,
                needsReply: true,
              }
            : item,
        ),
      }));
      variation.current += 1;
      setPending(null);
      setRequest(crypto.randomUUID());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '重新生成失败');
    }
  };
  const copy = async (text: string, element: HTMLElement | null) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      notify('回复已复制');
      setCopyHint('');
    } catch {
      if (element) {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopyHint('回复已选中，请长按复制，或按 ⌘C / Ctrl+C。');
    }
  };
  return (
    <section className="ai-page ai-chat-page">
      <div className="ai-chat-controls" ref={controlsRef}>
        <PageHeader
          title="对话"
          backTo={aiPaths.home}
          action={
            <Link to={aiPaths.history} aria-label="会话历史">
              <History size={21} />
            </Link>
          }
        />
        <div className="ai-chat-title">
          <span>{session.title}</span>
          <small>
            <i />
            本地演示
          </small>
        </div>
      </div>
      <div className="ai-message-list" role="log" aria-label="AI对话内容">
        {!session.messages.length && (
          <div className="ai-chat-welcome">
            <span>
              <Bot size={31} strokeWidth={1.6} />
            </span>
            <h1>从这里开始对话</h1>
            <p>可以写作、整理文字、翻译或寻找灵感。</p>
          </div>
        )}
        {session.messages.map((message) => (
          <article className={`ai-message ai-message-${message.role}`} key={message.id}>
            {message.role === 'assistant' && (
              <span className="ai-message-avatar">
                <Bot size={19} />
              </span>
            )}
            <div>
              <p className="ai-message-text">{message.text}</p>
              {message.role === 'assistant' && (
                <div className="ai-message-tools">
                  {message.status === 'stopped' && <span>已停止</span>}
                  <button
                    type="button"
                    aria-label="复制回复"
                    onClick={(event) =>
                      void copy(
                        message.text,
                        event.currentTarget.closest('article')?.querySelector('.ai-message-text') ||
                          null,
                      )
                    }
                  >
                    <Copy size={13} />
                    复制
                  </button>
                  {message.id === last?.id && !pending?.generating && (
                    <button type="button" onClick={regenerate}>
                      <RotateCcw size={13} />
                      重新生成
                    </button>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}
        {pending && (
          <article className="ai-message ai-message-assistant">
            <span className="ai-message-avatar">
              <Bot size={19} />
            </span>
            <div>
              <p className={`ai-message-text ${pending.generating ? 'ai-generating-text' : ''}`}>
                {pending.text || '正在准备回复…'}
              </p>
              {pending.unsaved && (
                <div className="ai-message-tools">
                  <span>暂未保存</span>
                  <button
                    type="button"
                    aria-label="复制未保存回复"
                    onClick={(event) =>
                      void copy(
                        pending.text,
                        event.currentTarget.closest('article')?.querySelector('.ai-message-text') ||
                          null,
                      )
                    }
                  >
                    <Copy size={13} />
                    复制
                  </button>
                  <button type="button" onClick={regenerate}>
                    <RotateCcw size={13} />
                    重新生成
                  </button>
                </div>
              )}
            </div>
          </article>
        )}
        {last?.role === 'user' && !pending && (
          <div className="ai-interrupted">
            <span>上次回复未完成</span>
            <button type="button" onClick={regenerate}>
              <RotateCcw size={13} />
              重新生成
            </button>
          </div>
        )}
        {copyHint && (
          <p className="ai-copy-hint" role="status">
            {copyHint}
          </p>
        )}
        <div ref={endRef} />
      </div>
      <div className="ai-chat-composer" ref={composerRef}>
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
        <AiComposer
          initialDraft={session.draft}
          onDraft={draft}
          onSend={send}
          generating={pending?.generating}
          onStop={() => stopRef.current?.()}
        />
      </div>
    </section>
  );
}
