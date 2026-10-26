import type { StreamStatus } from './usePlatformStream';

const labels: Record<StreamStatus, string> = {
  connecting: '正在连接实时通讯',
  live: '实时连接',
  reconnecting: '实时重连中 · 轮询保底',
  polling: '轮询同步',
  offline: '网络已断开 · 消息待同步',
};

export default function ConnectionStatus({ status }: { status: StreamStatus }) {
  return (
    <span className={`platform-connection-status ${status}`} role="status">
      <i />
      {labels[status]}
    </span>
  );
}
