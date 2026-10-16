import { useEffect, useRef, useState } from 'react';
import { FileText, ImagePlus, Phone, Plus, Search, Smile, Video, X } from 'lucide-react';
import { useLocalStorage } from '@/shared/hooks/useLocalStorage';
import type { MessageFile } from './types';
import { useToast } from '@/shared/ui/useToast';

type Props = {
  onSend: (text: string, image?: string, file?: MessageFile) => boolean | void;
  draftKey?: string;
  reply?: string;
  onCancelReply?: () => void;
  onToggleSearch: () => void;
  onCall?: (type: '语音' | '视频') => void;
};
const emojis = [
  '😊',
  '😂',
  '🥰',
  '😎',
  '🤔',
  '🥺',
  '👍',
  '❤️',
  '✨',
  '🎉',
  '☕',
  '🌊',
  '🌿',
  '📷',
  '🙌',
  '👋',
];
type Panel = 'attachments' | 'emoji' | null;

export default function ChatComposer({
  onSend,
  onToggleSearch,
  onCall,
  draftKey,
  reply,
  onCancelReply,
}: Props) {
  const [draft, setDraft] = useLocalStorage(
    `social-draft-${draftKey || 'composer'}`,
    '',
    (value): value is string => typeof value === 'string',
  );
  const [panel, setPanel] = useState<Panel>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const notify = useToast();
  const hasDraft = !!draft.trim();

  useEffect(() => {
    if (!panel) return;
    const closePanel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPanel(null);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', closePanel);
    return () => window.removeEventListener('keydown', closePanel);
  }, [panel]);

  function send() {
    if (!hasDraft) return;
    if (onSend(draft) === false) return;
    setDraft('');
    setPanel(null);
    inputRef.current?.focus();
  }
  function attachImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('请选择图片文件');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify('请选择 5 MB 以内的图片');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => notify('无法读取这张图片，请重试');
    reader.onload = () => {
      const image = new window.Image();
      image.onerror = () => notify('这张图片无法打开，请换一张');
      image.onload = () => {
        const ratio = Math.min(1, 1200 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        const context = canvas.getContext('2d');
        if (!context) {
          notify('图片处理失败，请重试');
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        if (onSend('', canvas.toDataURL('image/jpeg', 0.8)) === false) return;
        setPanel(null);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }
  return (
    <div className="im-composer">
      {reply && (
        <div className="im-reply-preview">
          <span>引用：{reply}</span>
          <button aria-label="取消引用" onClick={onCancelReply}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="im-composer-row">
        <input
          ref={inputRef}
          className="im-composer-input"
          type="text"
          aria-label="聊天消息"
          placeholder="发送消息…"
          autoComplete="off"
          value={draft}
          onFocus={() => setPanel(null)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button
          className={`im-composer-toggle ${panel === 'emoji' ? 'im-tool-active' : ''}`}
          aria-label="选择表情"
          aria-expanded={panel === 'emoji'}
          aria-controls="im-composer-emoji"
          onClick={() => setPanel(panel === 'emoji' ? null : 'emoji')}
        >
          <Smile size={26} />
        </button>
        {hasDraft ? (
          <button className="im-send" onClick={send}>
            发送
          </button>
        ) : (
          <button
            className={`im-composer-toggle ${panel === 'attachments' ? 'im-tool-active' : ''}`}
            aria-label="更多聊天功能"
            aria-expanded={panel === 'attachments'}
            aria-controls="im-composer-attachments"
            onClick={() => setPanel(panel === 'attachments' ? null : 'attachments')}
          >
            <Plus size={27} />
          </button>
        )}
      </div>
      {panel === 'attachments' && (
        <div
          className="im-composer-panel im-composer-attachments"
          id="im-composer-attachments"
          role="group"
          aria-label="聊天附件"
        >
          <button aria-label="发送图片" onClick={() => fileRef.current?.click()}>
            <span>
              <ImagePlus size={25} />
            </span>
            图片
          </button>
          <button
            aria-label="发送文件"
            onClick={() => {
              const content = '旅行备忘录\n集合时间：周六 09:00\n记得带上相机和好心情！';
              const sent = onSend('旅行备忘录.txt', undefined, {
                name: '旅行备忘录.txt',
                content,
                size: new Blob([content]).size,
                type: 'text/plain',
              });
              if (sent === false) return;
              setPanel(null);
              notify('已发送示例文件');
            }}
          >
            <span>
              <FileText size={25} />
            </span>
            文件
          </button>
          <button aria-label="选择本地文本文件" onClick={() => documentRef.current?.click()}>
            <span>
              <FileText size={25} />
            </span>
            本地文件
          </button>
          {onCall && (
            <>
              <button
                aria-label="发起语音通话"
                onClick={() => {
                  setPanel(null);
                  onCall('语音');
                }}
              >
                <span>
                  <Phone size={25} />
                </span>
                语音通话
              </button>
              <button
                aria-label="发起视频通话"
                onClick={() => {
                  setPanel(null);
                  onCall('视频');
                }}
              >
                <span>
                  <Video size={25} />
                </span>
                视频通话
              </button>
            </>
          )}
          <button
            aria-label="查找聊天内容"
            onClick={() => {
              setPanel(null);
              onToggleSearch();
            }}
          >
            <span>
              <Search size={25} />
            </span>
            聊天搜索
          </button>
        </div>
      )}
      {panel === 'emoji' && (
        <div
          className="im-composer-panel im-emoji-picker"
          id="im-composer-emoji"
          role="group"
          aria-label="聊天表情"
        >
          {emojis.map((emoji) => (
            <button
              key={emoji}
              onClick={() => setDraft((text) => text + emoji)}
              aria-label={`插入 ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      <input
        ref={documentRef}
        type="file"
        hidden
        accept=".txt,.md,.csv,.json"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          if (file.size > 256 * 1024) {
            notify('请选择 256 KB 以内的文本文件');
            return;
          }
          if (!/\.(txt|md|csv|json)$/i.test(file.name)) {
            notify('支持 TXT、Markdown、CSV 和 JSON 文本文件');
            return;
          }
          try {
            const content = await file.text();
            const sent = onSend(file.name, undefined, {
              name: file.name,
              content,
              size: file.size,
              type: file.type || 'text/plain',
            });
            if (sent === false) return;
            setPanel(null);
          } catch {
            notify('文件读取失败，请重试');
          }
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          attachImage(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}
