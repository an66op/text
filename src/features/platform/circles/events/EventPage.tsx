import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '@/shared/api/client';
import ActionDialog from '@/shared/ui/ActionDialog';
import { PlatformAvatar, PlatformError } from '../../PlatformUi';
import { useAuth } from '../../useAuth';
import CirclePage from '../CirclePage';
import { useCircle } from '../circle-context';
import { circlePaths } from '../paths';
import { isManager } from '../types';
import { useMutation } from '../useMutation';
import { useResource } from '../useResource';
import { Empty } from '../Ui';
import { eventsApi } from './api';
import { EventFacts, EventStatus, RegistrationState } from './EventUi';
import { eventTime, registrationLabel, timeZone } from './model';
import type { CircleEvent, RegistrationIntent } from './types';
import RegistrationCleanup from './RegistrationCleanup';
import { useEventWriteGate, type EventWriteGate } from './useEventWriteGate';

export default function EventPage() {
  const auth = useAuth(),
    { circleId = '', eventId = '' } = useParams();
  return (
    <EventSession
      key={`${auth.user?.id ?? 'guest'}:${auth.expiresAt}:${circleId}:${eventId}`}
      circleId={circleId}
      eventId={eventId}
    />
  );
}
function EventSession({ circleId, eventId }: { circleId: string; eventId: string }) {
  const auth = useAuth();
  const [cleanupRevision, setCleanupRevision] = useState(0);
  const writeGate = useEventWriteGate();
  return (
    <>
      <CirclePage title="活动">
        <EventDetail cleanupRevision={cleanupRevision} writeGate={writeGate} />
      </CirclePage>
      {auth.status === 'authenticated' && auth.user && (
        <RegistrationCleanup
          circleId={circleId}
          eventId={eventId}
          changed={() => setCleanupRevision((value) => value + 1)}
          writeGate={writeGate}
        />
      )}
    </>
  );
}
type Decision = { kind: 'cancel' | 'leave'; signature: string };
const signature = (value: CircleEvent) =>
  `${value.revision}:${value.phase}:${value.lifecycle}:${value.moderation}:${value.myRegistration?.status}:${value.myRegistration?.updatedAt}`;
function EventDetail({
  cleanupRevision,
  writeGate,
}: {
  cleanupRevision: number;
  writeGate: EventWriteGate;
}) {
  const { circle, deny } = useCircle(),
    { eventId = '' } = useParams();
  const detail = useResource(
      eventId,
      (signal) => eventsApi.detail(circle.id, eventId, signal),
      deny,
    ),
    mutation = useMutation(deny);
  const [decision, setDecision] = useState<Decision | null>(null),
    [reporting, setReporting] = useState(false),
    [reason, setReason] = useState(''),
    [notice, setNotice] = useState('');
  const pending = useRef<{ intent: RegistrationIntent; clientId: string } | null>(null),
    releaseWrite = useRef<(() => void) | null>(null),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      releaseWrite.current?.();
      releaseWrite.current = null;
    };
  }, []);
  const value = detail.data;
  const lastCleanupRevision = useRef(cleanupRevision);
  const { refresh } = detail;
  useEffect(() => {
    if (lastCleanupRevision.current !== cleanupRevision) {
      lastCleanupRevision.current = cleanupRevision;
      refresh();
    }
  }, [cleanupRevision, refresh]);
  useEffect(() => {
    if (decision && value && !mutation.busy && decision.signature !== signature(value)) {
      setDecision(null);
      setNotice('活动或本人登记状态已变化，请重新确认。');
    }
  }, [decision, value, mutation.busy]);
  if (!value)
    return (
      <>
        <PlatformError message={detail.error} retry={detail.refresh} />
        {detail.loading && <Empty>正在读取活动…</Empty>}
      </>
    );
  const registered = value.myRegistration?.status === 'registered',
    waitlisted = value.myRegistration?.status === 'waitlisted',
    manager = isManager(circle);
  const canJoin =
    circle.status === 'active' &&
    value.registrationOpen &&
    value.lifecycle === 'published' &&
    value.moderation === 'visible' &&
    !registered &&
    !waitlisted;
  const canLeave =
    (registered || waitlisted) && value.phase !== 'ended' && value.lifecycle !== 'cancelled';
  const canCancel =
    manager &&
    circle.status === 'active' &&
    value.lifecycle !== 'cancelled' &&
    value.phase !== 'ended';
  const register = async (intent: RegistrationIntent) => {
    if (mutation.busy) return;
    const release = writeGate.acquire();
    if (!release) return;
    releaseWrite.current = release;
    try {
      if (!pending.current || pending.current.intent !== intent)
        pending.current = { intent, clientId: crypto.randomUUID() };
      const clientId = pending.current.clientId;
      let refreshAfterFailure = false;
      const result = await mutation.run(async (signal) => {
        try {
          return await eventsApi.registration(circle.id, eventId, intent, clientId, signal);
        } catch (error) {
          refreshAfterFailure =
            error instanceof ApiError && (error.status === 409 || error.code === 'TIMEOUT');
          throw error;
        }
      });
      if (!active.current) return;
      if (result?.ok) {
        pending.current = null;
        setDecision(null);
        detail.refresh();
        setNotice(
          result.registration?.status === 'registered'
            ? '报名已确认，正在更新活动名额。'
            : result.registration?.status === 'waitlisted'
              ? '已加入候补；截止前有名额时会按顺序自动递补。'
              : `服务器确认：${registrationLabel(result.registration)}。`,
        );
      } else if (refreshAfterFailure) detail.refresh();
    } finally {
      if (releaseWrite.current === release) releaseWrite.current = null;
      release();
    }
  };
  return (
    <>
      <div className="sce-detail-top">
        <EventStatus value={value} />
        <button className="sc-text-button" type="button" onClick={detail.refresh}>
          刷新
        </button>
      </div>
      <h1 className="sce-title">{value.title}</h1>
      {value.moderation === 'hidden' && (
        <p className="sc-notice">
          平台已隐藏此活动，仅当前圈管理可查看。编辑或取消不会恢复可见性。
        </p>
      )}
      <EventFacts value={value} />
      <p className="sc-muted">
        时区：{timeZone()} · 报名截止 {eventTime(value.registrationClosesAt)}
      </p>
      <section className="sce-registration" aria-label="本人报名">
        <RegistrationState value={value.myRegistration} />
        {canJoin &&
          (value.registeredCount >= value.capacity ? (
            <>
              <button
                className="sc-primary"
                disabled={mutation.busy || writeGate.busy}
                onClick={() => void register('waitlist')}
              >
                加入候补 · 同意自动递补
              </button>
              <p className="sc-muted">
                已满额。若请求时已有空位将直接确认；候补仅在截止前按顺序自动递补。
              </p>
            </>
          ) : (
            <button
              className="sc-primary"
              disabled={mutation.busy || writeGate.busy}
              onClick={() => void register('join')}
            >
              报名参加
            </button>
          ))}
        {canLeave && (
          <button
            type="button"
            className="sc-secondary"
            disabled={mutation.busy || writeGate.busy}
            onClick={() => setDecision({ kind: 'leave', signature: signature(value) })}
          >
            {waitlisted ? '取消候补' : '取消报名'}
          </button>
        )}
        {!value.registrationOpen && !registered && !waitlisted && (
          <p className="sc-muted">当前不接受新报名，以服务器状态为准。</p>
        )}
      </section>
      <PlatformError message={mutation.error || detail.error} retry={detail.refresh} />
      {notice && (
        <p className="sc-success" role="status">
          {notice}
        </p>
      )}
      <section className="sce-description">
        <h2>活动介绍</h2>
        <p>{value.description}</p>
      </section>
      <div className="sce-creator">
        <PlatformAvatar user={value.creator} />
        <span>
          {value.creator.name}
          <small>活动创建者</small>
        </span>
      </div>
      {manager && (
        <nav className="sce-manager-links">
          <Link to={circlePaths.eventAttendees(circle.id, eventId)}>报名名单</Link>
          {circle.status === 'active' &&
            value.lifecycle === 'published' &&
            value.phase === 'upcoming' && (
              <Link to={circlePaths.eventEdit(circle.id, eventId)}>编辑活动</Link>
            )}
          {canCancel && (
            <button
              type="button"
              className="sc-danger"
              disabled={mutation.busy || writeGate.busy}
              onClick={() => setDecision({ kind: 'cancel', signature: signature(value) })}
            >
              取消活动
            </button>
          )}
        </nav>
      )}
      <button
        className="sc-text-button"
        type="button"
        disabled={mutation.busy}
        onClick={() => setReporting((open) => !open)}
      >
        举报活动
      </button>
      {reporting && (
        <form
          className="sc-form sce-report"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!reason.trim()) return;
            const result = await mutation.run((signal) =>
              eventsApi.report(circle.id, eventId, reason.trim(), signal),
            );
            if (result) {
              setReporting(false);
              setReason('');
              setNotice('举报已提交，等待平台处理。');
            }
          }}
        >
          <label>
            举报原因
            <textarea
              required
              maxLength={1000}
              rows={3}
              value={reason}
              disabled={mutation.busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button className="sc-primary" disabled={mutation.busy || !reason.trim()}>
            提交举报
          </button>
        </form>
      )}
      {decision && (
        <ActionDialog
          title={
            decision.kind === 'cancel'
              ? `取消「${value.title}」？`
              : `${waitlisted ? '取消候补' : '取消报名'}「${value.title}」？`
          }
          confirmLabel={
            decision.kind === 'cancel'
              ? '确认取消活动'
              : waitlisted
                ? '确认取消候补'
                : '确认取消报名'
          }
          busy={mutation.busy || writeGate.busy}
          danger
          onClose={() => setDecision(null)}
          onConfirm={async () => {
            if (decision.signature !== signature(value)) return;
            if (decision.kind === 'leave') {
              await register('leave');
              return;
            }
            const release = writeGate.acquire();
            if (!release) return;
            releaseWrite.current = release;
            try {
              const result = await mutation.run((signal) =>
                eventsApi.cancel(circle.id, eventId, value.revision, signal),
              );
              if (result) {
                setDecision(null);
                detail.replace(result);
                setNotice('活动已取消，报名与候补已释放；历史记录保留，不能重新开启。');
              }
            } finally {
              if (releaseWrite.current === release) releaseWrite.current = null;
              release();
            }
          }}
        >
          <p>
            {decision.kind === 'cancel'
              ? `服务器当前有 ${value.registeredCount} 位确认、${value.waitlistedCount} 位候补。取消将释放所有登记，保留历史，不能重新开启。`
              : waitlisted
                ? '将退出候补队列；之后重新候补需要从队尾开始，不保留当前顺位。'
                : '将释放你的确认名额。截止前可能自动递补给下一位候补，重新报名不保证有名额。'}
          </p>
          <PlatformError message={mutation.error} retry={detail.refresh} />
        </ActionDialog>
      )}
    </>
  );
}
