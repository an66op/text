import { useState } from 'react';
import { Link, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { paths } from '@/shared/config/paths';
import { useToast } from '@/shared/ui/useToast';
import { useProfile } from '@/features/profile/useProfile';
import { useContent } from '../useContent';
import { shortVideos } from '../fixtures';
import { contentRoutes, seededComments } from '../domain';

export default function ShortCommentsPage() {
  const { contentId } = useParams();
  const { comments, replies, addComment, addReply, deleteComment } = useContent();
  const { profile } = useProfile();
  const notify = useToast();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ key: string; author: string } | null>(null);
  const item = shortVideos.find((video) => String(video.id) === contentId);
  if (!item)
    return (
      <>
        <PageHeader title="短视频评论" backTo={paths.shorts} />
        <div className="empty">
          这个短视频不存在。<Link to={paths.shorts}>返回短视频</Link>
        </div>
      </>
    );
  const thread = [
    ...seededComments,
    ...(comments[item.id] ?? []).map((text, index) => ({
      author: profile.name,
      text,
      key: `own-${index}`,
      ownIndex: index,
    })),
  ];
  return (
    <>
      <PageHeader
        title={`评论 · ${thread.length + (replies[item.id]?.length ?? 0)}`}
        backTo={`${paths.shorts}?video=${item.id}`}
      />
      <div className="content-page">
        <Link className="short-comment-preview" to={`${paths.shorts}?video=${item.id}`}>
          <img src={item.image} alt="短视频预览" />
          <div>
            <strong>@{item.author}</strong>
            <p>{item.text}</p>
          </div>
        </Link>
        <section className="comment-thread">
          {thread.map((comment) => (
            <div className="comment-row" key={comment.key}>
              <Link
                className="comment-author"
                to={contentRoutes.author('ownIndex' in comment ? 'me' : comment.author)}
              >
                {comment.author}
              </Link>
              <p>{comment.text}</p>
              <div className="comment-actions">
                <span>刚刚</span>
                <button onClick={() => setReplyTo({ key: comment.key, author: comment.author })}>
                  回复
                </button>
                {'ownIndex' in comment && (
                  <button
                    onClick={() => {
                      setReplyTo(null);
                      deleteComment(item.id, comment.ownIndex as number);
                    }}
                  >
                    删除
                  </button>
                )}
              </div>
              {(replies[item.id] ?? [])
                .filter((reply) => reply.parent === comment.key)
                .map((reply) => (
                  <div className="comment-reply" key={reply.id}>
                    <strong>{reply.author}</strong> 回复 {comment.author}：{reply.text}
                  </div>
                ))}
            </div>
          ))}
        </section>
        <form
          className="comment-composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            if (replyTo && !thread.some((comment) => comment.key === replyTo.key)) {
              setReplyTo(null);
              notify('目标评论已删除，已保留输入内容');
              return;
            }
            if (replyTo)
              addReply(item.id, { text: draft, author: profile.name, parent: replyTo.key });
            else addComment(item.id, draft);
            setDraft('');
            setReplyTo(null);
          }}
        >
          {replyTo && (
            <div className="reply-target">
              回复 {replyTo.author}
              <button type="button" onClick={() => setReplyTo(null)}>
                取消
              </button>
            </div>
          )}
          <div className="inline-form">
            <input
              aria-label="短视频评论内容"
              placeholder={replyTo ? `回复 ${replyTo.author}…` : '写下你的想法…'}
              maxLength={500}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="primary" disabled={!draft.trim()}>
              发送
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
