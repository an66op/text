import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import { useAuth } from '../useAuth';
import { LoginNotice, PlatformError } from '../PlatformUi';
import SettingsSwitch from '@/features/profile/SettingsSwitch';
import { useContactScope } from './contact-scope';
import { contactPrivacyFields, privacyApi } from './privacy-api';
import {
  privacyReadEpoch,
  reconcilePrivacyOperation,
  retryPrivacyOperation,
  runPrivacyOperation,
} from './operation-registry';
import { usePrivacyOperation } from './usePrivacyOperation';
import type { ContactPrivacy, ContactPrivacyFields } from './types';
import './privacy.css';

export default function PrivacySettingsForm() {
  const auth = useAuth(),
    { scope } = useContactScope();
  return (
    <div className="settings-page">
      <PageHeader title="隐私权限" backTo="/settings" />
      {auth.status === 'checking' ? (
        <p className="privacy-empty" role="status">
          正在验证账号…
        </p>
      ) : auth.status === 'unavailable' ? (
        <div className="settings-content">
          <PlatformError
            message={auth.error || '账号服务暂不可达'}
            retry={() => void auth.refresh()}
          />
        </div>
      ) : auth.user ? (
        <PrivacyForm key={scope} />
      ) : (
        <div className="settings-content">
          <LoginNotice returnTo="/settings/privacy" />
        </div>
      )}
    </div>
  );
}
function PrivacyForm() {
  const { scope, valid } = useContactScope(),
    operation = usePrivacyOperation(scope);
  const [baseline, setBaseline] = useState<ContactPrivacy | null>(null),
    [draft, setDraft] = useState<ContactPrivacyFields | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [version, setVersion] = useState(0);
  const dirty = useRef(false),
    draftRevision = useRef<number | null>(null),
    rebaseNextRead = useRef(false),
    generation = useRef(0),
    observed = useRef(operation.result);
  useEffect(() => {
    const controller = new AbortController(),
      epoch = ++generation.current,
      privateEpoch = privacyReadEpoch(scope);
    const rebase = rebaseNextRead.current;
    rebaseNextRead.current = false;
    setLoading(true);
    setError('');
    void privacyApi
      .get(controller.signal)
      .then((result) => {
        if (
          controller.signal.aborted ||
          !valid() ||
          epoch !== generation.current ||
          privateEpoch !== privacyReadEpoch(scope)
        )
          return;
        setBaseline(result);
        if (!dirty.current) {
          setDraft(contactPrivacyFields(result));
          draftRevision.current = result.revision;
        } else if (rebase) draftRevision.current = result.revision;
        else if (result.revision !== draftRevision.current)
          setNotice('服务器设置已更新。你的选择仍保留，请刷新核实后再保存。');
      })
      .catch((caught) => {
        if (
          !controller.signal.aborted &&
          valid() &&
          epoch === generation.current &&
          !isAbort(caught)
        )
          setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted && valid() && epoch === generation.current)
          setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, version]);
  useEffect(() => {
    if (operation.result !== observed.current) {
      observed.current = operation.result;
      if (
        operation.result &&
        'directMessagePolicy' in operation.result &&
        draft &&
        JSON.stringify(contactPrivacyFields(operation.result)) ===
          JSON.stringify(contactPrivacyFields(draft))
      ) {
        draftRevision.current = operation.result.revision;
        dirty.current = false;
        setBaseline(operation.result);
      }
      generation.current++;
      setVersion((value) => value + 1);
    }
  }, [operation.result, draft]);
  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    const visible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  const update = <K extends keyof ContactPrivacyFields>(key: K, value: ContactPrivacyFields[K]) => {
    dirty.current = true;
    setNotice('');
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };
  const locked = operation.phase !== 'idle';
  const refresh = () => {
    rebaseNextRead.current = true;
    setVersion((value) => value + 1);
    setNotice('已重新读取服务器状态；未保存的选择仍保留，请核实后保存。');
  };
  return (
    <div className="settings-content privacy-server-form">
      <PlatformError
        message={error || operation.error}
        retry={
          operation.phase === 'unknown' ? () => void reconcilePrivacyOperation(scope) : refresh
        }
      />
      {loading && !baseline && (
        <p role="status" className="privacy-empty">
          正在读取隐私权限…
        </p>
      )}
      {operation.phase === 'unknown' && (
        <div className="privacy-unknown" role="status">
          <p>上次操作结果待确认，确认前暂不能提交其他隐私或黑名单修改。</p>
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
      {draft && baseline && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (locked || loading || !valid()) return;
            const value = contactPrivacyFields(draft);
            generation.current++;
            const result = await runPrivacyOperation(scope, {
              kind: 'privacy',
              value,
              revision: draftRevision.current ?? baseline.revision,
            });
            if (!valid()) return;
            if (result && 'directMessagePolicy' in result) {
              dirty.current = false;
              draftRevision.current = result.revision;
              setBaseline(result);
              setDraft(contactPrivacyFields(result));
              setNotice('隐私权限已保存');
            }
          }}
        >
          <section className="settings-group">
            <h2>私人联系</h2>
            <div className="settings-card">
              {(
                [
                  ['directMessagePolicy', '谁可以给我发私信', '同时适用于已有私聊的新消息和图片'],
                  ['groupInvitePolicy', '谁可以邀请我入群', '群组和广播频道使用同一邀请设置'],
                ] as const
              ).map(([key, label, description]) => (
                <label key={key} className="settings-row">
                  <span className="settings-row-copy">
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  <select
                    aria-label={label}
                    value={draft[key]}
                    disabled={locked || loading}
                    onChange={(event) =>
                      update(key, event.target.value as ContactPrivacyFields[typeof key])
                    }
                  >
                    <option value="everyone">所有人</option>
                    <option value="friends">仅好友</option>
                    <option value="nobody">不允许</option>
                  </select>
                </label>
              ))}
              <SettingsSwitch
                label="允许新的好友申请"
                description="已有申请仍可处理；成为好友始终需要双方确认"
                checked={draft.allowFriendRequests}
                disabled={locked || loading}
                onChange={(value) => update('allowFriendRequests', value)}
              />
              <SettingsSwitch
                label="允许陌生人搜索我"
                description="影响成员目录和共鸣号查询，公开内容与历史参与记录仍按原权限可见"
                checked={draft.discoverableByHandle}
                disabled={locked || loading}
                onChange={(value) => update('discoverableByHandle', value)}
              />
            </div>
          </section>
          {dirty.current &&
            JSON.stringify(contactPrivacyFields(baseline)) !==
              JSON.stringify(contactPrivacyFields(draft)) && (
              <details className="privacy-current-snapshot">
                <summary>查看服务器当前设置</summary>
                <p>
                  私信：
                  {
                    { everyone: '所有人', friends: '仅好友', nobody: '不允许' }[
                      baseline.directMessagePolicy
                    ]
                  }
                  ；群组邀请：
                  {
                    { everyone: '所有人', friends: '仅好友', nobody: '不允许' }[
                      baseline.groupInvitePolicy
                    ]
                  }
                  ；新的好友申请：{baseline.allowFriendRequests ? '允许' : '不允许'}；陌生人搜索：
                  {baseline.discoverableByHandle ? '允许' : '不允许'}。
                </p>
                <p>表单保留的是你尚未保存的选择。</p>
              </details>
            )}
          <div className="privacy-form-actions">
            <button className="platform-primary" disabled={locked || loading} type="submit">
              {operation.phase === 'pending' ? '正在确认…' : '保存设置'}
            </button>
            <button type="button" disabled={locked || loading} onClick={refresh}>
              刷新
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p role="status" className="settings-success">
          {notice}
        </p>
      )}
      <section className="settings-group">
        <div className="settings-card">
          <Link className="settings-nav-row" to="/settings/blocked">
            <span className="settings-row-copy">
              <strong>黑名单</strong>
              <small>管理本人拉黑记录，历史消息和共同空间保持独立</small>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        </div>
      </section>
      <p className="settings-hint">当前账号设置由服务器保存。本机演示偏好不会导入。</p>
    </div>
  );
}
