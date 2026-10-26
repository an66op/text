import { Activity, Eye, LockKeyhole, RefreshCw } from 'lucide-react';
import { queryString } from '../api';
import { actionLabel, dateTime, detailText, number } from '../format';
import type { Audit, Page } from '../types';
import { PAGE_SIZE, useListParams } from '../use-list-params';
import { useResource } from '../use-resource';
import {
  Badge,
  Dialog,
  Empty,
  ErrorState,
  Loading,
  PageHeading,
  Pagination,
  SearchForm,
} from '../ui';

export default function AuditPage() {
  const { q, offset, detail, update } = useListParams();
  const { data, loading, error, reload } = useResource<Page<Audit>>(
    `/admin/audit${queryString({ q, offset, limit: PAGE_SIZE })}`,
  );
  const selected = data?.items.find((entry) => entry.id === detail);

  return (
    <>
      <PageHeading
        eyebrow="AUDIT TRAIL"
        title="操作审计"
        description="按时间还原运营操作，确保每一次关键变更可追溯。"
        actions={
          <>
            <Badge>
              <LockKeyhole size={12} />
              只读记录
            </Badge>
            <button className="button" onClick={reload} disabled={loading}>
              <RefreshCw size={16} />
              刷新
            </button>
          </>
        }
      />
      <section className="panel">
        <div className="list-toolbar">
          <SearchForm
            value={q}
            placeholder="搜索操作人、动作或对象 ID"
            onSearch={(value) => update('q', value)}
          />
          {data && <span className="toolbar-count">{number(data.total)} 条记录</span>}
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
                    <caption className="sr-only">审计记录列表</caption>
                    <thead>
                      <tr>
                        <th>操作时间</th>
                        <th>操作人</th>
                        <th>操作</th>
                        <th>对象</th>
                        <th>变更摘要</th>
                        <th className="align-right">详情</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((entry) => (
                        <tr key={entry.id}>
                          <td className="nowrap">{dateTime(entry.createdAt)}</td>
                          <td>
                            <div className="stacked-cell">
                              <strong>{entry.actorName || '系统'}</strong>
                              <small className="mono">{entry.actorId || 'system'}</small>
                            </div>
                          </td>
                          <td>
                            <Badge tone="purple">{actionLabel(entry.action)}</Badge>
                          </td>
                          <td className="mono cell-id" title={entry.targetId}>
                            {entry.targetId || '—'}
                          </td>
                          <td className="cell-truncate" title={detailText(entry.detail)}>
                            {detailText(entry.detail)}
                          </td>
                          <td className="align-right">
                            <button
                              className="icon-button"
                              aria-label={`查看审计 ${entry.id}`}
                              onClick={() => update('detail', entry.id)}
                            >
                              <Eye size={17} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="暂无审计记录"
                  description="用户权限调整、内容审核和举报处理会由服务端自动写入。"
                  icon={<Activity size={25} />}
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
        <Dialog
          title="审计记录详情"
          description="记录由服务端产生，工作台无法编辑或删除。"
          onClose={() => update('detail', '')}
        >
          <dl className="detail-grid">
            <div>
              <dt>记录 ID</dt>
              <dd className="mono break-all">{selected.id}</dd>
            </div>
            <div>
              <dt>操作时间 · 中国标准时间</dt>
              <dd>{dateTime(selected.createdAt)}</dd>
            </div>
            <div>
              <dt>操作人</dt>
              <dd>
                {selected.actorName || '系统'}
                <small className="detail-secondary mono">{selected.actorId || 'system'}</small>
              </dd>
            </div>
            <div>
              <dt>动作</dt>
              <dd>
                {actionLabel(selected.action)}
                <small className="detail-secondary mono">{selected.action}</small>
              </dd>
            </div>
            <div>
              <dt>目标 ID</dt>
              <dd className="mono break-all">{selected.targetId || '—'}</dd>
            </div>
          </dl>
          <h3 className="audit-detail-heading">变更详情</h3>
          <pre className="audit-payload">{detailText(selected.detail)}</pre>
          <div className="form-actions">
            <button className="button" onClick={() => update('detail', '')}>
              关闭记录
            </button>
          </div>
        </Dialog>
      )}
      {detail && data && !selected && !loading && (
        <Dialog title="未找到记录" onClose={() => update('detail', '')}>
          <Empty title="这条记录不在当前列表" description="请关闭详情并重新搜索。" />
        </Dialog>
      )}
    </>
  );
}
