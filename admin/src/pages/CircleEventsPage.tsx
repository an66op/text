import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CalendarDays, Eye, LockKeyhole, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { accountEpoch, expectedAccount } from '../../../src/shared/api/account-guard';
import { ApiError, errorMessage } from '../api';
import { circleEventsApi } from '../circle-events-api';
import {
  circleStatusLabels,
  dateTime,
  eventModerationLabels,
  eventPhaseLabels,
  number,
} from '../format';
import type { AdminCircleEvent, EventModeration, Page } from '../types';
import { PAGE_SIZE, useListParams } from '../use-list-params';
import { useResource } from '../use-resource';
import { useSession } from '../use-session';
import {
  Avatar,
  Badge,
  ConfirmAction,
  Dialog,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeading,
  Pagination,
  SearchForm,
} from '../ui';
import CircleGovernanceTabs from './CircleGovernanceTabs';

type EventDraft = { id: string; moderation: EventModeration; note: string };

function EventBadges({ event }: { event: AdminCircleEvent }) {
  return (
    <div className="event-governance-badges">
      <Badge tone={event.lifecycle === 'cancelled' ? 'neutral' : 'purple'}>
        {event.lifecycle === 'cancelled' ? '已取消' : eventPhaseLabels[event.phase]}
      </Badge>
      <Badge tone={event.moderation === 'hidden' ? 'danger' : 'good'}>
        {eventModerationLabels[event.moderation]}
      </Badge>
    </div>
  );
}

function EventDetail({
  event,
  draft,
  onDraft,
  onClose,
  onSaved,
  onRefresh,
  onDenied,
}: {
  event: AdminCircleEvent;
  draft: EventDraft;
  onDraft: (value: EventDraft) => void;
  onClose: () => void;
  onSaved: (value: AdminCircleEvent) => void;
  onRefresh: () => void;
  onDenied: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const mountedAccount = useRef(expectedAccount()).current;
  const mountedEpoch = useRef(accountEpoch()).current;
  const allowedRestore = draft.moderation !== 'visible' || event.circleStatus === 'active';
  const cancelled = event.lifecycle === 'cancelled';
  const accountCurrent = () =>
    active.current && mountedAccount === expectedAccount() && mountedEpoch === accountEpoch();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  const save = async () => {
    if (request.current || cancelled || !allowedRestore || !draft.note.trim()) return;
    if (!accountCurrent()) {
      if (active.current) onDenied('登录会话已变化，请重新验证并刷新活动记录。');
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const current = () => accountCurrent() && !controller.signal.aborted;
    setBusy(true);
    setError('');
    setConflict(false);
    try {
      const result = await circleEventsApi.govern(
        event.id,
        { moderation: draft.moderation, note: draft.note.trim(), revision: event.revision },
        controller.signal,
      );
      if (!current()) return;
      if (
        !result ||
        result.id !== event.id ||
        result.circleId !== event.circleId ||
        result.moderation !== draft.moderation ||
        !Number.isSafeInteger(result.revision) ||
        result.revision !== event.revision + 1 ||
        result.lifecycle !== event.lifecycle
      )
        throw new ApiError(
          '服务尚未确认新的活动版本，请刷新后核实处理结果。',
          0,
          'invalid_response',
        );
      onSaved(result);
    } catch (caught) {
      if (!current()) return;
      if (caught instanceof ApiError && [403, 404].includes(caught.status)) {
        onDenied(errorMessage(caught));
        return;
      }
      setError(errorMessage(caught));
      setConflict(caught instanceof ApiError && caught.status === 409);
    } finally {
      if (request.current === controller) request.current = null;
      if (current()) setBusy(false);
    }
  };
  return (
    <Dialog
      title="活动审核详情"
      description={`活动 ID · ${event.id}`}
      busy={busy}
      onClose={onClose}
      wide
    >
      <Notice tone="info">
        当前通过平台独立审核权限读取活动，包括私密圈子内容。运营身份不会加入圈子；此处只展示报名统计，不读取成员名单或报名收据。
      </Notice>
      <div className="circle-detail-title">
        <span className="circle-icon">
          <CalendarDays size={23} />
        </span>
        <div>
          <h3>{event.title}</h3>
          <p>{event.mode === 'online' ? '线上活动' : '线下活动'}</p>
        </div>
      </div>
      <EventBadges event={event} />
      <p className="post-body">{event.description}</p>
      <dl className="detail-grid">
        <div>
          <dt>所属圈子</dt>
          <dd>
            <Link
              to={`/circles?q=${encodeURIComponent(event.circleId)}&detail=${encodeURIComponent(event.circleId)}`}
            >
              {event.circleName} <ArrowUpRight size={12} />
            </Link>
          </dd>
        </div>
        <div>
          <dt>圈子状态</dt>
          <dd>{circleStatusLabels[event.circleStatus]}</dd>
        </div>
        <div>
          <dt>开始时间 · 上海时区</dt>
          <dd>{dateTime(event.startsAt)}</dd>
        </div>
        <div>
          <dt>结束时间 · 上海时区</dt>
          <dd>{dateTime(event.endsAt)}</dd>
        </div>
        <div>
          <dt>报名截止 · 上海时区</dt>
          <dd>{dateTime(event.registrationClosesAt)}</dd>
        </div>
        <div>
          <dt>地点 / 参与方式</dt>
          <dd className="pre-wrap break-all">{event.location}</dd>
        </div>
        <div>
          <dt>报名统计</dt>
          <dd>
            已确认 {number(event.registeredCount)} / {number(event.capacity)} 人 · 候补{' '}
            {number(event.waitlistedCount)} 人
          </dd>
        </div>
        <div>
          <dt>当前报名窗口</dt>
          <dd>{event.registrationOpen ? '服务端当前允许报名' : '服务端当前不开放报名'}</dd>
        </div>
        <div>
          <dt>创建者</dt>
          <dd>
            <div className="user-cell compact">
              <Avatar name={event.creator.name} src={event.creator.avatar} />
              <div>
                <strong>{event.creator.name}</strong>
                <small>@{event.creator.handle}</small>
              </div>
            </div>
          </dd>
        </div>
        <div>
          <dt>当前版本</dt>
          <dd>revision {event.revision}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{dateTime(event.createdAt)}</dd>
        </div>
        <div>
          <dt>最近更新</dt>
          <dd>{dateTime(event.updatedAt)}</dd>
        </div>
      </dl>
      <Link className="text-link" to={`/audit?q=${encodeURIComponent(event.id)}`}>
        查看活动审计 <ArrowUpRight size={14} />
      </Link>
      <div className="circle-previous-note">
        <h3>最近平台处理说明</h3>
        <p>{event.moderationNote || '尚无平台处理说明'}</p>
      </div>
      <div className="section-separator" />
      {cancelled ? (
        <>
          <Notice tone="info">
            活动已取消，生命周期终态只读。平台不能恢复、重新开放报名或改变已取消登记。
          </Notice>
          <div className="form-actions">
            <button className="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </>
      ) : (
        <>
          <Notice tone="info">
            屏蔽保留确认与候补记录。恢复要求圈子正常，保留已确认登记；未截止的有效候补可按顺序递补。已结束活动仅恢复历史阅读，不恢复已取消登记，也不重开报名窗口。
          </Notice>
          <label className="field">
            平台可见性
            <select
              value={draft.moderation}
              disabled={confirming || busy}
              onChange={(event) =>
                onDraft({ ...draft, moderation: event.target.value as EventModeration })
              }
            >
              <option value="visible" disabled={event.circleStatus !== 'active'}>
                圈内可见 · 按当前成员权限阅读
              </option>
              <option value="hidden">平台屏蔽 · 普通成员不可见</option>
            </select>
          </label>
          {!allowedRestore && (
            <Notice tone="info">
              所属圈子已暂停或归档，不能保存为圈内可见。可选择平台屏蔽并记录处理说明。
            </Notice>
          )}
          <label className="field">
            处理说明 <span className="required">必填</span>
            <textarea
              value={draft.note}
              rows={4}
              maxLength={1000}
              disabled={confirming || busy}
              placeholder="记录核实依据、屏蔽或恢复原因。"
              onChange={(event) => onDraft({ ...draft, note: event.target.value })}
            />
            <small className="character-count">{draft.note.length} / 1000</small>
          </label>
          <p className="field-hint">
            同状态也可补充说明，每次提交均推进版本并记录审计。平台操作不修改活动生命周期和报名窗口。
          </p>
          {confirming ? (
            <ConfirmAction
              title="确认活动治理"
              description={`活动「${event.title}」（${event.id}），位于「${event.circleName}」，版本 ${event.revision}；从「${eventModerationLabels[event.moderation]}」保存为「${eventModerationLabels[draft.moderation]}」。${draft.moderation === 'hidden' ? '普通成员将不能读取此活动；圈管理与平台审核可按权限查看，保留已有确认与候补记录。' : '恢复当前成员的历史或活动阅读权限，保留已确认登记；未截止的有效候补可按顺序递补，不恢复已取消登记或已取消活动，不延长报名截止，截止后不再接受报名。'}处理说明会保存并记录审计。`}
              confirmLabel="确认保存活动治理"
              danger={draft.moderation === 'hidden'}
              busy={busy}
              error={error}
              onConfirm={() => void save()}
              onCancel={() => {
                setConfirming(false);
                setError('');
                setConflict(false);
              }}
            />
          ) : (
            <div className="form-actions">
              <button className="button button-quiet" onClick={onClose}>
                关闭
              </button>
              <button
                className="button button-primary"
                disabled={!draft.note.trim() || !allowedRestore || busy}
                onClick={() => setConfirming(true)}
              >
                检查活动处理结果
              </button>
            </div>
          )}
          {conflict && (
            <div className="event-governance-conflict">
              <p>活动版本或状态已变化。说明与选择会保留；刷新后请核对最新记录，再确认提交。</p>
              <button className="button" disabled={busy} onClick={onRefresh}>
                <RefreshCw size={15} />
                刷新活动记录
              </button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

function EventRecords({
  path,
  detail,
  offset,
  draft,
  onDraft,
  update,
  reload,
  onSaved,
  onDenied,
}: {
  path: string;
  detail: string;
  offset: number;
  draft: EventDraft | null;
  onDraft: (value: EventDraft) => void;
  update: (key: string, value: string) => void;
  reload: () => void;
  onSaved: (value: AdminCircleEvent) => void;
  onDenied: (message: string) => void;
}) {
  const { data, loading, error } = useResource<Page<AdminCircleEvent>>(path);
  const mountedAccount = useRef(expectedAccount()).current;
  const mountedEpoch = useRef(accountEpoch()).current;
  const selected = data?.items.find((event) => event.id === detail);
  if (mountedAccount !== expectedAccount() || mountedEpoch !== accountEpoch())
    return <ErrorState message="登录会话已变化，请重新验证并刷新活动记录。" onRetry={reload} />;
  if (loading) return <Loading label="正在读取活动治理记录…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <>
      <div className="list-summary">
        <span>圈内活动平台审核记录</span>
        <span>{number(data.total)} 场活动</span>
      </div>
      {data.items.length ? (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">活动审核列表</caption>
            <thead>
              <tr>
                <th>活动</th>
                <th>所属圈子</th>
                <th>时间与报名</th>
                <th>活动 / 平台状态</th>
                <th>创建者</th>
                <th className="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((event) => (
                <tr key={event.id}>
                  <td>
                    <div className="post-preview">
                      <span className="post-placeholder">
                        <CalendarDays size={19} />
                      </span>
                      <div>
                        <strong>{event.title}</strong>
                        <small className="mono">{event.id}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="stacked-cell">
                      <span>{event.circleName}</span>
                      <small>
                        {circleStatusLabels[event.circleStatus]} ·{' '}
                        {event.mode === 'online' ? '线上' : '线下'}
                      </small>
                    </div>
                  </td>
                  <td>
                    <div className="stacked-cell">
                      <span>{dateTime(event.startsAt)}</span>
                      <small>
                        确认 {number(event.registeredCount)} / {number(event.capacity)} · 候补{' '}
                        {number(event.waitlistedCount)}
                      </small>
                    </div>
                  </td>
                  <td>
                    <EventBadges event={event} />
                  </td>
                  <td>
                    <div className="user-cell compact">
                      <Avatar name={event.creator.name} src={event.creator.avatar} />
                      <div>
                        <strong>{event.creator.name}</strong>
                        <small>@{event.creator.handle}</small>
                      </div>
                    </div>
                  </td>
                  <td className="align-right">
                    <button
                      className="row-button"
                      onClick={() => update('detail', event.id)}
                      aria-label={`审核活动 ${event.title}`}
                    >
                      <Eye size={15} />
                      {event.lifecycle === 'cancelled' ? '详情' : '审核'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon={<CalendarDays size={25} />}
          description="没有符合条件的活动，可调整圈子、生命周期或平台可见性。"
        />
      )}
      <Pagination
        total={data.total}
        offset={offset}
        count={data.items.length}
        limit={PAGE_SIZE}
        onChange={(value) => update('offset', String(value))}
      />
      {selected && (
        <EventDetail
          key={selected.id}
          event={selected}
          draft={
            draft?.id === selected.id
              ? draft
              : { id: selected.id, moderation: selected.moderation, note: '' }
          }
          onDraft={onDraft}
          onClose={() => update('detail', '')}
          onSaved={onSaved}
          onRefresh={reload}
          onDenied={onDenied}
        />
      )}
      {detail && !selected && (
        <Dialog title="未找到活动" onClose={() => update('detail', '')}>
          <Empty
            title="此活动不在当前列表"
            description="活动可能已变更或被筛选隐藏，请关闭详情并调整筛选或刷新。"
          />
        </Dialog>
      )}
    </>
  );
}

function EventsWorkspace({ path }: { path: string }) {
  const { q, offset, detail, update } = useListParams();
  const [params] = useSearchParams();
  const circleId = params.get('circleId') || '';
  const lifecycle = params.get('lifecycle') || '';
  const moderation = params.get('moderation') || '';
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [notice, setNotice] = useState('');
  const [denied, setDenied] = useState('');
  const reload = () => {
    setDenied('');
    setRevision((value) => value + 1);
  };
  return (
    <>
      <PageHeading
        eyebrow="CIRCLE EVENTS"
        title="活动审核"
        description="独立核实圈内活动，记录平台可见性处置依据。"
        actions={
          <button className="button" onClick={reload}>
            <RefreshCw size={16} />
            刷新
          </button>
        }
      />
      <CircleGovernanceTabs />
      <Notice tone="info">
        <LockKeyhole size={14} />{' '}
        平台审核包含私密圈子活动，不授予普通圈内成员权限。此处仅显示聚合人数，不提供名单、报名收据或联系方式。
      </Notice>
      {notice && (
        <Notice tone="success" onDismiss={() => setNotice('')}>
          {notice}
        </Notice>
      )}
      <section className="panel">
        <div className="list-toolbar event-governance-toolbar">
          <SearchForm
            value={q}
            placeholder="搜索活动标题、ID、圈名或创建者标识"
            onSearch={(value) => update('q', value)}
          />
          <label className="single-filter">
            生命周期
            <select
              aria-label="筛选活动生命周期"
              value={lifecycle}
              onChange={(event) => update('lifecycle', event.target.value)}
            >
              <option value="">全部生命周期</option>
              <option value="published">已发布</option>
              <option value="cancelled">已取消</option>
            </select>
          </label>
          <label className="single-filter">
            平台可见性
            <select
              aria-label="筛选活动平台可见性"
              value={moderation}
              onChange={(event) => update('moderation', event.target.value)}
            >
              <option value="">全部可见性</option>
              <option value="visible">圈内可见</option>
              <option value="hidden">平台屏蔽</option>
            </select>
          </label>
        </div>
        <form
          className="circle-id-filter"
          onSubmit={(event) => {
            event.preventDefault();
            update(
              'circleId',
              String(new FormData(event.currentTarget).get('circleId') || '').trim(),
            );
          }}
        >
          <label>
            圈子 ID
            <input
              key={circleId}
              name="circleId"
              aria-label="筛选活动所属圈子 ID"
              defaultValue={circleId}
              placeholder="输入圈子 ID，可留空查看全部"
              maxLength={80}
            />
          </label>
          <button className="button" type="submit">
            筛选圈子
          </button>
          {circleId && (
            <button className="text-link" type="button" onClick={() => update('circleId', '')}>
              清除圈子筛选
            </button>
          )}
        </form>
        {denied ? (
          <ErrorState message={denied} onRetry={reload} />
        ) : (
          <EventRecords
            key={revision}
            path={path}
            detail={detail}
            offset={offset}
            draft={draft}
            onDraft={setDraft}
            update={update}
            reload={reload}
            onSaved={(event) => {
              setNotice(
                `活动已保存为「${eventModerationLabels[event.moderation]}」，版本 ${event.revision}，说明已记录审计。`,
              );
              setDraft(null);
              update('detail', '');
              reload();
            }}
            onDenied={(message) => {
              setNotice('');
              setDraft(null);
              setDenied(message);
            }}
          />
        )}
      </section>
    </>
  );
}

export default function CircleEventsPage() {
  const { session } = useSession();
  const { q, offset } = useListParams();
  const [params] = useSearchParams();
  if (!session || !['admin', 'moderator'].includes(session.user.role))
    return <Notice>当前账号没有活动治理权限，请重新验证运营会话。</Notice>;
  const path = circleEventsApi.listPath({
    circleId: params.get('circleId') || '',
    lifecycle: params.get('lifecycle') || '',
    moderation: params.get('moderation') || '',
    q,
    offset,
    limit: PAGE_SIZE,
  });
  return (
    <EventsWorkspace
      key={`${session.user.id}:${session.expiresAt}:${session.user.role}:${session.user.status}:${accountEpoch()}:${path}`}
      path={path}
    />
  );
}
