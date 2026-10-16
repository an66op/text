import { useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '@/shared/ui/useToast';
import { useProfile } from '@/features/profile/useProfile';
import { useContent } from '../useContent';
import PostCard from '../components/PostCard';
import { contentRoutes, seededComments } from '../domain';
import type { Post } from '../types';

export default function PostDetail({ post }: { post: Post }) {
  const notify = useToast();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ key: string; author: string } | null>(null);
  const { comments, replies, addComment, addReply, deleteComment } = useContent();
  const { profile } = useProfile();
  const thread = [
    ...seededComments,
    ...(comments[post.id] ?? []).map((text, index) => ({
      author: profile.name,
      text,
      key: `own-${index}`,
      ownIndex: index,
    })),
  ];
  return (
    <>
      <PostCard post={post} />
      <section className="content-page comment-thread">
        <h3>评论 · {thread.length + (replies[post.id]?.length ?? 0)}</h3>
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
                    deleteComment(post.id, comment.ownIndex as number);
                  }}
                >
                  删除
                </button>
              )}
            </div>
            {(replies[post.id] ?? [])
              .filter((reply) => reply.parent === comment.key)
              .map((reply) => (
                <div className="comment-reply" key={reply.id}>
                  <strong>{reply.author}</strong> 回复 {comment.author}：{reply.text}
                </div>
              ))}
          </div>
        ))}
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
              addReply(post.id, { text: draft, author: profile.name, parent: replyTo.key });
            else addComment(post.id, draft);
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
              aria-label="评论内容"
              maxLength={500}
              placeholder={replyTo ? `回复 ${replyTo.author}…` : '说点友善的话…'}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="primary" disabled={!draft.trim()}>
              发送
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
