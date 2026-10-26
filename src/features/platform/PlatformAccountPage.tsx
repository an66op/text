import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  Bell,
  Check,
  Cloud,
  Images,
  LogOut,
  MessageCircle,
  Radio,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { Link } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import { useAuth } from './useAuth';
import { LoginNotice, PlatformAvatar, PlatformError } from './PlatformUi';
import { imageUrl } from './platform-format';
import './platform.css';

export default function PlatformAccountPage() {
  const auth = useAuth();
  return <AccountPage key={`${auth.user?.id ?? 'guest'}:${auth.expiresAt}`} />;
}

function AccountPage() {
  const auth = useAuth();
  const active = useRef(true);
  const dispatching = useRef(false);
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [healthError, setHealthError] = useState('');
  const [healthGeneration, setHealthGeneration] = useState(0);
  const [name, setName] = useState(auth.user?.name ?? '');
  const [bio, setBio] = useState(auth.user?.bio ?? '');
  const [avatar, setAvatar] = useState(auth.user?.avatar ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void platformApi
      .health(controller.signal)
      .then(() => {
        if (controller.signal.aborted) return;
        setHealth('online');
        setHealthError('');
      })
      .catch((caught) => {
        if (!controller.signal.aborted && !isAbort(caught)) {
          setHealth('offline');
          setHealthError(apiErrorMessage(caught));
        }
      });
    return () => controller.abort();
  }, [healthGeneration]);
  useEffect(() => {
    setName(auth.user?.name ?? '');
    setBio(auth.user?.bio ?? '');
    setAvatar(auth.user?.avatar ?? '');
  }, [auth.user]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth.user || dispatching.current || !active.current) return;
    if (!name.trim()) {
      setError('请输入昵称');
      return;
    }
    if (avatar.trim() && !imageUrl(avatar)) {
      setError('头像请输入 http 或 https 图片链接');
      return;
    }
    dispatching.current = true;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await auth.updateProfile({ name: name.trim(), bio: bio.trim(), avatar: avatar.trim() });
      if (active.current) setSaved(true);
    } catch (caught) {
      if (active.current) setError(apiErrorMessage(caught));
    } finally {
      dispatching.current = false;
      if (active.current) setBusy(false);
    }
  };
  const logout = async () => {
    if (!auth.user || dispatching.current || !active.current) return;
    dispatching.current = true;
    setBusy(true);
    setError('');
    try {
      await auth.logout();
    } catch (caught) {
      if (active.current) setError(apiErrorMessage(caught));
    } finally {
      dispatching.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <section className="platform-page platform-account-page">
      <PageHeader title="账号" backTo="/me" />
      <div className="platform-content">
        <section className={`platform-service-card platform-service-${health}`}>
          <span className="platform-service-icon">
            <Cloud size={25} />
          </span>
          <div>
            <h2>
              {health === 'online'
                ? '共鸣服务已连接'
                : health === 'checking'
                  ? '正在检查服务'
                  : '暂时无法连接服务'}
            </h2>
            <p>Go API · PostgreSQL · 账号数据同步</p>
          </div>
          <i />
        </section>
        <PlatformError
          message={healthError}
          retry={() => {
            setHealth('checking');
            setHealthGeneration((value) => value + 1);
          }}
        />
        {auth.status === 'checking' ? (
          <p className="platform-empty" role="status">
            正在验证账号…
          </p>
        ) : auth.user ? (
          <>
            <section className="platform-account-identity">
              <PlatformAvatar user={auth.user} />
              <div>
                <h1>{auth.user.name}</h1>
                <p>@{auth.user.handle}</p>
                <span>
                  <ShieldCheck size={13} />
                  {auth.user.role === 'admin'
                    ? '管理员'
                    : auth.user.role === 'moderator'
                      ? '版主'
                      : '正式成员'}
                </span>
              </div>
            </section>
            <form
              className="platform-form platform-profile-form"
              onSubmit={(event) => void save(event)}
            >
              <h2>个人资料</h2>
              <label>
                <span>昵称</span>
                <div>
                  <input
                    required
                    maxLength={40}
                    value={name}
                    onChange={(event) => {
                      setSaved(false);
                      setName(event.target.value);
                    }}
                  />
                </div>
              </label>
              <label>
                <span>个人介绍</span>
                <textarea
                  value={bio}
                  maxLength={200}
                  rows={3}
                  placeholder="分享你的兴趣和近况"
                  onChange={(event) => {
                    setSaved(false);
                    setBio(event.target.value);
                  }}
                />
              </label>
              <label>
                <span>头像链接</span>
                <div>
                  <input
                    type="url"
                    maxLength={1000}
                    value={avatar}
                    placeholder="https://…"
                    onChange={(event) => {
                      setSaved(false);
                      setAvatar(event.target.value);
                    }}
                  />
                </div>
              </label>
              <PlatformError message={error} />
              <button type="submit" className="platform-primary" disabled={busy}>
                {saved ? (
                  <>
                    <Check size={17} />
                    已保存
                  </>
                ) : busy ? (
                  '正在保存…'
                ) : (
                  '保存资料'
                )}
              </button>
            </form>
          </>
        ) : (
          <>
            <LoginNotice returnTo="/account" text="登录账号，让你的内容和消息随你同行" />
            <PlatformError message={auth.error} retry={() => void auth.refresh()} />
          </>
        )}
        <nav className="platform-account-links" aria-label="平台功能">
          <Link to="/notifications">
            <span>
              <Bell size={21} />
              站内通知
            </span>
            <ArrowUpRight size={17} />
          </Link>
          <Link to="/world">
            <span>
              <Radio size={21} />
              全站世界
            </span>
            <ArrowUpRight size={17} />
          </Link>
          <Link to="/messages">
            <span>
              <MessageCircle size={21} />
              实时通讯
            </span>
            <ArrowUpRight size={17} />
          </Link>
          <Link to="/account/sync">
            <span>
              <Cloud size={21} />
              个人备份
            </span>
            <ArrowUpRight size={17} />
          </Link>
          <Link to="/settings/devices">
            <span>
              <Smartphone size={21} />
              登录设备
            </span>
            <ArrowUpRight size={17} />
          </Link>
          <Link to="/account/uploads">
            <span>
              <Images size={21} />
              我的上传
            </span>
            <ArrowUpRight size={17} />
          </Link>
          <Link to="/account/wallets">
            <span>
              <ShieldCheck size={21} />
              钱包身份
            </span>
            <ArrowUpRight size={17} />
          </Link>
          <Link to="/web3">
            <span>
              <ShieldCheck size={21} />
              Web3 实验室
            </span>
            <ArrowUpRight size={17} />
          </Link>
        </nav>
        <p className="platform-footnote">
          这些页面使用服务器数据。原有本机演示内容独立保留，断线时不会替代服务器结果。
        </p>
        {auth.user && (
          <button
            className="platform-logout"
            type="button"
            disabled={busy}
            onClick={() => void logout()}
          >
            <LogOut size={17} />
            退出当前账号
          </button>
        )}
      </div>
    </section>
  );
}
