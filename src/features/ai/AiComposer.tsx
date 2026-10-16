import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
export function AiComposer({
  initialDraft,
  onDraft,
  onSend,
  generating = false,
  onStop,
  placeholder = '发送消息…',
}: {
  initialDraft: string;
  onDraft: (text: string) => void;
  onSend: (text: string) => boolean;
  generating?: boolean;
  onStop?: () => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height = `${Math.min(136, Math.max(25, textarea.current.scrollHeight - 10))}px`;
  }, [draft]);
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (generating || !draft.trim()) return;
    if (onSend(draft)) {
      setDraft('');
      textarea.current?.focus();
    }
  };
  return (
    <form className="ai-composer" onSubmit={send}>
      <textarea
        ref={textarea}
        aria-label="AI消息"
        rows={1}
        value={draft}
        maxLength={4000}
        placeholder={placeholder}
        onChange={(event) => {
          setDraft(event.target.value);
          onDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            send();
          }
        }}
      />
      {generating ? (
        <button className="ai-stop-button" type="button" aria-label="停止生成" onClick={onStop}>
          <Square size={15} fill="currentColor" />
        </button>
      ) : (
        <button
          className="ai-send-button"
          type="submit"
          aria-label="发送消息"
          disabled={!draft.trim()}
        >
          <ArrowUp size={21} />
        </button>
      )}
    </form>
  );
}
