import { useId, useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  FileText,
  Flag,
  MessageCircle,
  RefreshCw,
  Users,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router';
import type { Overview } from '../types';
import { actionLabel, dateTime, detailText, number } from '../format';
import { useResource } from '../use-resource';
import { Badge, Empty, ErrorState, Loading, PageHeading } from '../ui';

function ActivityChart({ series }: { series: Overview['series'] }) {
  const gradient = useId().replace(/:/g, '');
  const [metric, setMetric] = useState<'messages' | 'posts' | 'users'>('messages');
  const [showTable, setShowTable] = useState(false);
  const metrics = { messages: '消息', posts: '内容', users: '用户' };
  const max = Math.max(1, ...series.map((item) => item[metric]));
  const total = series.reduce((sum, item) => sum + item[metric], 0);
  const left = 45;
  const top = 20;
  const width = 630;
  const height = 180;
  const points = series.map((item, index) => ({
    x: left + (series.length === 1 ? width / 2 : (index * width) / (series.length - 1)),
    y: top + height - (item[metric] / max) * height,
    item,
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <section className="panel activity-panel">
      <header className="panel-heading">
        <div>
          <h2>社区活跃趋势</h2>
          <p>按 UTC 日统计的真实服务数据</p>
        </div>
        <div className="segmented" role="group" aria-label="趋势指标">
          {Object.entries(metrics).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={metric === key}
              className={metric === key ? 'selected' : ''}
              onClick={() => setMetric(key as typeof metric)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {series.length === 0 ? (
        <Empty title="还没有趋势数据" description="社区产生新活动后，这里会显示每日变化。" />
      ) : (
        <>
          <div className="chart-summary">
            <strong>{number(total)}</strong>
            <span>周期内{metrics[metric]}总量</span>
            <Badge tone="purple">{series.length} 天</Badge>
          </div>
          <div className="chart-wrap">
            <svg
              className="trend-chart"
              viewBox="0 0 710 242"
              role="img"
              aria-label={`${series.length} 天内${metrics[metric]}变化，总计 ${total}。可在下方展开数据明细。`}
            >
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7563e8" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#7563e8" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                <g key={fraction}>
                  <line
                    x1={left}
                    x2={left + width}
                    y1={top + height * fraction}
                    y2={top + height * fraction}
                    stroke="#e9ece5"
                    strokeDasharray="3 5"
                  />
                  <text
                    x={left - 10}
                    y={top + height * fraction + 4}
                    textAnchor="end"
                    className="chart-label"
                  >
                    {number(Math.round(max * (1 - fraction)))}
                  </text>
                </g>
              ))}
              <polygon
                points={`${points[0].x},${top + height} ${line} ${points[points.length - 1].x},${top + height}`}
                fill={`url(#${gradient})`}
              />
              <polyline
                fill="none"
                points={line}
                stroke="#7865e9"
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.map(({ x, y, item }, index) => (
                <g key={item.date}>
                  <circle cx={x} cy={y} r={4} fill="#7865e9" stroke="white" strokeWidth={2}>
                    <title>
                      {item.date}：{item[metric]} {metrics[metric]}
                    </title>
                  </circle>
                  {(series.length <= 10 ||
                    index % Math.ceil(series.length / 7) === 0 ||
                    index === series.length - 1) && (
                    <text x={x} y={231} textAnchor="middle" className="chart-label">
                      {item.date.slice(5, 10).replace('-', '.')}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
          <div className="chart-bottom">
            <span>
              <i />
              {metrics[metric]} · 每日新增
            </span>
            <button
              className="text-button"
              onClick={() => setShowTable(!showTable)}
              aria-expanded={showTable}
            >
              {showTable ? '收起明细' : '查看明细'} <ArrowDownRight size={14} />
            </button>
          </div>
          {showTable && (
            <div className="table-scroll">
              <table>
                <caption className="sr-only">每日活跃明细</caption>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>用户</th>
                    <th>内容</th>
                    <th>消息</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((item) => (
                    <tr key={item.date}>
                      <td>{item.date}</td>
                      <td>{number(item.users)}</td>
                      <td>{number(item.posts)}</td>
                      <td>{number(item.messages)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function OverviewPage() {
  const { data, loading, error, reload } = useResource<Overview>('/admin/overview');
  return (
    <>
      <PageHeading
        eyebrow="OVERVIEW"
        title="运营总览"
        description="掌握社区脉搏，把注意力放在值得处理的变化上。"
        actions={
          <button className="button" onClick={reload} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            刷新数据
          </button>
        }
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        data && (
          <>
            <div className="metric-grid">
              {[
                {
                  title: '社区用户',
                  value: data.users,
                  icon: Users,
                  sub: '已注册账号',
                  to: '/users',
                  accent: 'lime',
                },
                {
                  title: '社区内容',
                  value: data.posts,
                  icon: FileText,
                  sub: `已隐藏 ${number(data.hiddenPosts)} 篇`,
                  to: '/content',
                  accent: 'purple',
                },
                {
                  title: '有效会话用户',
                  value: data.dailyActive,
                  icon: Zap,
                  sub: `${number(data.conversations)} 个会话`,
                  to: '/system',
                  accent: 'blue',
                },
                {
                  title: '待处理举报',
                  value: data.pendingReports,
                  icon: Flag,
                  sub: `累计 ${number(data.reports)} 条举报`,
                  to: '/reports?status=open',
                  accent: 'amber',
                },
              ].map(({ title, value, icon: Icon, sub, to, accent }) => (
                <Link className={`metric-card metric-${accent}`} to={to} key={title}>
                  <div className="metric-top">
                    <span>{title}</span>
                    <span className="metric-icon">
                      <Icon size={18} />
                    </span>
                  </div>
                  <strong>{number(value)}</strong>
                  <div className="metric-bottom">
                    <span>{sub}</span>
                    <ArrowUpRight size={16} />
                  </div>
                </Link>
              ))}
            </div>
            <div className="overview-columns">
              <ActivityChart series={data.series} />
              <section className="panel attention-panel">
                <span className="attention-icon">
                  <ShieldGraphic />
                </span>
                <p className="eyebrow">COMMUNITY CARE</p>
                <h2>让好内容被看见</h2>
                <p className="attention-copy">按清楚、一致的标准审核，给每一次处理留下依据。</p>
                <Link to="/reports?status=open" className="attention-row">
                  <span>待处理举报</span>
                  <strong>{number(data.pendingReports)}</strong>
                  <ArrowRight size={16} />
                </Link>
                <Link to="/content?status=pending" className="attention-row">
                  <span>查看待审核内容</span>
                  <ArrowUpRight size={16} />
                </Link>
                <div className="attention-note">
                  <MessageCircle size={15} />
                  <span>处理举报与内容状态分别管理，避免误操作。</span>
                </div>
              </section>
            </div>
            <section className="panel">
              <header className="panel-heading">
                <div>
                  <h2>最近运营活动</h2>
                  <p>来自服务端的审计记录</p>
                </div>
                <Link className="text-link" to="/audit">
                  全部记录 <ArrowRight size={15} />
                </Link>
              </header>
              {data.recentActivity.length === 0 ? (
                <Empty
                  title="暂无运营操作"
                  description="第一次审核、账号变更或举报处理后，记录会出现在这里。"
                />
              ) : (
                <div className="table-scroll">
                  <table>
                    <caption className="sr-only">最近运营活动</caption>
                    <thead>
                      <tr>
                        <th>操作</th>
                        <th>操作人</th>
                        <th>变更说明</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentActivity.slice(0, 6).map((entry) => (
                        <tr key={entry.id}>
                          <td>
                            <span className="activity-cell">
                              <span className="activity-dot" />
                              {actionLabel(entry.action)}
                            </span>
                          </td>
                          <td>{entry.actorName}</td>
                          <td className="cell-truncate" title={detailText(entry.detail)}>
                            {detailText(entry.detail)}
                          </td>
                          <td className="muted nowrap">{dateTime(entry.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )
      )}
    </>
  );
}

function ShieldGraphic() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path
        d="M18 3L30 8V17C30 24 25 29 18 33C11 29 6 24 6 17V8L18 3Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M12 18L16 22L24 14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
