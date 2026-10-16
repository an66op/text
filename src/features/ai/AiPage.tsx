import { useState } from 'react';
import {
  Bot,
  ChevronRight,
  History,
  Languages,
  Lightbulb,
  ListChecks,
  PenLine,
  Plus,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { useToast } from '@/shared/ui/useToast';
import { AiChatPage } from './AiChatPage';
import { AiComposer } from './AiComposer';
import { useAiStore, type AiSave } from './useAiStore';
import {
  aiPaths,
  aiStarters,
  newAiSession,
  titleFromPrompt,
  userMessage,
  type AiSession,
  type AiState,
} from './ai-model';

export default function AiPage({ kind = 'home' }: { kind?: 'home' | 'chat' | 'history' }) {
  const { state, save } = useAiStore();
  const { sessionId = '' } = useParams();
  if (kind === 'chat') {
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session)
      return (
        <section className="ai-page">
          <PageHeader title="对话" backTo={aiPaths.home} />
          <div className="ai-empty">
            <Bot size={34} />
            <h1>会话不存在</h1>
            <p>这个会话可能已删除，或链接已失效。</p>
            <Link className="primary" to={aiPaths.home}>
              返回 AI
            </Link>
            <Link className="ai-text-button" to={aiPaths.history}>
              查看历史
            </Link>
          </div>
        </section>
      );
    return <AiChatPage key={session.id} session={session} save={save} />;
  }
  if (kind === 'history') return <AiHistoryPage state={state} save={save} />;
  return <AiHomePage state={state} save={save} />;
}

function AiHomePage({ state, save }: { state: AiState; save: AiSave }) {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const recent = [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const create = (prompt = '', send = false) => {
    setError('');
    try {
      if (state.sessions.length >= 50)
        throw new Error('最多保留 50 个会话，请先在历史中删除不再需要的会话');
      const session = newAiSession(send ? '' : prompt);
      if (send) {
        session.messages = [userMessage(prompt)];
        session.title = titleFromPrompt(prompt);
        session.needsReply = true;
      }
      save((previous) => ({
        ...previous,
        sessions: [session, ...previous.sessions],
        homeDraft: send ? '' : previous.homeDraft,
      }));
      navigate(aiPaths.chat(session.id));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败，草稿已保留');
      return false;
    }
  };
  const draft = (text: string) => {
    try {
      save((previous) => ({ ...previous, homeDraft: text }));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '草稿暂未保存');
    }
  };
  const starterIcons = {
    writing: PenLine,
    summary: ListChecks,
    translation: Languages,
    ideas: Lightbulb,
  };
  return (
    <section className="ai-page ai-home-page">
      <header className="ai-home-header">
        <h1>AI</h1>
        <Link to={aiPaths.history} aria-label="会话历史">
          <History size={22} />
        </Link>
        <button type="button" aria-label="新建会话" onClick={() => create()}>
          <Plus size={23} />
        </button>
      </header>
      <div className="ai-home-body">
        <div className="ai-home-content">
          <div className="ai-welcome">
            <span>
              <Bot size={33} strokeWidth={1.6} />
            </span>
            <h2>有什么想聊的？</h2>
            <p>本地演示助手</p>
          </div>
          <div className="ai-starters">
            {aiStarters.map((starter) => {
              const Icon = starterIcons[starter.id];
              return (
                <button type="button" key={starter.id} onClick={() => create(starter.prompt)}>
                  <span>
                    <Icon size={21} strokeWidth={1.7} />
                  </span>
                  <div>
                    <strong>{starter.label}</strong>
                    <small>{starter.detail}</small>
                  </div>
                  <ChevronRight size={14} />
                </button>
              );
            })}
          </div>
          {recent.length > 0 && (
            <section className="ai-recent">
              <div>
                <h2>最近会话</h2>
                <Link to={aiPaths.history}>
                  全部
                  <ChevronRight size={13} />
                </Link>
              </div>
              {recent.map((session) => (
                <Link key={session.id} to={aiPaths.chat(session.id)}>
                  <span>{session.title}</span>
                  <ChevronRight size={15} />
                </Link>
              ))}
            </section>
          )}
        </div>
        <div className="ai-home-compose">
          {error && (
            <p className="ai-error" role="alert">
              {error}
            </p>
          )}
          <AiComposer
            initialDraft={state.homeDraft}
            onDraft={draft}
            onSend={(text) => create(text, true)}
            placeholder="问点什么，或从上面开始…"
          />
        </div>
      </div>
    </section>
  );
}

function AiHistoryPage({ state, save }: { state: AiState; save: AiSave }) {
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const notify = useToast();
  const sessions = [...state.sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((session) =>
      `${session.title} ${session.messages.map((message) => message.text).join(' ')}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
  const rename = (session: AiSession) => {
    setError('');
    if (!title.trim()) {
      setError('请输入会话名称');
      return;
    }
    try {
      save((previous) => ({
        ...previous,
        sessions: previous.sessions.map((item) =>
          item.id === session.id ? { ...item, title: title.trim(), updatedAt: Date.now() } : item,
        ),
      }));
      setRenaming(null);
      notify('会话已重命名');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '重命名失败');
    }
  };
  const remove = (session: AiSession) => {
    setError('');
    try {
      save((previous) => ({
        ...previous,
        sessions: previous.sessions.filter((item) => item.id !== session.id),
        deleted: session,
      }));
      setDeleting(null);
      notify('会话已删除，可以撤销');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败');
    }
  };
  const undo = () => {
    setError('');
    try {
      save((previous) => {
        if (!previous.deleted) return previous;
        if (previous.sessions.length >= 50) throw new Error('请先腾出一个会话位置');
        return {
          ...previous,
          sessions: [
            ...previous.sessions.filter((session) => session.id !== previous.deleted?.id),
            previous.deleted,
          ],
          deleted: null,
        };
      });
      notify('会话已恢复');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '恢复失败');
    }
  };
  return (
    <section className="ai-page ai-history-page">
      <PageHeader title="历史" backTo={aiPaths.home} />
      <div className="ai-history-body">
        <label className="ai-history-search">
          <Search size={18} />
          <input
            aria-label="搜索会话"
            placeholder="搜索会话"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
        {state.deleted && (
          <div className="ai-delete-undo">
            <span>已删除「{state.deleted.title}」</span>
            <button type="button" onClick={undo}>
              <Undo2 size={14} />
              撤销
            </button>
          </div>
        )}
        {sessions.length ? (
          <div className="ai-history-list">
            {sessions.map((session) => (
              <article key={session.id}>
                <div className="ai-history-row">
                  <Link to={aiPaths.chat(session.id)}>
                    <span className="ai-history-icon">
                      <Bot size={21} />
                    </span>
                    <div>
                      <h2>{session.title}</h2>
                      <p>
                        {session.messages
                          .at(-1)
                          ?.text.replace(/^本地演示回复\s*/, '')
                          .slice(0, 52) ||
                          session.draft ||
                          '开始新的对话'}
                      </p>
                      <small>
                        {new Date(session.updatedAt).toLocaleDateString('zh-CN', {
                          month: 'long',
                          day: 'numeric',
                        })}{' '}
                        · {session.messages.filter((message) => message.role === 'user').length}{' '}
                        轮对话
                      </small>
                    </div>
                  </Link>
                  <div className="ai-history-tools">
                    <button
                      type="button"
                      aria-label={`重命名${session.title}`}
                      onClick={() => {
                        setRenaming(renaming === session.id ? null : session.id);
                        setTitle(session.title);
                        setDeleting(null);
                      }}
                    >
                      <PenLine size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除${session.title}`}
                      onClick={() => {
                        setDeleting(deleting === session.id ? null : session.id);
                        setRenaming(null);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {renaming === session.id && (
                  <form
                    className="ai-history-inline"
                    onSubmit={(event) => {
                      event.preventDefault();
                      rename(session);
                    }}
                  >
                    <input
                      className="field"
                      aria-label="会话名称"
                      value={title}
                      maxLength={48}
                      autoFocus
                      onChange={(event) => setTitle(event.target.value)}
                    />
                    <div>
                      <button className="secondary" type="button" onClick={() => setRenaming(null)}>
                        取消
                      </button>
                      <button className="primary" type="submit" disabled={!title.trim()}>
                        保存
                      </button>
                    </div>
                  </form>
                )}
                {deleting === session.id && (
                  <div className="ai-history-inline">
                    <p>删除这个会话？删除后可以撤销。</p>
                    <div>
                      <button className="secondary" type="button" onClick={() => setDeleting(null)}>
                        取消
                      </button>
                      <button
                        className="ai-danger-button"
                        type="button"
                        onClick={() => remove(session)}
                      >
                        确认删除
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="ai-empty">
            <History size={33} />
            <h1>{query ? '没有找到会话' : '还没有会话'}</h1>
            <p>{query ? '试试其他关键词。' : '从一个问题或灵感开始。'}</p>
            {query ? (
              <button className="secondary" type="button" onClick={() => setQuery('')}>
                清除搜索
              </button>
            ) : (
              <Link className="primary" to={aiPaths.home}>
                开始对话
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
