import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Waves,
} from 'lucide-react';
import { Navigate, useLocation } from 'react-router';
import { errorMessage } from '../api';
import { frontendUrl } from '../config';
import { safeReturnTo } from '../format';
import { useSession } from '../use-session';
import { Badge, Notice } from '../ui';

export default function LoginPage() {
  const { status, login, error: connectionError, expired } = useSession();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (status === 'authenticated')
    return (
      <Navigate replace to={safeReturnTo((location.state as { from?: string } | null)?.from)} />
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <aside className="login-aside">
        <a className="brand" href={frontendUrl}>
          <span className="brand-mark">
            <Waves size={25} />
          </span>
          <span>
            <strong>共鸣</strong>
            <small>GONGMING CONSOLE</small>
          </span>
        </a>
        <div className="login-statement">
          <span className="eyebrow">COMMUNITY, WITH CARE.</span>
          <h1>
            让每一次连接，
            <br />
            更有价值。
          </h1>
          <p>
            从内容质量到社区秩序，
            <br />
            在一个工作台里，让共鸣持续发生。
          </p>
          <div className="login-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
            <div>
              <Waves size={48} strokeWidth={1.5} />
            </div>
          </div>
        </div>
        <p className="login-aside-footer">
          REACT / GO / POSTGRESQL <span>01 — CONTROL</span>
        </p>
      </aside>
      <main className="login-main">
        <div className="login-top">
          <Badge tone={import.meta.env.DEV ? 'warning' : 'neutral'}>
            {import.meta.env.DEV ? '本地测试环境' : '运营控制台'}
          </Badge>
          <a href={frontendUrl} className="text-link">
            前往社区 <ArrowUpRight size={15} />
          </a>
        </div>
        <section className="login-form-wrap">
          <div className="login-lock">
            <LockKeyhole size={24} />
          </div>
          <p className="eyebrow">WELCOME BACK</p>
          <h2>登录运营工作台</h2>
          <p className="login-description">使用获授权的管理员或审核员账号。</p>
          {expired && <Notice tone="info">登录已过期，请重新登录以继续刚才的操作。</Notice>}
          {(error || connectionError) && <Notice>{error || connectionError}</Notice>}
          <form onSubmit={(event) => void submit(event)}>
            <label className="field">
              邮箱
              <input
                type="email"
                value={email}
                autoComplete="username"
                placeholder="name@gongming.local"
                required
                maxLength={254}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              密码
              <span className="password-field">
                <input
                  type={visible ? 'text' : 'password'}
                  value={password}
                  autoComplete="current-password"
                  placeholder="输入账号密码"
                  required
                  maxLength={128}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  className="icon-button"
                  type="button"
                  aria-label={visible ? '隐藏密码' : '显示密码'}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            <button
              className="button button-primary login-submit"
              type="submit"
              disabled={busy || status === 'checking'}
            >
              {busy ? <LoaderCircle size={18} className="spin" /> : null}
              {busy ? '正在验证…' : status === 'checking' ? '正在检查会话…' : '安全登录'}
              {!busy && <ArrowRight size={18} />}
            </button>
          </form>
          <div className="demo-account">
            <div>
              <strong>首次体验？使用开发示例账号</strong>
              <p>
                只会填入表单，不会自动登录。
                <br />
                生产环境必须禁用这些默认凭据。
              </p>
            </div>
            <button
              className="button button-quiet"
              type="button"
              disabled={busy}
              onClick={() => {
                setEmail('admin@gongming.local');
                setPassword('Admin2026!');
                setError('');
              }}
            >
              填入示例
            </button>
          </div>
          <p className="login-security">
            <ShieldCheck size={15} />
            会话由 HttpOnly Cookie 保护，操作受权限校验并留痕。
          </p>
        </section>
        <p className="login-bottom">共鸣 · 为真实的社区连接而建</p>
      </main>
    </div>
  );
}
