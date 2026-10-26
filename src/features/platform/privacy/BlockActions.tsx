import { useEffect, useRef, useState } from 'react';
import { ShieldBan, ShieldCheck } from 'lucide-react';
import type { PublicUser } from '@/shared/api/types';
import { apiErrorMessage } from '@/shared/api/client';
import ActionDialog from '@/shared/ui/ActionDialog';
import { PlatformError } from '../PlatformUi';
import { useAuth } from '../useAuth';
import { useContactScope } from './contact-scope';
import { privacyApi } from './privacy-api';
import {
  privacyReadEpoch,
  reconcilePrivacyOperation,
  retryPrivacyOperation,
  runPrivacyOperation,
} from './operation-registry';
import { usePrivacyOperation } from './usePrivacyOperation';
import './privacy-blocks.css';

export function BlockOperationNotice({ scope }: { scope: string }) {
  const operation = usePrivacyOperation(scope);
  return (
    <>
      {operation.phase === 'pending' && (
        <p role="status" className="privacy-block-hint">
          正在核实或保存隐私操作…
        </p>
      )}
      {operation.phase === 'unknown' && (
        <div className="privacy-operation-notice" role="status">
          <p>上次隐私操作的结果尚未确认。核实前不能执行相反操作。</p>
          <button type="button" onClick={() => void reconcilePrivacyOperation(scope)}>
            核实上次操作
          </button>
          {operation.checked && (
            <button type="button" onClick={() => void retryPrivacyOperation(scope)}>
              重试原操作
            </button>
          )}
        </div>
      )}
      <PlatformError message={operation.error} />
    </>
  );
}

export default function BlockActions({
  userId,
  person,
  showOperationStatus = true,
}: {
  userId: string;
  person?: PublicUser | null;
  showOperationStatus?: boolean;
}) {
  const auth = useAuth(),
    { scope } = useContactScope();
  if (auth.status !== 'authenticated' || !auth.user || auth.user.id === userId) return null;
  return (
    <TargetBlockActions
      key={`${scope}:${userId}`}
      scope={scope}
      userId={userId}
      person={person}
      showOperationStatus={showOperationStatus}
    />
  );
}
function TargetBlockActions({
  scope,
  userId,
  person,
  showOperationStatus,
}: {
  scope: string;
  userId: string;
  person?: PublicUser | null;
  showOperationStatus: boolean;
}) {
  const { valid } = useContactScope(),
    guard = useRef(valid);
  guard.current = valid;
  const operation = usePrivacyOperation(scope);
  const [snapshot, setSnapshot] = useState<{ blocked: boolean; revision: number } | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [confirmation, setConfirmation] = useState(false),
    [refresh, setRefresh] = useState(0);
  const readEpoch = privacyReadEpoch(scope);
  useEffect(() => {
    const request = new AbortController(),
      epoch = privacyReadEpoch(scope);
    if (operation.phase !== 'idle') {
      setConfirmation(false);
      return;
    }
    setLoading(true);
    setError('');
    setSnapshot(null);
    void privacyApi
      .blocks({ userId, limit: 1, offset: 0 }, request.signal)
      .then((result) => {
        if (request.signal.aborted || !guard.current() || privacyReadEpoch(scope) !== epoch) return;
        setSnapshot({
          blocked: result.items.some((item) => item.userId === userId),
          revision: result.revision,
        });
      })
      .catch((caught) => {
        if (!request.signal.aborted && guard.current() && privacyReadEpoch(scope) === epoch)
          setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!request.signal.aborted && guard.current() && privacyReadEpoch(scope) === epoch)
          setLoading(false);
      });
    return () => request.abort();
  }, [scope, userId, refresh, readEpoch, operation.phase]);
  useEffect(() => {
    const changed = () => {
      setConfirmation(false);
      setRefresh((value) => value + 1);
    };
    window.addEventListener('gongming:privacy-changed', changed);
    const visible = () => {
      if (!document.hidden) changed();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('gongming:privacy-changed', changed);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  const blocked = snapshot?.blocked ?? false;
  const label = person?.name || `账号 ${userId}`;
  return (
    <section className="privacy-block-actions" aria-label={`管理${label}的拉黑状态`}>
      <button
        type="button"
        className={blocked ? 'privacy-unblock-button' : 'privacy-block-button'}
        disabled={loading || !snapshot || operation.phase !== 'idle'}
        onClick={() => setConfirmation(true)}
      >
        {blocked ? <ShieldCheck size={16} /> : <ShieldBan size={16} />}
        {loading ? '读取拉黑状态…' : blocked ? '解除拉黑' : '加入黑名单'}
      </button>
      <PlatformError
        message={error}
        retry={error ? () => setRefresh((value) => value + 1) : undefined}
      />
      {showOperationStatus && <BlockOperationNotice scope={scope} />}
      {confirmation && snapshot && operation.phase === 'idle' && (
        <ActionDialog
          title={blocked ? '解除对此人的拉黑？' : '将此人加入黑名单？'}
          confirmLabel={blocked ? '确认解除拉黑' : '确认加入黑名单'}
          danger={!blocked}
          onClose={() => setConfirmation(false)}
          onConfirm={() => {
            if (!guard.current()) return;
            const revision = snapshot.revision;
            setConfirmation(false);
            void runPrivacyOperation(scope, { kind: 'block', userId, blocked: !blocked, revision });
          }}
        >
          <p className="privacy-confirm-target">
            <strong>{label}</strong>
            {person?.handle && <span>@{person.handle}</span>}
            <small>{userId}</small>
          </p>
          <p>
            {blocked
              ? '解除后，能否发起新私聊或邀请仍由双方当前设置决定。已取消的申请、已移除的好友不会恢复。'
              : '双方将不能发送新私信或私聊图片、发起或接受好友申请，也不能邀请对方成为群组或频道的新成员。已有好友关系保留，双方待处理申请会取消。'}
          </p>
          <p>历史消息和图片保留；共同群组、频道、圈子及公开互动仍按原有权限进行。</p>
        </ActionDialog>
      )}
    </section>
  );
}
