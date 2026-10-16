import { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Heart,
  MapPin,
  RotateCcw,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { paths } from '@/shared/config/paths';
import { useToast } from '@/shared/ui/useToast';
import { MatchingPreferencesPage } from './MatchingPreferencesPage';
import { useMatching } from './useMatching';
import {
  decideProfile,
  eligibleProfiles,
  intentionLabels,
  matchedProfiles,
  matchingPaths,
  matchingProfiles,
  resetMatchingRound,
  restoreProfile,
  undoMatching,
  type MatchingProfile,
  type MatchingState,
} from './matching-model';

type MatchingKind = 'discover' | 'profile' | 'preferences' | 'connections';
type SaveMatching = ReturnType<typeof useMatching>['save'];

export default function MatchingPage({ kind = 'discover' }: { kind?: MatchingKind }) {
  const { state, save } = useMatching();
  const { profileId = '' } = useParams();
  if (kind === 'preferences')
    return <MatchingPreferencesPage preferences={state.preferences} save={save} />;
  if (kind === 'profile')
    return <MatchingProfilePage key={profileId} profileId={profileId} state={state} save={save} />;
  if (kind === 'connections') return <MatchingConnectionsPage state={state} save={save} />;
  return <MatchingDiscoverPage state={state} save={save} />;
}

function MatchingNav({ current, count }: { current: 'discover' | 'connections'; count: number }) {
  return (
    <nav className="matching-nav" aria-label="匹配导航">
      <Link
        className={current === 'discover' ? 'active' : ''}
        aria-current={current === 'discover' ? 'page' : undefined}
        to={matchingPaths.discover}
      >
        推荐
      </Link>
      <Link
        className={current === 'connections' ? 'active' : ''}
        aria-current={current === 'connections' ? 'page' : undefined}
        to={matchingPaths.connections}
      >
        连接{count > 0 && <span>{count}</span>}
      </Link>
      <Link className="matching-nav-filter" to={matchingPaths.preferences}>
        <SlidersHorizontal size={16} />
        偏好
      </Link>
    </nav>
  );
}

function MatchingDiscoverPage({ state, save }: { state: MatchingState; save: SaveMatching }) {
  const notify = useToast();
  const [error, setError] = useState('');
  const [successId, setSuccessId] = useState<string | null>(null);
  const matched = matchedProfiles(state);
  const eligible = eligibleProfiles(matchingProfiles, state.preferences);
  const remaining = eligible.filter(
    (profile) => !state.decisions.some((decision) => decision.profileId === profile.id),
  );
  const current = remaining[0];
  const success = matchingProfiles.find((profile) => profile.id === successId);
  const skips = state.decisions.filter((decision) => decision.choice === 'skip').length;
  const act = (choice: 'like' | 'skip') => {
    if (!current) return;
    setError('');
    try {
      save((previous) => decideProfile(previous, current.id, choice));
      if (choice === 'like' && current.likesYou) setSuccessId(current.id);
      else notify(choice === 'like' ? '已加入喜欢记录' : '已跳过，可以撤销');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '记录失败，请重试');
    }
  };
  const undo = () => {
    setError('');
    try {
      save(undoMatching);
      setSuccessId(null);
      notify('已撤销上一次操作');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤销失败，请重试');
    }
  };
  const reset = () => {
    setError('');
    try {
      save(resetMatchingRound);
      notify('跳过的资料已重新放回推荐');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '重置失败，请重试');
    }
  };
  return (
    <section className="matching-page">
      <PageHeader title="匹配" backTo={paths.discover} />
      <div className="matching-page-body">
        <MatchingNav current="discover" count={matched.length} />
        {success ? (
          <MatchingSuccess profile={success} onContinue={() => setSuccessId(null)} onUndo={undo} />
        ) : (
          <>
            <div className="matching-recommendation-heading">
              <span>为你推荐</span>
              <small>{remaining.length} 位符合偏好</small>
            </div>
            {current ? (
              <>
                <article className="matching-discover-card">
                  <Link
                    to={matchingPaths.profile(current.id)}
                    className="matching-photo-card"
                    aria-label={`查看${current.name}的资料`}
                  >
                    <img src={current.photo} alt={`${current.name}的资料照片`} />
                    <span className="matching-demo-badge">示例资料</span>
                    <span className="matching-photo-expand">
                      <ArrowUpRight size={20} />
                    </span>
                    <div className="matching-photo-info">
                      <h1>
                        {current.name}
                        <span>{current.age}</span>
                      </h1>
                      <p>
                        <MapPin size={13} />
                        {current.city}
                        <span>·</span>
                        {current.occupation}
                      </p>
                      <div>
                        {current.interests.map((interest) => (
                          <span key={interest}>{interest}</span>
                        ))}
                      </div>
                    </div>
                  </Link>
                  <div className="matching-card-description">
                    <span>{intentionLabels[current.intention]}</span>
                    <p>{current.bio}</p>
                  </div>
                </article>
                <div className="matching-discover-actions">
                  <button
                    className="matching-undo"
                    type="button"
                    aria-label="撤销上次操作"
                    disabled={!state.undo}
                    onClick={undo}
                  >
                    <RotateCcw size={21} />
                    <span>撤销</span>
                  </button>
                  <button
                    className="matching-skip"
                    type="button"
                    aria-label={`跳过${current.name}`}
                    onClick={() => act('skip')}
                  >
                    <X size={29} strokeWidth={1.8} />
                    <span>跳过</span>
                  </button>
                  <button
                    className="matching-like"
                    type="button"
                    aria-label={`喜欢${current.name}`}
                    onClick={() => act('like')}
                  >
                    <Heart size={27} strokeWidth={1.8} />
                    <span>喜欢</span>
                  </button>
                  <Link
                    className="matching-records"
                    to={matchingPaths.connections}
                    aria-label="查看喜欢与跳过记录"
                  >
                    <Users size={21} />
                    <span>记录</span>
                  </Link>
                </div>
              </>
            ) : (
              <div className="matching-empty">
                <span>
                  <Users size={32} />
                </span>
                <h1>{eligible.length ? '已看完这轮推荐' : '暂时没有符合偏好的资料'}</h1>
                <p>
                  {eligible.length
                    ? '喜欢与连接已经保留，可以重新看看跳过的资料。'
                    : '试试调整年龄、城市或兴趣条件。'}
                </p>
                <Link className="primary" to={matchingPaths.preferences}>
                  调整偏好
                </Link>
                {skips > 0 && (
                  <button className="secondary" type="button" onClick={reset}>
                    重置本轮
                  </button>
                )}
                {state.undo && (
                  <button className="matching-text-button" type="button" onClick={undo}>
                    撤销上次操作
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {error && (
          <p className="matching-error" role="alert">
            {error}
          </p>
        )}
        <p className="matching-demo-note">仅展示 18 岁以上示例资料 · 互动保存在本机</p>
      </div>
    </section>
  );
}

function MatchingSuccess({
  profile,
  onContinue,
  onUndo,
  onViewProfile,
}: {
  profile: MatchingProfile;
  onContinue: () => void;
  onUndo: () => void;
  onViewProfile?: () => void;
}) {
  return (
    <section className="matching-success" aria-label="匹配成功">
      <span className="matching-success-label">
        <Heart size={15} fill="currentColor" />
        互相喜欢
      </span>
      <div className="matching-success-photo">
        <img src={profile.photo} alt={profile.name} />
        <i>
          <Check size={23} />
        </i>
      </div>
      <h1>你和{profile.name}已连接</h1>
      <p>双方都选择了喜欢，可以在连接中再次查看资料。</p>
      <Link className="primary" to={matchingPaths.profile(profile.id)} onClick={onViewProfile}>
        查看资料
        <ChevronRight size={17} />
      </Link>
      <button className="secondary" type="button" onClick={onContinue}>
        继续发现
      </button>
      <Link className="matching-text-button" to={matchingPaths.connections}>
        查看连接
      </Link>
      <button className="matching-success-undo" type="button" onClick={onUndo}>
        撤销这次喜欢
      </button>
    </section>
  );
}

function MatchingProfilePage({
  profileId,
  state,
  save,
}: {
  profileId: string;
  state: MatchingState;
  save: SaveMatching;
}) {
  const navigate = useNavigate();
  const profile = matchingProfiles.find((item) => item.id === profileId && item.age >= 18);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const notify = useToast();
  if (!profile)
    return (
      <section className="matching-page">
        <PageHeader title="个人资料" backTo={matchingPaths.discover} />
        <div className="matching-page-body matching-empty">
          <Users size={32} />
          <h1>这份资料暂时无法查看</h1>
          <Link className="primary" to={matchingPaths.discover}>
            返回推荐
          </Link>
        </div>
      </section>
    );
  const decision = state.decisions.find((item) => item.profileId === profileId);
  const connected = decision?.choice === 'like' && profile.likesYou;
  const like = () => {
    setError('');
    try {
      save((previous) => decideProfile(previous, profileId, 'like'));
      if (profile.likesYou) setSuccess(true);
      else notify('已加入喜欢记录');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '记录失败，请重试');
    }
  };
  return (
    <section className="matching-page matching-profile-page">
      <PageHeader title="个人资料" backTo={matchingPaths.discover} />
      <div className="matching-page-body">
        {success ? (
          <MatchingSuccess
            profile={profile}
            onContinue={() => navigate(matchingPaths.discover)}
            onViewProfile={() => setSuccess(false)}
            onUndo={() => {
              try {
                save(undoMatching);
                setSuccess(false);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : '撤销失败');
              }
            }}
          />
        ) : (
          <>
            <div className="matching-profile-photo">
              <img src={profile.photo} alt={`${profile.name}的资料照片`} />
              <span className="matching-demo-badge">示例资料 · 18+</span>
            </div>
            <section className="matching-profile-intro">
              <div>
                <h1>
                  {profile.name}
                  <span>{profile.age}</span>
                </h1>
                {connected && (
                  <span className="matching-connected-badge">
                    <Heart size={12} fill="currentColor" />
                    已连接
                  </span>
                )}
              </div>
              <p>
                <MapPin size={14} />
                {profile.city}
                <span>·</span>
                {profile.occupation}
              </p>
              <span className="matching-intention-badge">{intentionLabels[profile.intention]}</span>
            </section>
            <section className="matching-info-card">
              <h2>关于我</h2>
              <p>{profile.bio}</p>
              <div className="matching-interest-tags">
                {profile.interests.map((interest) => (
                  <span key={interest}>{interest}</span>
                ))}
              </div>
            </section>
            {profile.prompts.map((prompt) => (
              <section className="matching-info-card matching-prompt" key={prompt.question}>
                <h2>{prompt.question}</h2>
                <p>{prompt.answer}</p>
              </section>
            ))}
            {error && (
              <p className="matching-error" role="alert">
                {error}
              </p>
            )}
            <div className="matching-profile-actions">
              {decision?.choice === 'like' ? (
                <Link className="primary" to={matchingPaths.connections}>
                  {connected ? '查看连接' : '查看喜欢记录'}
                  <ChevronRight size={17} />
                </Link>
              ) : (
                <button className="primary" type="button" onClick={like}>
                  <Heart size={18} />
                  喜欢{profile.name}
                </button>
              )}
              <Link className="secondary" to={matchingPaths.discover}>
                继续发现
              </Link>
            </div>
          </>
        )}
        {success && error && (
          <p className="matching-error" role="alert">
            {error}
          </p>
        )}
        <p className="matching-demo-note">示例资料与互动仅用于本机演示</p>
      </div>
    </section>
  );
}

function MatchingConnectionsPage({ state, save }: { state: MatchingState; save: SaveMatching }) {
  const [tab, setTab] = useState<'matches' | 'likes' | 'skips'>('matches');
  const [error, setError] = useState('');
  const notify = useToast();
  const connections = matchedProfiles(state);
  const likes = state.decisions.filter((decision) => decision.choice === 'like');
  const skips = state.decisions.filter((decision) => decision.choice === 'skip');
  const listed =
    tab === 'matches'
      ? connections
      : [...(tab === 'likes' ? likes : skips)]
          .sort((a, b) => b.createdAt - a.createdAt)
          .flatMap((decision) =>
            matchingProfiles.filter((profile) => profile.id === decision.profileId),
          );
  const restore = (profile: MatchingProfile) => {
    setError('');
    try {
      save((previous) => restoreProfile(previous, profile.id));
      notify(tab === 'skips' ? '已放回推荐，可以撤销' : '已取消喜欢，可以撤销');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请重试');
    }
  };
  const undo = () => {
    setError('');
    try {
      save(undoMatching);
      notify('已撤销上一次操作');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤销失败，请重试');
    }
  };
  return (
    <section className="matching-page">
      <PageHeader title="我的连接" backTo={matchingPaths.discover} />
      <div className="matching-page-body">
        <MatchingNav current="connections" count={connections.length} />
        <div className="matching-record-tabs" aria-label="互动记录筛选">
          {(
            [
              { id: 'matches', name: '已连接', count: connections.length },
              { id: 'likes', name: '我喜欢的', count: likes.length },
              { id: 'skips', name: '已跳过', count: skips.length },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.name}
              <span>{item.count}</span>
            </button>
          ))}
        </div>
        {error && (
          <p className="matching-error" role="alert">
            {error}
          </p>
        )}
        {listed.length ? (
          <div className="matching-connection-list">
            {listed.map((profile) => (
              <article key={profile.id}>
                <Link to={matchingPaths.profile(profile.id)} className="matching-connection-person">
                  <img src={profile.photo} alt="" />
                  <div>
                    <h2>
                      {profile.name}
                      <span>{profile.age}</span>
                    </h2>
                    <p>
                      {profile.city} · {profile.occupation}
                    </p>
                    <div>
                      {profile.interests.slice(0, 2).map((interest) => (
                        <span key={interest}>{interest}</span>
                      ))}
                    </div>
                  </div>
                  <ChevronRight size={17} />
                </Link>
                <div className="matching-connection-footer">
                  <span>
                    {tab === 'skips' ? (
                      '已跳过'
                    ) : profile.likesYou ? (
                      <>
                        <Heart size={12} fill="currentColor" />
                        互相喜欢
                      </>
                    ) : (
                      '已喜欢'
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={`${tab === 'skips' ? '重新推荐' : '取消喜欢'}${profile.name}`}
                    onClick={() => restore(profile)}
                  >
                    {tab === 'skips' ? '重新推荐' : '取消喜欢'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="matching-empty">
            <span>
              <Heart size={31} />
            </span>
            <h1>
              {tab === 'matches'
                ? '还没有新的连接'
                : tab === 'likes'
                  ? '还没有喜欢的资料'
                  : '还没有跳过的资料'}
            </h1>
            <p>
              {tab === 'matches'
                ? '当双方都表达喜欢，连接会出现在这里。'
                : '浏览推荐，记录会保存在这里。'}
            </p>
            <Link className="primary" to={matchingPaths.discover}>
              去发现
            </Link>
          </div>
        )}
        {state.undo && (
          <button className="matching-undo-record" type="button" onClick={undo}>
            <RotateCcw size={15} />
            撤销上次操作
          </button>
        )}
        <p className="matching-demo-note">示例连接仅保存在本机，不会添加到联系人</p>
      </div>
    </section>
  );
}
