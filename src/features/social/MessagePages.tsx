import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Copy, Download, FileText, Image, MessageCircle, Search, Trash2 } from 'lucide-react';
import { paths } from '@/shared/config/paths';
import { useToast } from '@/shared/ui/useToast';
import { socialPaths } from './routes';
import { SocialMissing, SocialPageFrame, SocialSearch } from './SocialPageParts';
import { useSocialActions } from './useSocialActions';
import type { ChatMessage, MessageFile } from './types';

function legacyFile(message: ChatMessage): MessageFile | undefined {
  if (message.file) return message.file;
  if (!message.text || !/^[📎📄]/u.test(message.text)) return undefined;
  const [title, ...lines] = message.text.split('\n');
  const originalName = title.replace(/^[📎📄]\s*/u, '');
  const content = `历史文件记录：${originalName}\n原始附件未保存。下面是此消息保留下来的文字：\n\n${lines.join('\n') || '此记录仅保留了文件名，没有原始文件内容。'}`;
  return {
    name: `${originalName.replace(/\.[^.]+$/, '')}-历史文字.txt`,
    content,
    size: new Blob([content]).size,
    type: 'text/plain',
  };
}

export function MessageDetailPage() {
  const { conversationId, messageId } = useParams();
  const { conversations, messages, setMessages, setConversations } = useSocialActions();
  const conversation = conversations.find((item) => item.id === conversationId);
  const message = (messages[conversationId || ''] || []).find((item) => item.id === messageId);
  const [confirmation, setConfirmation] = useState<'delete' | 'revoke' | null>(null);
  const notify = useToast();
  const navigate = useNavigate();
  if (!conversation || !message)
    return (
      <SocialMissing
        title="消息不存在"
        backTo={conversationId ? paths.chat(conversationId) : paths.social}
      />
    );
  const file = legacyFile(message);
  const revoked = message.text === '你撤回了一条消息';
  async function copy() {
    try {
      await navigator.clipboard.writeText(message?.image || file?.content || message?.text || '');
      notify('消息已复制');
    } catch {
      notify('复制失败，请选择文字后手动复制');
    }
  }
  function download() {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('文件已准备下载');
  }
  function remove() {
    if (!conversation || !message) return;
    setMessages((current) => ({
      ...current,
      [conversation.id]:
        confirmation === 'revoke'
          ? (current[conversation.id] || []).map((item) =>
              item.id === message.id
                ? { id: item.id, mine: true, text: '你撤回了一条消息', time: item.time }
                : item,
            )
          : (current[conversation.id] || []).filter((item) => item.id !== message.id),
    }));
    setConversations((current) =>
      current.map((item) =>
        item.id === conversation.id && (messages[conversation.id] || []).at(-1)?.id === message.id
          ? { ...item, preview: confirmation === 'revoke' ? '你撤回了一条消息' : '消息已删除' }
          : item,
      ),
    );
    notify(confirmation === 'revoke' ? '消息已撤回' : '消息已从当前设备删除');
    navigate(paths.chat(conversation.id), { replace: true });
  }
  return (
    <SocialPageFrame
      title={message.image ? '图片详情' : file ? '文件详情' : '消息详情'}
      backTo={paths.chat(conversation.id)}
    >
      <p className="im-page-caption">
        {message.mine ? '我' : conversation.name} · {message.time}
      </p>
      {message.image ? (
        <div className="im-message-preview">
          <img src={message.image} alt="聊天图片完整预览" />
        </div>
      ) : file ? (
        <div className="im-file-detail">
          <FileText size={46} />
          <h2>{file.name}</h2>
          <p>
            {file.type} ·{' '}
            {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}
          </p>
          {!message.file && (
            <p className="im-page-caption">
              历史版本只保存了文件消息的文字，此下载不包含原始附件。
            </p>
          )}
          <pre>{file.content || '此文件没有可预览的文本内容。'}</pre>
          <button className="im-primary im-wide" onClick={download}>
            <Download size={18} />
            下载文件
          </button>
        </div>
      ) : (
        <div className="im-text-detail">{message.text || '空消息'}</div>
      )}
      <div className="im-page-list im-settings-list">
        {!revoked && (
          <>
            <button onClick={copy}>
              <Copy size={18} />
              <span>复制{message.image ? '图片链接' : '内容'}</span>
            </button>
            <button
              onClick={() =>
                navigate(paths.chat(conversation.id), {
                  state: {
                    replyText: file
                      ? `[文件] ${file.name}`
                      : message.image
                        ? '[图片]'
                        : message.text,
                  },
                })
              }
            >
              <MessageCircle size={18} />
              <span>引用回复</span>
            </button>
          </>
        )}
        {message.mine && (
          <>
            <button onClick={() => setConfirmation('delete')}>
              <Trash2 size={18} />
              <span>删除此消息</span>
            </button>
            {!revoked && (
              <button onClick={() => setConfirmation('revoke')}>
                <span>撤回消息</span>
              </button>
            )}
          </>
        )}
      </div>
      {confirmation && (
        <div className="im-page-confirm">
          <strong>
            {confirmation === 'delete' ? '从当前设备删除这条消息？' : '撤回后将显示一条撤回提示。'}
          </strong>
          <div className="im-inline-actions">
            <button className="im-secondary" onClick={() => setConfirmation(null)}>
              取消
            </button>
            <button className="im-danger" onClick={remove}>
              {confirmation === 'delete' ? '确认删除' : '确认撤回'}
            </button>
          </div>
        </div>
      )}
      <Link className="im-secondary im-wide" to={paths.chat(conversation.id)}>
        返回聊天
      </Link>
    </SocialPageFrame>
  );
}

export function ChatSearchPage() {
  const { conversationId } = useParams();
  const { conversations, messages } = useSocialActions();
  const conversation = conversations.find((item) => item.id === conversationId);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | 'images' | 'files'>('all');
  if (!conversation) return <SocialMissing title="会话不存在" backTo={paths.social} />;
  const matches = (messages[conversation.id] || []).filter(
    (message) =>
      (!query ||
        `${message.text || ''} ${message.file?.name || ''}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (type === 'all' || (type === 'images' ? !!message.image : !!legacyFile(message))),
  );
  return (
    <SocialPageFrame title="查找聊天内容" backTo={paths.chat(conversation.id)}>
      <SocialSearch
        query={query}
        setQuery={setQuery}
        label="搜索聊天记录"
        placeholder={`搜索与 ${conversation.name} 的聊天`}
      />
      <div className="im-page-tabs">
        {(
          [
            ['all', '全部'],
            ['images', '图片'],
            ['files', '文件'],
          ] as const
        ).map(([value, label]) => (
          <button
            className={type === value ? 'active' : ''}
            key={value}
            onClick={() => setType(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="im-page-caption">{matches.length} 条消息</p>
      <div className="im-page-list">
        {matches.map((message) => (
          <Link
            className="im-search-message"
            key={message.id}
            to={socialPaths.message(conversation.id, message.id)}
          >
            {message.image ? (
              <Image size={21} />
            ) : legacyFile(message) ? (
              <FileText size={21} />
            ) : (
              <MessageCircle size={21} />
            )}
            <span>
              <strong>
                {message.image ? '[图片]' : legacyFile(message)?.name || message.text}
              </strong>
              <small>
                {message.mine ? '我' : conversation.name} · {message.time}
              </small>
            </span>
          </Link>
        ))}
      </div>
      {!matches.length && (
        <div className="im-page-empty">
          <Search size={34} />
          <h2>没有找到相关消息</h2>
          <p>试试更短的关键词，或切换消息类型。</p>
        </div>
      )}
    </SocialPageFrame>
  );
}
