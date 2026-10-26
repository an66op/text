import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { paths } from '@/shared/config/paths';
import { useToast } from '@/shared/ui/useToast';
import PageHeader from '@/shared/ui/PageHeader';
import { useContent } from '../useContent';
import { ownPost } from '../domain';

export default function PostActionsPage() {
  const { postId } = useParams();
  const { posts, bookmarks, toggleBookmark, deletePost } = useContent();
  const navigate = useNavigate();
  const notify = useToast();
  const [confirming, setConfirming] = useState(false);
  const post = posts.find((item) => item.id === Number(postId));
  const back = post ? paths.post(post.id) : paths.moments;
  if (!post)
    return (
      <>
        <PageHeader title="动态管理" backTo={paths.moments} />
        <div className="empty">
          这条动态已删除或不存在。<Link to={paths.moments}>返回动态</Link>
        </div>
      </>
    );
  const url = new URL(paths.post(post.id), window.location.origin).href;
  return (
    <>
      <PageHeader title="动态管理" backTo={back} />
      <div className="content-page">
        <blockquote className="post-summary">{post.text || '图片动态'}</blockquote>
        <div className="content-action-list">
          <Link to={back}>
            查看完整动态<span>详情与评论</span>
          </Link>
          <button
            onClick={() => {
              toggleBookmark(post.id);
              notify(bookmarks.includes(post.id) ? '已取消收藏' : '已收藏');
            }}
          >
            {bookmarks.includes(post.id) ? '取消收藏' : '收藏动态'}
            <span>保存喜欢的内容</span>
          </button>
          <label className="share-url">
            分享链接
            <input
              aria-label="动态分享链接"
              readOnly
              value={url}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                notify('链接已复制');
              } catch {
                notify('选择上方链接复制即可');
              }
            }}
          >
            复制分享链接
          </button>
        </div>
        {ownPost(post) && (
          <div className="danger-zone">
            <h3>删除自己的动态</h3>
            <p>删除后，此动态、评论和点赞会从本机移除。</p>
            {confirming ? (
              <div className="inline-form">
                <button
                  className="danger-button"
                  onClick={() => {
                    deletePost(post.id);
                    notify('动态已删除');
                    navigate(post.target === 'world' ? paths.localWorld : paths.moments, {
                      replace: true,
                    });
                  }}
                >
                  确认删除
                </button>
                <button className="secondary" onClick={() => setConfirming(false)}>
                  保留动态
                </button>
              </div>
            ) : (
              <button className="danger-button" onClick={() => setConfirming(true)}>
                删除动态
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
