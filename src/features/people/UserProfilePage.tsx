import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Flag, MessageCircle, Waves } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/features/platform/useAuth';
import { LoginNotice, PlatformAvatar, PlatformError } from '@/features/platform/PlatformUi';
import { WorldPost } from '@/features/platform/ServerWorldPage';
import PageHeader from '@/shared/ui/PageHeader';
import { apiRequest, apiErrorMessage, isAbort } from '@/shared/api/client';
import type { PlatformPost, PublicUser } from '@/shared/api/types';
import { paths } from '@/shared/config/paths';
import { peopleApi } from './people-api';
import './people.css';

export default function UserProfilePage() {
  const { handle = '' } = useParams();
  const { user } = useAuth();
  return <UserProfile key={`${user?.id ?? 'guest'}:${handle}`} handle={handle} />;
}
function UserProfile({ handle }: { handle: string }) {
  const { user, status } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const [person, setPerson] = useState<PublicUser | null>(null);
  const [posts, setPosts] = useState<PlatformPost[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [reported, setReported] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void Promise.all([
      peopleApi.user(handle, controller.signal),
      peopleApi.posts(handle, offset, controller.signal),
    ])
      .then(([nextPerson, result]) => {
        if (controller.signal.aborted) return;
        setPerson(nextPerson);
        setPosts((previous) =>
          offset
            ? [
                ...previous.filter((post) => !result.items.some((entry) => entry.id === post.id)),
                ...result.items,
              ]
            : result.items,
        );
        setTotal(result.total);
      })
      .catch((caught) => {
        if (!controller.signal.aborted && !isAbort(caught)) {
          setError(apiErrorMessage(caught));
          if (!offset) {
            setPerson(null);
            setPosts([]);
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [handle, userId, offset, revision]);
  const chat = async () => {
    if (!person || busy) return;
    setBusy(true);
    setError('');
    try {
      const conversation = await peopleApi.startChat(person);
      if (!active.current) return;
      window.dispatchEvent(new Event('gongming:conversations-changed'));
      navigate(`/social?conversation=${encodeURIComponent(conversation.id)}`);
    } catch (caught) {
      if (active.current) setError(apiErrorMessage(caught));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const report = async (event: FormEvent) => {
    event.preventDefault();
    if (!person || !reason.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest('/reports', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'user', targetId: person.id, reason: reason.trim() }),
      });
      if (active.current) {
        setReported(true);
        setReporting(false);
      }
    } catch (caught) {
      if (active.current) setError(apiErrorMessage(caught));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const reloadPosts = () => {
    setOffset(0);
    setRevision((value) => value + 1);
  };
  return (
    <section className="people-profile platform-page">
      <PageHeader title="资料" backTo={paths.contacts} />
      <div className="people-profile-content">
        {!user ? (
          status === 'checking' ? (
            <p className="people-empty" role="status">
              正在验证账号…
            </p>
          ) : (
            <LoginNotice returnTo={paths.user(handle)} text="登录后查看共鸣成员资料" />
          )
        ) : (
          <>
            {person && (
              <section className="people-identity">
                <span className="people-profile-orbit" aria-hidden="true">
                  <Waves size={100} strokeWidth={0.6} />
                </span>
                <PlatformAvatar user={person} />
                <h1>{person.name}</h1>
                <p className="people-profile-handle">@{person.handle}</p>
                <p className="people-profile-bio">{person.bio || '每一次相遇，都有新的可能。'}</p>
                {user.id === person.id ? (
                  <Link className="people-message" to={paths.account}>
                    编辑我的资料
                  </Link>
                ) : (
                  <div className="people-profile-actions">
                    <button className="people-message" disabled={busy} onClick={() => void chat()}>
                      <MessageCircle size={18} />
                      发消息
                    </button>
                    <button
                      className="people-report"
                      aria-label="举报这位成员"
                      disabled={busy || reported}
                      onClick={() => setReporting((value) => !value)}
                    >
                      <Flag size={17} />
                      {reported ? '已举报' : '举报'}
                    </button>
                  </div>
                )}
              </section>
            )}
            <PlatformError message={error} retry={() => setRevision((value) => value + 1)} />
            {loading && !person && (
              <p className="people-empty" role="status">
                正在加载成员资料…
              </p>
            )}
            {reported && (
              <p className="people-report-result" role="status">
                举报已提交，处理结果由运营团队核实。
              </p>
            )}
            {reporting && (
              <form className="people-report-form" onSubmit={(event) => void report(event)}>
                <label>
                  举报原因
                  <textarea
                    required
                    rows={3}
                    maxLength={1000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="描述你遇到的问题，帮助我们核实"
                  />
                </label>
                <button disabled={busy || !reason.trim()} type="submit">
                  {busy ? '正在提交…' : '提交举报'}
                </button>
                <button type="button" onClick={() => setReporting(false)} disabled={busy}>
                  取消
                </button>
              </form>
            )}
            {person && (
              <section className="people-author-posts" aria-label="成员公开动态">
                <div className="people-author-heading">
                  <h2>公开动态</h2>
                  <span>{total} 条</span>
                </div>
                {posts.length
                  ? posts.map((post) => (
                      <WorldPost
                        key={post.id}
                        post={post}
                        onReplace={(next) =>
                          setPosts((previous) =>
                            previous.map((entry) => (entry.id === next.id ? next : entry)),
                          )
                        }
                        onDeleted={reloadPosts}
                      />
                    ))
                  : !loading && (
                      <p className="people-footnote">还没有公开动态，先从一句问候开始吧。</p>
                    )}
                {posts.length < total && (
                  <button
                    className="people-load-more"
                    disabled={loading}
                    onClick={() => setOffset(posts.length)}
                  >
                    {loading ? '正在加载…' : '更多动态'}
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </section>
  );
}
