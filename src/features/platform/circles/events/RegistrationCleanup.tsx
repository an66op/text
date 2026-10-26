import { useEffect, useRef, useState } from 'react';
import ActionDialog from '@/shared/ui/ActionDialog';
import { PlatformError } from '../../PlatformUi';
import { useMutation } from '../useMutation';
import { eventsApi } from './api';
import { registrationLabel } from './model';
import type { EventWriteGate } from './useEventWriteGate';
export default function RegistrationCleanup({
  circleId,
  eventId,
  changed,
  writeGate,
}: {
  circleId: string;
  eventId: string;
  changed: () => void;
  writeGate: EventWriteGate;
}) {
  const mutation = useMutation(),
    releaseWrite = useRef<(() => void) | null>(null),
    clientId = useRef('');
  useEffect(
    () => () => {
      releaseWrite.current?.();
      releaseWrite.current = null;
    },
    [],
  );
  const [confirming, setConfirming] = useState(false),
    [notice, setNotice] = useState('');
  return (
    <details className="sce-cleanup">
      <summary>无法查看活动？清理本人登记</summary>
      <p>仅处理当前链接下本人的报名或候补，不读取活动详情和其他成员名单。</p>
      <button
        type="button"
        disabled={mutation.busy || writeGate.busy}
        onClick={() => setConfirming(true)}
      >
        取消本人的登记
      </button>
      {notice && <p role="status">{notice}</p>}
      <PlatformError message={mutation.error} />
      {confirming && (
        <ActionDialog
          title="取消本人的活动登记？"
          confirmLabel="确认清理本人登记"
          busy={mutation.busy || writeGate.busy}
          danger
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const release = writeGate.acquire();
            if (!release) return;
            releaseWrite.current = release;
            try {
              if (!clientId.current) clientId.current = crypto.randomUUID();
              const result = await mutation.run((signal) =>
                eventsApi.registration(circleId, eventId, 'leave', clientId.current, signal),
              );
              if (result?.ok) {
                clientId.current = '';
                setConfirming(false);
                setNotice(`服务器确认本人当前状态：${registrationLabel(result.registration)}。`);
                changed();
              }
            } finally {
              if (releaseWrite.current === release) releaseWrite.current = null;
              release();
            }
          }}
        >
          <p>
            活动标识 {eventId.slice(-8)}
            。这将释放本人确认名额或退出候补；不会恢复活动访问权。重新参加仍需满足当前资格和名额条件。
          </p>
          <PlatformError message={mutation.error} />
        </ActionDialog>
      )}
    </details>
  );
}
