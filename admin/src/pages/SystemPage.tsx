import {
  Check,
  CircleDot,
  Database,
  ExternalLink,
  RefreshCw,
  Server,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { SystemInfo } from '../types';
import { frontendUrl } from '../config';
import { useResource } from '../use-resource';
import { Badge, ErrorState, Loading, Notice, PageHeading } from '../ui';

const capabilityLabels: Record<string, string> = {
  'http-only-sessions': '安全账号会话',
  'device-session-revocation': '登录设备与远程撤销',
  'community-posts': '社区动态与互动',
  'moderation-audit': '内容审核与操作审计',
  'member-conversations': '私聊、群组与频道',
  'mutual-friendships': '好友申请与双向关系',
  'conversation-membership-management': '会话成员与所有者管理',
  'cursor-message-history': '稳定消息历史与已读水位',
  'domain-sql-messaging': '按域 SQL 消息查询与写入',
  'transactional-websocket-outbox': '实时消息与断线重放',
  'revisioned-personal-documents': '个人备份与版本冲突保护',
  'atomic-test-ledger': '原子测试积分账本',
  'request-idempotency': '重复请求去重',
  'private-image-storage': '私有图片存储与权限读取',
  'reviewed-image-posts': '托管图片投稿审核',
  'media-moderation': '图片屏蔽与引用联动处置',
  'server-circles': '服务器圈子社区',
  'circle-role-permissions': '圈主、管理员与成员权限',
  'hashed-circle-invitations': '限次限时邀请与加入审批',
  'circle-moderation': '圈子治理与圈帖审核',
  'scoped-circle-media': '绑定圈子的私有图片',
  'account-notifications': '账号站内通知收件箱',
  'transactional-notification-events': '业务与通知原子提交',
  'permission-aware-notifications': '按当前权限显示通知内容',
  'bounded-read-all': '截至列表快照的批量已读',
  'circle-events': '圈内活动与报名管理',
  'domain-sql-events': '活动按域查询与事务写入',
  'event-waitlists': '限额报名与顺序候补递补',
  'event-registration-receipts': '报名回执去重与取消保护',
  'circle-event-moderation': '独立活动治理与审计',
  'wallet-identity': '本人钱包绑定与身份管理',
  'siwe-eoa-authentication': 'EOA 钱包签名登录',
  'browser-auth-cas': '浏览器认证版本与并发保护',
  'wallet-session-revocation': '解绑钱包与来源会话撤销',
};

function uptime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '未知';
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return days
    ? `${days} 天 ${hours} 小时`
    : hours
      ? `${hours} 小时 ${minutes} 分钟`
      : `${minutes} 分钟`;
}

export default function SystemPage() {
  const { data, loading, error, reload } = useResource<SystemInfo>('/admin/system');
  const health = useResource<Record<string, unknown>>('/health');
  const refresh = () => {
    reload();
    health.reload();
  };
  const environmentLabel =
    data?.environment === 'production'
      ? '生产环境'
      : data?.environment === 'development'
        ? '开发环境'
        : data?.environment || '未知';

  return (
    <>
      <PageHeading
        eyebrow="INFRASTRUCTURE"
        title="系统状态"
        description="检查运行环境与服务能力，清楚区分真实功能与实验边界。"
        actions={
          <button className="button" disabled={loading || health.loading} onClick={refresh}>
            <RefreshCw size={16} />
            重新检查
          </button>
        }
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        data && (
          <>
            <div className="system-grid">
              <section className="panel system-card">
                <span className="system-icon">
                  <Server size={21} />
                </span>
                <p>Go API</p>
                <h2>{health.loading ? '检查中' : health.error ? '健康检查失败' : '服务可达'}</h2>
                <Badge tone={health.loading ? 'neutral' : health.error ? 'danger' : 'good'}>
                  {health.loading ? '正在检查' : health.error ? '需要关注' : '已响应'}
                </Badge>
                <small>版本 {data.version || '未提供'}</small>
              </section>
              <section className="panel system-card">
                <span className="system-icon purple">
                  <Database size={21} />
                </span>
                <p>数据存储</p>
                <h2>{data.storage || '未提供'}</h2>
                <small>以服务端返回的存储类型为准</small>
              </section>
              <section className="panel system-card">
                <span className="system-icon lime">
                  <CircleDot size={21} />
                </span>
                <p>运行时长</p>
                <h2>{uptime(data.uptimeSeconds)}</h2>
                <Badge tone={data.environment === 'production' ? 'good' : 'warning'}>
                  {environmentLabel}
                </Badge>
                <small>从当前 API 进程启动开始计算</small>
              </section>
            </div>
            {health.error && <Notice>{health.error}</Notice>}
            <div className="system-columns">
              <section className="panel capabilities-panel">
                <header className="panel-heading">
                  <div>
                    <h2>已启用服务能力</h2>
                    <p>直接读取当前 API 的能力列表</p>
                  </div>
                  <ShieldCheck size={20} />
                </header>
                {data.features.length ? (
                  <ul className="capability-list">
                    {data.features.map((feature) => (
                      <li key={feature}>
                        <span className="capability-check">
                          <Check size={14} />
                        </span>
                        <span>{capabilityLabels[feature] || feature}</span>
                        <Badge tone="good">已启用</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="panel-copy">服务端未提供能力列表。</p>
                )}
              </section>
              <section className="panel boundaries-panel">
                <header className="panel-heading">
                  <div>
                    <h2>环境与实验边界</h2>
                    <p>上线前必须独立完成配置与验收</p>
                  </div>
                  <Wallet size={20} />
                </header>
                <div className="boundary-item">
                  <strong>Web3 测试账本</strong>
                  <p>
                    测试 GEM
                    仅用于验证领取与转账流程，没有真实资产价值。工作台不会索取助记词或私钥。
                  </p>
                </div>
                <div className="boundary-item">
                  <strong>开发示例账号</strong>
                  <p>默认凭据只用于本地体验。生产部署必须关闭种子数据、使用独立密钥和数据库。</p>
                </div>
                {data.features.includes('wallet-identity') && (
                  <div className="boundary-item">
                    <strong>钱包身份与资产分开</strong>
                    <p>
                      本人可在前台使用密码管理 EOA
                      钱包绑定，签名登录不创建账号，也不代表持有平台资产。工作台只展示能力与安全审计，不代绑、代签或转移他人钱包；合约钱包与密码重设尚未接入。
                    </p>
                  </div>
                )}
                {data.features.includes('private-image-storage') && (
                  <div className="boundary-item">
                    <strong>私有图片已接通</strong>
                    <p>
                      JPEG / PNG 通过真实 API 上传到私有目录并按权限读取。托管图片投稿需审核；
                      屏蔽图片会同时隐藏已发布的引用帖子，恢复图片不会自动恢复帖子。
                    </p>
                  </div>
                )}
                <div className="boundary-item">
                  <strong>真实接入逐项验收</strong>
                  <p>
                    AI、支付、链上交易和外部内容服务需配置各自服务并验证后开放，不能把界面演示当作线上能力。
                  </p>
                </div>
              </section>
            </div>
            <section className="panel environment-details">
              <header className="panel-heading">
                <div>
                  <h2>本地服务入口</h2>
                  <p>开发环境下的独立应用与 API</p>
                </div>
              </header>
              <div className="service-links">
                <a href={frontendUrl} target="_blank" rel="noopener noreferrer">
                  <span>
                    <strong>共鸣前台</strong>
                    <small>React / Vite / TypeScript</small>
                  </span>
                  <span className="mono">:5173</span>
                  <ExternalLink size={16} />
                </a>
                <a href="/api/v1/health" target="_blank" rel="noopener noreferrer">
                  <span>
                    <strong>API 健康检查</strong>
                    <small>当前同源代理</small>
                  </span>
                  <span className="mono">/api/v1/health</span>
                  <ExternalLink size={16} />
                </a>
              </div>
            </section>
          </>
        )
      )}
    </>
  );
}
