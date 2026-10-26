import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import PageHeader from '@/shared/ui/PageHeader';
import ActionDialog from '@/shared/ui/ActionDialog';
import { LoginNotice, PlatformError } from '../PlatformUi';
import { useAuth } from '../useAuth';
import type { SessionDevice } from './session-types';
import { useSessionDevices } from './useSessionDevices';
import '../platform.css';
import './sessions.css';

type Confirmation = { kind: 'one'; device: SessionDevice } | { kind: 'others'; ids: string[] };
const deviceName = (device: SessionDevice) =>
  device.legacy ? '旧会话' : device.device.trim() || '未知设备';
const time = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
};

export default function SessionDevicesPage() {
  const auth = useAuth();
  if (auth.status === 'checking' || auth.status === 'unavailable' || !auth.user)
    return (
      <section className="platform-page session-devices-page">
        <PageHeader title="登录设备" backTo="/settings/security" />
        <div className="session-devices-content">
          {auth.status === 'checking' ? (
            <p className="platform-empty" role="status">
              正在验证账号…
            </p>
          ) : auth.status === 'unavailable' ? (
            <PlatformError
              message={auth.error || '暂时无法验证账号，请连接服务后重试'}
              retry={() => void auth.refresh()}
            />
          ) : (
            <LoginNotice returnTo="/settings/devices" text="登录后，管理服务器上的真实登录设备" />
          )}
        </div>
      </section>
    );
  return <SignedInDevices key={`${auth.user.id}:${auth.expiresAt}`} userId={auth.user.id} />;
}

function SignedInDevices({ userId }: { userId: string }) {
  const auth = useAuth();
  const devices = useSessionDevices(userId, auth.refresh);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [notice, setNotice] = useState('');
  const [attempted, setAttempted] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const others = devices.items.filter((item) => !item.current);
  const ids = others
    .map((item) => item.id)
    .sort()
    .join('\n');
  useEffect(() => {
    if (!confirmation || devices.busy) return;
    const changed =
      confirmation.kind === 'one'
        ? !devices.items.some((item) => item.id === confirmation.device.id)
        : confirmation.ids.join('\n') !== ids;
    if (changed) {
      setConfirmation(null);
      setNotice('设备列表已变化，请重新确认要撤销的设备');
    }
  }, [confirmation, devices.busy, devices.items, ids]);
  const confirm = async () => {
    if (!confirmation) return;
    setAttempted(true);
    const result = await devices.revoke(confirmation);
    if (active.current && result) setConfirmation(null);
  };
  return (
    <section className="platform-page session-devices-page">
      <PageHeader
        title="登录设备"
        backTo="/settings/security"
        action={
          <button
            type="button"
            aria-label="刷新登录设备"
            disabled={devices.busy || devices.currentRevoked || devices.refreshing}
            aria-busy={devices.refreshing}
            onClick={devices.refresh}
          >
            <RefreshCw size={19} />
          </button>
        }
      />
      <div className="session-devices-content">
        <div className="session-devices-intro">
          <ShieldCheck size={22} />
          <div>
            <strong>你的账号，由你掌握</strong>
            <p>只保留你信任的登录设备。</p>
          </div>
        </div>
        <PlatformError message={auth.error} retry={() => void auth.refresh()} />
        <PlatformError message={devices.error} retry={devices.refresh} />
        {(devices.message || notice) && (
          <p role="status" className="session-devices-feedback">
            <Check size={15} />
            {notice || devices.message}
          </p>
        )}
        {devices.currentRevoked ? (
          <button
            className="session-devices-refresh"
            type="button"
            onClick={() => void auth.refresh()}
          >
            重新验证账号
          </button>
        ) : devices.loading ? (
          <p className="platform-empty" role="status">
            正在读取登录设备…
          </p>
        ) : !devices.items.length && !devices.error ? (
          <div className="session-devices-empty">
            <Monitor size={30} />
            <h2>没有可显示的登录设备</h2>
            <button type="button" onClick={devices.refresh}>
              重新读取
            </button>
          </div>
        ) : null}
        <div className="session-devices-list" aria-label="真实登录设备">
          {devices.items.map((device) => (
            <article className="session-device" key={device.id}>
              <span className="session-device-icon">
                {/ios|iphone|android|手机|ipad/i.test(device.device) ? (
                  <Smartphone size={23} />
                ) : (
                  <Monitor size={23} />
                )}
              </span>
              <div className="session-device-copy">
                <div className="session-device-title">
                  <h2>{deviceName(device)}</h2>
                  {device.current && <span>当前设备</span>}
                </div>
                <small>会话 {device.id.slice(-8)}</small>
                <dl>
                  <div>
                    <dt>创建时间</dt>
                    <dd>{device.createdAt ? time(device.createdAt) : '未记录'}</dd>
                  </div>
                  <div>
                    <dt>最近验证</dt>
                    <dd>{device.lastSeenAt ? time(device.lastSeenAt) : '未记录'}</dd>
                  </div>
                  <div>
                    <dt>到期时间</dt>
                    <dd>{time(device.expiresAt)}</dd>
                  </div>
                </dl>
              </div>
              <button
                type="button"
                className="session-device-revoke"
                aria-label={`撤销${deviceName(device)}${device.current ? '（当前设备）' : ''}`}
                disabled={devices.busy || devices.currentRevoked}
                onClick={() => {
                  setNotice('');
                  setAttempted(false);
                  setConfirmation({ kind: 'one', device });
                }}
              >
                撤销
              </button>
            </article>
          ))}
        </div>
        {!!others.length && !devices.currentRevoked && (
          <button
            className="session-devices-revoke-others"
            type="button"
            disabled={devices.busy}
            onClick={() => {
              setNotice('');
              setAttempted(false);
              setConfirmation({ kind: 'others', ids: others.map((item) => item.id).sort() });
            }}
          >
            撤销其它 {others.length} 个设备
          </button>
        )}
        <p className="session-devices-footnote">
          每项代表一次登录会话，设备名称仅供辨认；“最近验证”不代表每次使用时间。旧会话可能没有完整记录。
        </p>
      </div>
      {confirmation && (
        <ActionDialog
          title={
            confirmation.kind === 'others'
              ? `撤销其它 ${confirmation.ids.length} 个设备？`
              : `撤销${deviceName(confirmation.device)}？`
          }
          confirmLabel={
            confirmation.kind === 'one' && confirmation.device.current
              ? '撤销并退出此设备'
              : '确认撤销'
          }
          busy={devices.busy}
          danger
          onClose={() => setConfirmation(null)}
          onConfirm={() => void confirm()}
        >
          {confirmation.kind === 'one' ? (
            <p>
              将撤销 {deviceName(confirmation.device)}（会话 {confirmation.device.id.slice(-8)}
              ）的登录权限。
              {confirmation.device.current
                ? '这是当前设备，成功后将重新验证登录状态。'
                : '该设备需要重新登录才能继续访问账号。'}
            </p>
          ) : (
            <p>
              将撤销当前列表中的其它 {confirmation.ids.length}{' '}
              个登录设备，保留当前设备。它们需要重新登录才能继续访问账号。
            </p>
          )}
          <PlatformError message={attempted ? devices.mutationError : ''} />
        </ActionDialog>
      )}
    </section>
  );
}
