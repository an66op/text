import { useState, type FormEvent } from 'react';
import { ArrowRight, Fingerprint, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { apiErrorMessage } from '@/shared/api/client';
import { useAuth } from './useAuth';
import { safeReturnTo } from './auth-paths';
import { PlatformError } from './PlatformUi';
import './platform.css';

export default function AuthPage({ kind = 'login' }: { kind?: 'login' | 'register' }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = safeReturnTo(params.get('returnTo'));
  const register = kind === 'register';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event?: FormEvent, demo = false) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (register && !demo)
        await auth.register({
          email: email.trim(),
          password,
          name: name.trim(),
          handle: handle.trim(),
        });
      else
        await auth.login(
          demo ? 'demo@gongming.local' : email.trim(),
          demo ? 'Demo2026!' : password,
        );
      navigate(destination, { replace: true });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="platform-page platform-auth-page">
      <PageHeader title={register ? '注册' : '登录'} backTo={destination} />
      <div className="platform-auth-content">
        <span className="platform-auth-symbol">
          <Fingerprint size={38} strokeWidth={1.4} />
        </span>
        <h1>{register ? '从一个名字开始' : '回到你的共鸣'}</h1>
        <p>
          {register ? '创建账号，和真实的人分享、交流。' : '一个账号，连接社区、通讯与更多可能。'}
        </p>
        <form className="platform-form" onSubmit={(event) => void submit(event)}>
          {register && (
            <>
              <label>
                <span>昵称</span>
                <div>
                  <UserRound size={18} />
                  <input
                    autoComplete="nickname"
                    required
                    maxLength={40}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="大家怎么称呼你"
                  />
                </div>
              </label>
              <label>
                <span>唯一账号</span>
                <div>
                  <span>@</span>
                  <input
                    autoComplete="username"
                    required
                    minLength={3}
                    maxLength={30}
                    pattern="[a-z][a-z0-9_]{2,29}"
                    title="3–30 位小写英文字母、数字或下划线，以字母开头"
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    placeholder="英文、数字或下划线"
                  />
                </div>
              </label>
            </>
          )}
          <label>
            <span>邮箱</span>
            <div>
              <Mail size={18} />
              <input
                type="email"
                required
                autoComplete="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </div>
          </label>
          <label>
            <span>密码</span>
            <div>
              <LockKeyhole size={18} />
              <input
                type="password"
                required
                minLength={register ? 10 : 1}
                maxLength={72}
                autoComplete={register ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={register ? '至少 10 位，最长 72 字节' : '输入密码'}
              />
            </div>
          </label>
          <PlatformError message={error} />
          <button className="platform-primary" disabled={busy} type="submit">
            {busy ? '正在连接…' : register ? '创建账号' : '登录'}
            <ArrowRight size={18} />
          </button>
        </form>
        <Link
          className="platform-switch"
          to={`${register ? '/login' : '/register'}?returnTo=${encodeURIComponent(destination)}`}
        >
          {register ? '已有账号？去登录' : '第一次来？创建账号'}
        </Link>
        {import.meta.env.DEV && (
          <div className="platform-demo-access">
            <span>先体验完整流程</span>
            <button
              type="button"
              className="platform-secondary"
              disabled={busy}
              onClick={() => void submit(undefined, true)}
            >
              使用示例成员账号
            </button>
            <small>连接本地 Go 服务，数据保存在数据库中。</small>
          </div>
        )}
        {auth.user && (
          <Link className="platform-text-link" to={destination}>
            已以 {auth.user.name} 登录，继续访问
          </Link>
        )}
      </div>
    </section>
  );
}
