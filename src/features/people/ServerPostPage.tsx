import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { apiRequest, apiErrorMessage, isAbort } from '@/shared/api/client';
import { useAuth } from '@/features/platform/useAuth';
import { PlatformError } from '@/features/platform/PlatformUi';
import { WorldPost } from '@/features/platform/ServerWorldPage';
import type { PlatformPost } from '@/shared/api/types';
import './people.css';

export default function ServerPostPage() {
  const { postId = '' } = useParams();
  const { user } = useAuth();
  return <ServerPostDetail key={`${postId}:${user?.id ?? 'guest'}`} postId={postId} />;
}

function ServerPostDetail({ postId }: { postId: string }) {
  const { user } = useAuth();
  const [post, setPost] = useState<PlatformPost | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setPost(null);
    setError('');
    void apiRequest<PlatformPost>(`/posts/${encodeURIComponent(postId)}`, {
      signal: controller.signal,
    })
      .then((next) => {
        if (!controller.signal.aborted) setPost(next);
      })
      .catch((caught) => {
        if (!controller.signal.aborted && !isAbort(caught)) setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [postId, user?.id, revision]);
  return (
    <section className="platform-page people-post-detail">
      <PageHeader title="动态" backTo="/world" />
      <div className="people-profile-content">
        <PlatformError message={error} retry={() => setRevision((value) => value + 1)} />
        {loading ? (
          <p className="people-empty" role="status">
            正在加载动态…
          </p>
        ) : post ? (
          <WorldPost
            key={`${user?.id ?? 'guest'}:${post.id}`}
            post={post}
            onReplace={setPost}
            onDeleted={() => {
              setPost(null);
              setError('这条动态已删除');
            }}
          />
        ) : (
          <div className="people-empty">
            <p>这条动态已不可查看</p>
            <Link to="/world">返回世界</Link>
          </div>
        )}
      </div>
    </section>
  );
}
