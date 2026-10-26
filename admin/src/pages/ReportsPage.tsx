import { useState } from 'react';
import { ArrowUpRight, Eye, Flag, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { api, errorMessage, queryString } from '../api';
import { dateTime, number, reportStatusLabels } from '../format';
import type { Page, Report, ReportStatus } from '../types';
import { PAGE_SIZE, useListParams } from '../use-list-params';
import { useResource } from '../use-resource';
import {
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

const targetLabels: Record<Report['targetType'], string> = {
  post: '社区内容',
  user: '用户账号',
  'circle-post': '圈内帖子',
  'circle-event': '圈内活动',
};
const targetPages: Record<Report['targetType'], string> = {
  post: '/content',
  user: '/users',
  'circle-post': '/circles/posts',
  'circle-event': '/circles/events',
};
const targetLabel = (type: Report['targetType']) =>
  Object.hasOwn(targetLabels, type) ? targetLabels[type] : '未知对象';

function ReportDetail({
  report,
  onClose,
  onSaved,
}: {
  report: Report;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<'resolved' | 'dismissed'>('resolved');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const targetPage = Object.hasOwn(targetPages, report.targetType)
    ? targetPages[report.targetType]
    : '';
  const targetPath = targetPage
    ? `${targetPage}?q=${encodeURIComponent(report.targetId)}&detail=${encodeURIComponent(report.targetId)}`
    : '';
  const save = async () => {
    if (busy || !note.trim() || report.status !== 'open') return;
    setBusy(true);
    setError('');
    try {
      await api<Report>(`/admin/reports/${encodeURIComponent(report.id)}`, {
        method: 'PATCH',
        body: { status, note: note.trim() },
      });
      onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="举报工单" description={`工单 ID · ${report.id}`} onClose={onClose} busy={busy}>
      <div className="report-detail-top">
        <Badge
          tone={
            report.status === 'open' ? 'warning' : report.status === 'resolved' ? 'good' : 'neutral'
          }
        >
          {reportStatusLabels[report.status]}
        </Badge>
        <span className="muted">{dateTime(report.createdAt)}</span>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>举报对象</dt>
          <dd>{targetLabel(report.targetType)}</dd>
        </div>
        <div>
          <dt>对象 ID</dt>
          <dd className="mono break-all">{report.targetId}</dd>
        </div>
        <div>
          <dt>举报人 ID</dt>
          <dd className="mono break-all">{report.reporterId}</dd>
        </div>
        <div>
          <dt>举报原因</dt>
          <dd className="pre-wrap">{report.reason}</dd>
        </div>
      </dl>
      {targetPath && (
        <Link className="button review-target" to={targetPath}>
          查看被举报{targetLabel(report.targetType)} <ArrowUpRight size={16} />
        </Link>
      )}
      <div className="section-separator" />
      {report.status !== 'open' ? (
        <>
          <h3>处理结论</h3>
          <p className="report-note">{report.note || '未填写说明'}</p>
          <div className="form-actions">
            <button className="button" onClick={onClose}>
              关闭工单
            </button>
          </div>
        </>
      ) : (
        <>
          <Notice tone="info">
            工单结论不会自动隐藏内容或停用账号。需要调整时，请先查看对象并单独完成审核。
          </Notice>
          <label className="field">
            处理结果
            <select
              value={status}
              disabled={confirming}
              onChange={(event) => setStatus(event.target.value as 'resolved' | 'dismissed')}
            >
              <option value="resolved">已处理 · 举报有效或已采取措施</option>
              <option value="dismissed">驳回 · 未发现违规依据</option>
            </select>
          </label>
          <label className="field">
            处理说明 <span className="required">必填</span>
            <textarea
              value={note}
              disabled={confirming}
              placeholder="记录你核实的情况、依据，以及已经采取的措施。"
              maxLength={1000}
              rows={4}
              onChange={(event) => setNote(event.target.value)}
            />
            <small className="character-count">{note.length} / 1000</small>
          </label>
          {confirming ? (
            <ConfirmAction
              title="确认处理结论"
              description={`将工单标记为「${reportStatusLabels[status]}」。说明会与工单和审计记录一起保存。`}
              confirmLabel="确认提交结论"
              busy={busy}
              error={error}
              onConfirm={() => void save()}
              onCancel={() => {
                setConfirming(false);
                setError('');
              }}
            />
          ) : (
            <div className="form-actions">
              <button className="button button-quiet" onClick={onClose}>
                稍后处理
              </button>
              <button
                className="button button-primary"
                disabled={!note.trim()}
                onClick={() => setConfirming(true)}
              >
                检查处理结论
              </button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

export default function ReportsPage() {
  const { q, status, offset, detail, update } = useListParams();
  const { data, loading, error, reload } = useResource<Page<Report>>(
    `/admin/reports${queryString({ q, status, offset, limit: PAGE_SIZE })}`,
  );
  const [notice, setNotice] = useState('');
  const selected = data?.items.find((report) => report.id === detail);
  const tabs: { value: ReportStatus | ''; label: string }[] = [
    { value: '', label: '全部工单' },
    { value: 'open', label: '待处理' },
    { value: 'resolved', label: '已处理' },
    { value: 'dismissed', label: '已驳回' },
  ];

  return (
    <>
      <PageHeading
        eyebrow="TRUST & SAFETY"
        title="举报中心"
        description="核实事实，记录依据，让每一个社区反馈得到妥善回应。"
        actions={
          <button className="button" onClick={reload} disabled={loading}>
            <RefreshCw size={16} />
            刷新
          </button>
        }
      />
      {notice && (
        <Notice tone="success" onDismiss={() => setNotice('')}>
          {notice}
        </Notice>
      )}
      <section className="panel">
        <div className="report-tabs" role="group" aria-label="工单状态">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              className={status === tab.value ? 'selected' : ''}
              aria-pressed={status === tab.value}
              onClick={() => update('status', tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="list-toolbar">
          <SearchForm
            value={q}
            placeholder="搜索举报原因或对象 ID"
            onSearch={(value) => update('q', value)}
          />
          {data && <span className="toolbar-count">共 {number(data.total)} 条工单</span>}
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          data && (
            <>
              {data.items.length ? (
                <div className="table-scroll">
                  <table>
                    <caption className="sr-only">举报工单列表</caption>
                    <thead>
                      <tr>
                        <th>举报原因</th>
                        <th>举报对象</th>
                        <th>状态</th>
                        <th>提交时间</th>
                        <th className="align-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((report) => (
                        <tr key={report.id}>
                          <td>
                            <div className="report-reason">
                              <span className="report-flag">
                                <Flag size={16} />
                              </span>
                              <div>
                                <strong>{report.reason}</strong>
                                <small className="mono">{report.id}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="stacked-cell">
                              <span>{targetLabel(report.targetType)}</span>
                              <small className="mono">{report.targetId}</small>
                            </div>
                          </td>
                          <td>
                            <Badge
                              tone={
                                report.status === 'open'
                                  ? 'warning'
                                  : report.status === 'resolved'
                                    ? 'good'
                                    : 'neutral'
                              }
                            >
                              {reportStatusLabels[report.status]}
                            </Badge>
                          </td>
                          <td className="muted nowrap">{dateTime(report.createdAt)}</td>
                          <td className="align-right">
                            <button
                              className="row-button"
                              onClick={() => update('detail', report.id)}
                              aria-label={`查看举报 ${report.id}`}
                            >
                              <Eye size={15} />
                              {report.status === 'open' ? '处理' : '详情'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title={status === 'open' ? '待处理工单已清空' : '暂无符合条件的工单'}
                  description={
                    status === 'open'
                      ? '新的社区举报会及时显示在这里。'
                      : '试试其他搜索词或状态筛选。'
                  }
                  icon={<Flag size={25} />}
                />
              )}
              <Pagination
                total={data.total}
                offset={offset}
                count={data.items.length}
                limit={PAGE_SIZE}
                onChange={(value) => update('offset', String(value))}
              />
            </>
          )
        )}
      </section>
      {selected && (
        <ReportDetail
          key={selected.id + selected.status}
          report={selected}
          onClose={() => update('detail', '')}
          onSaved={() => {
            setNotice('处理结论与说明已保存。');
            update('detail', '');
            reload();
          }}
        />
      )}
      {detail && data && !selected && !loading && (
        <Dialog title="未找到工单" onClose={() => update('detail', '')}>
          <Empty
            title="这条工单不在当前列表"
            description="工单可能已被其他运营人员处理，关闭详情并刷新列表后重试。"
          />
        </Dialog>
      )}
    </>
  );
}
