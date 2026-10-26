import { useState, type FormEvent } from 'react';
import { ChevronRight, ShieldCheck, Smartphone, Monitor, CheckCircle2, Search } from 'lucide-react';
import { Link } from 'react-router';
import { avatar } from '@/shared/lib/media';
import PageHeader from '@/shared/ui/PageHeader';
import { contacts } from '@/features/social/fixtures';
import { useAccountSettings, useBlockedContacts } from './useAccountSettings';
import { hashDemoPin } from './settings-model';
import SettingsSwitch from './SettingsSwitch';
import { useAuth } from '@/features/platform/useAuth';

export function SecuritySettingsPage() {
  const auth = useAuth();
  const { settings, update } = useAccountSettings();
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [verification, setVerification] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const savePin = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!/^\d{6}$/.test(pin)) {
      setError('演示安全码必须是 6 位数字');
      return;
    }
    if (pin !== confirmation) {
      setError('两次输入的安全码不一致');
      return;
    }
    setBusy(true);
    try {
      if (
        settings.security.pinHash &&
        (await hashDemoPin(oldPin, settings.security.pinSalt ?? '')) !== settings.security.pinHash
      ) {
        setError('原演示安全码不正确');
        return;
      }
      const salt = crypto.randomUUID();
      const hash = await hashDemoPin(pin, salt);
      if (
        !update((current) => ({
          ...current,
          security: { ...current.security, demoLock: true, pinHash: hash, pinSalt: salt },
        }))
      ) {
        setError('保存失败，请重试');
        return;
      }
      setEditing(false);
      setPin('');
      setConfirmation('');
      setOldPin('');
      setMessage('演示安全码已保存，本地保护偏好已开启');
    } catch {
      setError('当前浏览器无法处理安全码，请使用支持 Web Crypto 的本地浏览器');
    } finally {
      setBusy(false);
    }
  };
  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      if (
        (await hashDemoPin(verification, settings.security.pinSalt ?? '')) ===
        settings.security.pinHash
      )
        setMessage('演示安全码校验通过');
      else setError('演示安全码不正确，请重试');
    } catch {
      setError('安全码校验不可用');
    }
    setVerification('');
  };
  return (
    <div className="settings-page">
      <PageHeader title="安全中心" backTo="/settings" />
      <div className="settings-content">
        <div className="settings-security-banner">
          <ShieldCheck size={29} />
          <span>
            <strong>本地演示安全</strong>
            <small>设置保存在当前浏览器，不代表真实账号保护</small>
          </span>
        </div>
        <section className="settings-group">
          <h2>保护设置</h2>
          <div className="settings-card">
            <SettingsSwitch
              label="新设备验证"
              description="保存演示验证偏好，不发送验证码"
              checked={settings.security.deviceVerification}
              onChange={(checked) =>
                update((current) => ({
                  ...current,
                  security: { ...current.security, deviceVerification: checked },
                }))
              }
            />
            <SettingsSwitch
              label="本地保护偏好"
              description="使用演示安全码体验设置与校验流程"
              checked={settings.security.demoLock}
              onChange={(checked) => {
                if (checked && !settings.security.pinHash) {
                  setEditing(true);
                  return;
                }
                update((current) => ({
                  ...current,
                  security: { ...current.security, demoLock: checked },
                }));
              }}
            />
            <button
              className="settings-nav-row"
              onClick={() => {
                setEditing((value) => !value);
                setError('');
                setMessage('');
              }}
            >
              <span className="settings-row-copy">
                <strong>{settings.security.pinHash ? '修改演示安全码' : '设置演示安全码'}</strong>
                <small>6 位数字，仅用于本地演示，请勿使用真实密码</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <Link className="settings-nav-row" to="/settings/devices">
              <span className="settings-row-copy">
                <strong>设备管理</strong>
                <small>
                  {auth.user
                    ? '管理当前账号的登录设备与会话'
                    : auth.status === 'guest'
                      ? `${settings.devices.length} 个演示会话`
                      : '验证账号后读取登录设备'}
                </small>
              </span>
              <ChevronRight size={18} />
            </Link>
          </div>
        </section>
        {editing && (
          <form
            className="settings-card settings-form-fields settings-pin-form"
            onSubmit={(event) => void savePin(event)}
          >
            {settings.security.pinHash && (
              <label>
                原演示安全码
                <input
                  className="field"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  aria-label="原演示安全码"
                  value={oldPin}
                  onChange={(event) => setOldPin(event.target.value)}
                />
              </label>
            )}
            <label>
              新演示安全码
              <input
                className="field"
                type="password"
                inputMode="numeric"
                maxLength={6}
                aria-label="新演示安全码"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
              />
            </label>
            <label>
              再次输入
              <input
                className="field"
                type="password"
                inputMode="numeric"
                maxLength={6}
                aria-label="再次输入安全码"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <button className="primary settings-done" disabled={busy}>
              {busy ? '正在保存…' : '保存演示安全码'}
            </button>
            <button
              type="button"
              className="settings-text-button"
              onClick={() => setEditing(false)}
            >
              取消修改
            </button>
          </form>
        )}
        {settings.security.pinHash && !editing && (
          <form
            className="settings-card settings-form-fields settings-pin-form"
            onSubmit={(event) => void verify(event)}
          >
            <label>
              校验演示安全码
              <input
                className="field"
                type="password"
                inputMode="numeric"
                maxLength={6}
                aria-label="校验演示安全码"
                value={verification}
                onChange={(event) => setVerification(event.target.value)}
              />
            </label>
            <button className="settings-outline-button" disabled={!verification}>
              校验
            </button>
          </form>
        )}
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
      </div>
    </div>
  );
}
export function DeviceSettingsPage() {
  const { settings, update } = useAccountSettings();
  const [removed, setRemoved] = useState('');
  return (
    <div className="settings-page">
      <PageHeader title="设备管理" backTo="/settings/security" />
      <div className="settings-content">
        <p className="settings-page-intro">
          当前浏览器与两条测试设备记录。移除演示设备后，会从此列表中消失。
        </p>
        <div className="settings-card">
          {settings.devices.map((device) => (
            <div className="settings-device-row" key={device.id}>
              <span className="settings-device-icon">
                {device.name.includes('iPhone') ? <Smartphone size={26} /> : <Monitor size={26} />}
              </span>
              <span className="settings-row-copy">
                <strong>{device.name}</strong>
                <small>{device.location}</small>
                <small>{device.lastActive}</small>
              </span>
              {device.current ? (
                <span className="settings-current-device">当前</span>
              ) : (
                <button
                  onClick={() => {
                    if (
                      update((current) => ({
                        ...current,
                        devices: current.devices.filter((item) => item.id !== device.id),
                      }))
                    )
                      setRemoved(`${device.name} 已移除`);
                  }}
                >
                  移除
                </button>
              )}
            </div>
          ))}
        </div>
        {removed && (
          <p className="settings-success" role="status">
            <CheckCircle2 size={16} />
            {removed}
          </p>
        )}
        <p className="settings-hint settings-bottom-hint">
          设备记录仅用于演示，不读取真实登录位置或远程会话。
        </p>
      </div>
    </div>
  );
}
export function BlockedContactsPage() {
  const { blocked, update } = useBlockedContacts();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const available = contacts.filter(
    (contact) =>
      !blocked.includes(contact.id) &&
      `${contact.name} ${contact.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  const change = (ids: string[]) => {
    if (!update(ids)) setError('黑名单未能保存，请重试');
    else setError('');
  };
  return (
    <div className="settings-page">
      <PageHeader title="黑名单" backTo="/settings/privacy" />
      <div className="settings-content">
        <p className="settings-page-intro">
          屏蔽后，本地聊天会阻止你向此联系人发送消息。解除屏蔽后可继续聊天。
        </p>
        <div className="settings-card">
          {blocked.length ? (
            blocked.map((id) => {
              const contact = contacts.find((item) => item.id === id);
              return (
                <div className="settings-blocked-row" key={id}>
                  <img src={avatar(contact?.avatar ?? 12)} alt="" />
                  <span className="settings-row-copy">
                    <strong>{contact?.name ?? `联系人 ${id}`}</strong>
                    <small>已加入黑名单</small>
                  </span>
                  <button onClick={() => change(blocked.filter((item) => item !== id))}>
                    解除屏蔽
                  </button>
                </div>
              );
            })
          ) : (
            <div className="settings-empty">
              <ShieldCheck size={35} />
              <strong>黑名单为空</strong>
              <p>你还没有屏蔽任何联系人。</p>
            </div>
          )}
        </div>
        <button
          className="settings-outline-button settings-add-block"
          onClick={() => setAdding((value) => !value)}
        >
          {adding ? '收起联系人列表' : '添加屏蔽联系人'}
        </button>
        {adding && (
          <section className="settings-group">
            <label className="settings-search">
              <Search size={17} />
              <input
                aria-label="搜索屏蔽联系人"
                placeholder="搜索姓名或共鸣号"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="settings-card">
              {available.length ? (
                available.map((contact) => (
                  <div className="settings-blocked-row" key={contact.id}>
                    <img src={avatar(contact.avatar)} alt="" />
                    <span className="settings-row-copy">
                      <strong>{contact.name}</strong>
                      <small>{contact.note}</small>
                    </span>
                    <button onClick={() => change([...blocked, contact.id])}>屏蔽</button>
                  </div>
                ))
              ) : (
                <div className="settings-empty">
                  <p>没有可添加的联系人，试试其他关键词。</p>
                </div>
              )}
            </div>
          </section>
        )}
        {error && (
          <p className="profile-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
