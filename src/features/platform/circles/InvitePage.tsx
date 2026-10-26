import { useEffect, useRef, useState } from 'react';
import ActionDialog from '@/shared/ui/ActionDialog';
import { PlatformError } from '../PlatformUi';
import { shortTime } from '../platform-format';
import CirclePage from './CirclePage';
import { circlesApi } from './api';
import { useCircle } from './circle-context';
import { circlePaths } from './paths';
import type { CreatedInvite, Invite } from './types';
import { useMutation } from './useMutation';
import { useResource } from './useResource';
import { Empty, Pagination } from './Ui';
export default function InvitePage() {
  return (
    <CirclePage title="邀请" manager>
      <Invites />
    </CirclePage>
  );
}
function Invites() {
  const { circle, deny } = useCircle();
  const [hours, setHours] = useState(72),
    [maxUses, setMaxUses] = useState(20),
    [created, setCreated] = useState<CreatedInvite | null>(null),
    [revoking, setRevoking] = useState<Invite | null>(null),
    [page, setPage] = useState(0),
    [copyNotice, setCopyNotice] = useState('');
  const active = useRef(true),
    tokenInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const list = useResource(
      `${circle.id}:${page}`,
      (signal) => circlesApi.invites(circle.id, signal, page * 20),
      deny,
    ),
    mutation = useMutation(deny);
  const invitation = created
    ? new URL(
        `${circlePaths.join(circle.id)}#invite=${encodeURIComponent(created.token)}`,
        window.location.origin,
      ).href
    : '';
  const now = Date.now();
  return (
    <>
      <p className="sc-muted">
        邀请只展示一次完整凭证，请妥善分享。列表不会返回凭证，撤销或到期后无法继续兑换；已经提交的申请仍需圈方审核。
      </p>
      {circle.status === 'active' ? (
        <form
          className="sc-form sc-card"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await mutation.run((signal) =>
              circlesApi.createInvite(circle.id, { expiresInHours: hours, maxUses }, signal),
            );
            if (result) {
              setCreated(result);
              setCopyNotice('');
              list.refresh();
            }
          }}
        >
          <div className="sc-form-pair">
            <label>
              有效小时
              <input
                type="number"
                min={1}
                max={168}
                required
                value={hours}
                disabled={mutation.busy}
                onChange={(event) => setHours(Number(event.target.value))}
              />
            </label>
            <label>
              最多使用次数
              <input
                type="number"
                min={1}
                max={100}
                required
                value={maxUses}
                disabled={mutation.busy}
                onChange={(event) => setMaxUses(Number(event.target.value))}
              />
            </label>
          </div>
          <button
            className="sc-primary"
            disabled={
              mutation.busy ||
              !Number.isInteger(hours) ||
              !Number.isInteger(maxUses) ||
              hours < 1 ||
              hours > 168 ||
              maxUses < 1 ||
              maxUses > 100
            }
          >
            创建邀请
          </button>
        </form>
      ) : (
        <p className="sc-notice">当前圈子不能创建或撤销邀请。</p>
      )}
      <PlatformError message={mutation.error || list.error} retry={list.refresh} />
      {created &&
        !list.data?.items.find((item) => item.id === created.id)?.revoked &&
        new Date(created.expiresAt).getTime() > now && (
          <section className="sc-card">
            <h2>本次邀请链接</h2>
            <textarea
              ref={tokenInput}
              className="sc-invite-url"
              aria-label="圈子邀请链接"
              readOnly
              value={invitation}
              rows={3}
            />
            <p className="sc-muted">
              到期 {shortTime(created.expiresAt)} · 最多 {created.maxUses} 次
            </p>
            <button
              type="button"
              className="sc-secondary"
              onClick={async () => {
                try {
                  if (!navigator.clipboard?.writeText) throw new Error('无法使用剪贴板');
                  await navigator.clipboard.writeText(invitation);
                  if (active.current) setCopyNotice('邀请链接已复制');
                } catch {
                  if (active.current) {
                    tokenInput.current?.focus();
                    tokenInput.current?.select();
                    setCopyNotice('请长按链接复制，或使用系统复制快捷键');
                  }
                }
              }}
            >
              复制邀请链接
            </button>
            {copyNotice && (
              <p role="status" className="sc-success">
                {copyNotice}
              </p>
            )}
          </section>
        )}
      <div className="sc-section-heading">
        <h2>邀请记录</h2>
        <button type="button" onClick={list.refresh}>
          刷新
        </button>
      </div>
      {list.loading ? (
        <Empty>正在读取邀请…</Empty>
      ) : list.data?.items.length ? (
        list.data.items.map((invite) => {
          const expired = new Date(invite.expiresAt).getTime() <= now;
          return (
            <article className="sc-request-card" key={invite.id}>
              <strong>邀请 {invite.id.slice(-8)}</strong>
              <p>
                {invite.revoked
                  ? '已撤销'
                  : expired
                    ? '已过期'
                    : invite.uses >= invite.maxUses
                      ? '次数已用完'
                      : '可使用'}{' '}
                · {invite.uses}/{invite.maxUses} 次
              </p>
              <small>到期 {shortTime(invite.expiresAt)}</small>
              {!invite.revoked && circle.status === 'active' && (
                <button type="button" disabled={mutation.busy} onClick={() => setRevoking(invite)}>
                  撤销邀请
                </button>
              )}
            </article>
          );
        })
      ) : (
        !list.error && <Empty>还没有创建邀请。</Empty>
      )}
      <Pagination
        page={page}
        total={list.data?.total ?? 0}
        onPage={setPage}
        disabled={list.loading}
      />
      {revoking && (
        <ActionDialog
          title="撤销这个邀请？"
          confirmLabel="确认撤销"
          busy={mutation.busy}
          danger
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            if (
              (
                await mutation.run((signal) =>
                  circlesApi.revokeInvite(circle.id, revoking.id, signal),
                )
              )?.ok
            ) {
              if (created?.id === revoking.id) setCreated(null);
              setRevoking(null);
              list.refresh();
            }
          }}
        >
          <p>
            邀请 {revoking.id.slice(-8)}{' '}
            将停止接受新的兑换。已经加入的成员和已提交申请不会自动撤回。
          </p>
          <PlatformError message={mutation.error} />
        </ActionDialog>
      )}
    </>
  );
}
