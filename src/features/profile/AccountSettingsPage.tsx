import { useState, type FormEvent } from 'react';
import { ChevronRight, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
import PageHeader from '@/shared/ui/PageHeader';
import { useProfile } from './useProfile';
import { useAccountSettings } from './useAccountSettings';
export default function AccountSettingsPage() {
  const { profile } = useProfile();
  const { settings, update } = useAccountSettings();
  const [email, setEmail] = useState(settings.account.email);
  const [phone, setPhone] = useState(settings.account.phone);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入有效的演示邮箱');
      return;
    }
    if (phone && !/^\+?[0-9 -]{6,20}$/.test(phone)) {
      setError('请输入有效的演示手机号');
      return;
    }
    if (
      update((current) => ({ ...current, account: { email: email.trim(), phone: phone.trim() } }))
    )
      setMessage('演示绑定信息已保存');
    else setError('本地保存失败，请重试');
  };
  return (
    <div className="settings-page">
      <PageHeader title="账号与资料" backTo={paths.settings} />
      <div className="settings-content">
        <section className="settings-group">
          <h2>个人账号</h2>
          <div className="settings-card">
            <Link className="settings-nav-row" to={paths.editProfile}>
              <span className="settings-row-copy">
                <strong>{profile.name}</strong>
                <small>编辑头像、昵称与个人资料</small>
              </span>
              <ChevronRight size={18} />
            </Link>
            <div className="settings-static-row">
              <span>共鸣号</span>
              <strong>@{profile.handle || 'orange_soda'}</strong>
            </div>
            <div className="settings-static-row">
              <span>所在地区</span>
              <strong>{profile.location || '杭州'}</strong>
            </div>
            <div className="settings-static-row">
              <span>账号状态</span>
              <strong className="settings-green">本地演示账号</strong>
            </div>
          </div>
        </section>
        <form onSubmit={submit} className="settings-form" noValidate>
          <section className="settings-group">
            <h2>演示绑定</h2>
            <div className="settings-card settings-form-fields">
              <label>
                邮箱
                <input
                  className="field"
                  aria-label="演示邮箱"
                  type="email"
                  value={email}
                  maxLength={80}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                手机号
                <input
                  className="field"
                  aria-label="演示手机号"
                  type="tel"
                  value={phone}
                  maxLength={20}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </label>
            </div>
          </section>
          <p className="settings-hint">填写仅用于界面体验，不发送短信或验证邮件</p>
          {error && (
            <p role="alert" className="profile-error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="settings-success">
              <CheckCircle2 size={16} />
              {message}
            </p>
          )}
          <button className="primary settings-done">保存演示绑定</button>
        </form>
      </div>
    </div>
  );
}
