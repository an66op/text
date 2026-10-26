# 共鸣 Go API

Go `net/http` + PostgreSQL 16 + `pgx/v5`。运行时必须连接 PostgreSQL，不提供内存降级。接口契约在 `../docs/API_CONTRACT.md`，全部路由以 `/api/v1` 开头。

## 本地运行

先在项目根目录启动隔离 PostgreSQL：

```sh
node scripts/database.mjs up
```

在本目录启动 API：

```sh
APP_ENV=development go run ./cmd/api
```

开发默认 DSN 为 `postgres://gongming:gongming_dev@127.0.0.1:55432/gongming?sslmode=disable`，监听 `127.0.0.1:8080`。数据库迁移和开发种子会自动初始化；已有账号时不覆盖已有业务数据。

| 开发账号 | 密码 | 角色 |
| --- | --- | --- |
| demo@gongming.local | Demo2026! | member |
| admin@gongming.local | Admin2026! | admin |

周野是可搜索的示例联系人 `@zhouye`，没有公开登录密码。种子包含动态、评论、私聊、群组、公告频道和待审核举报，方便前后台联动。测试钱包初始余额为零，登录后领取测试积分。

健康检查与登录示例：

```sh
curl http://localhost:8080/api/v1/health
curl -c /tmp/gongming-cookies.txt \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@gongming.local","password":"Demo2026!"}' \
  http://localhost:8080/api/v1/auth/login
curl -b /tmp/gongming-cookies.txt http://localhost:8080/api/v1/conversations
```

Vite 前台 5173 / 管理后台 5174 代理 `/api` 到 8080，同源 cookie 自动携带。`localhost` 与 `127.0.0.1` 的浏览器 cookie 各自隔离，请在联调时使用同一主机名。

## 配置

| 变量 | 规则 |
| --- | --- |
| APP_ENV | 默认 `production`；本地明确设 `development` 才允许开发默认值、种子账号及非 Secure cookie |
| DATABASE_URL | 生产必填；开发可使用上述隔离 DSN |
| API_ADDR | 默认 `127.0.0.1:8080`，容器部署可显式设 `:8080` |
| ALLOWED_ORIGINS | 逗号分隔精确源，生产必填且必须 HTTPS；开发默认允许 localhost/127.0.0.1 的 5173、5174 |
| COOKIE_SECURE | 生产必须为 `true`；开发默认 `false`，允许本地 HTTP |
| BOOTSTRAP_ADMIN_EMAIL | 仅空数据库可初始化管理员；无需 bootstrap 时保持未设置 |
| BOOTSTRAP_ADMIN_PASSWORD | Bootstrap 需 16–72 字节独立密码；不接受开发默认密码 |
| BOOTSTRAP_ADMIN_HANDLE | Bootstrap 管理员用户名；3–30 位，小写字母开头，可包含数字和下划线 |

生产环境拒绝已包含开发种子用户的数据库。使用独立数据库和 HTTPS 反向代理；不要把开发 DSN、示例密码当成生产配置。生产启动不注册任何默认账号。

## 安全和一致性

- 密码 bcrypt，运行 cost=12；会话为密码学随机 token，数据库只保存 SHA-256 摘要。Cookie 为 HttpOnly / SameSite=Lax / 生产 Secure，7 天过期；登出撤销，封禁会撤销该账号全部会话。
- 写请求必须携带允许的 Origin，同时拒绝 Sec-Fetch-Site: cross-site。JSON 仅允许已知字段和一个对象，请求体最多 1MiB。服务器头/读取/写入/空闲超时分别为 5/15/20/60 秒，数据库请求上下文 12 秒。
- 来源 IP 限流不信任客户端 X-Forwarded-For。全局 600 次/分钟；登录 15 次/15 分钟；注册 6 次/小时。生产多实例需要网关/Redis 分布式限流，再按已配置可信代理解析真实 IP。
- 任意注册只能得到 member。moderator 可读运营信息、审核动态和处理举报；用户角色/封禁仅 admin 可修改。不能降级/停用自己或移除最后一名活跃管理员。所有运营写操作与审计在同一事务提交。
- 公共动态仅返回 published；隐藏内容仅作者和运营人员可读。私聊/群组/频道严格按成员列表授权，管理员不绕过会话读取权限。频道发布限频道主或已加入的 admin。
- 资料同步按账号隔离，revision 冲突返回 409 `revision_conflict`。白名单：`preferences`、`drafts`、`reading`、`bookshelf`、`bookmarks`、`ai-history`、`content-preferences`、`circles-preferences`、`matching-preferences`、`profile-preferences`；单个 value 最多 128KiB。订单、钱包和共享动态不通过客户端 JSON 同步。
- GEM 是测试积分，decimals=2，金额接口是最小单位十进制整数字符串。水龙头每 24 小时一次 1000 GEM，转账同事务双边记账。requestId 在每账号的所有钱包写操作中唯一：重复同请求返回原始钱包快照，改变参数复用 ID 返回 409。失败不扣款。重试后若要获取最新余额使用 GET /wallet。

## 查询规则

列表返回 `{items,total}`，默认 limit=30，范围 1–100，offset 为非负整数且最多 100000。`q` 搜索不区分大小写。动态 `topic` 精确匹配。后台 users 支持 status/role，posts 和 reports 支持 status；这些枚举参数非法返回 400。

消息列表默认取最近 limit 条，并按时间升序返回；offset 表示从最新消息起跳过多少条，可用于向上加载更早历史。目录以及动态/评论的 author、消息的 sender 均仅返回 id/handle/name/avatar/bio，不包含邮箱、角色或密码；auth/me 和运营用户管理保留完整 User。

## 数据存储与演进边界

第一版将域模型持久化于 `gongming_app_state` 单行 JSONB。所有写入用数据库事务 + `SELECT ... FOR UPDATE`，覆盖多连接并发；revision 与 updated_at 由数据库同步更新。读取不修改持久状态。该设计让整个社交、账号、审核和账本在当前端到端产品中保持真实、可验证的持久性与原子性。

它会串行化全部写请求，不是大流量的最终数据库布局。扩容前应将 accounts/sessions、posts/comments/likes、conversations/members/messages、documents、reports/audits、wallets/ledger/idempotency 拆为规范化表，加入唯一约束、外键、索引、游标分页及分域事务；钱包需要不可变复式分录/总账平衡校验，消息需要 WebSocket/outbox 和投递确认；媒体上传需要对象存储及内容审核。迁移需保留现有实体 ID、权限不变量和幂等键，并用集成测试验证并发转账与审计一致性。

当前数据保留全部审计与账本，钱包 API 仅展示最近 100 条。需在量产前配置备份恢复演练、归档/保留策略、可观测性及请求级审计追踪。没有真实资产接入、链上签名认证、链上交易、支付清算、邮件验证或找回密码；不要将测试钱包描述为可托管资产的钱包。

## 验证

需要 Go 1.27.3+，go.mod 已指定该最低版本；原有 Go 命令在默认 GOTOOLCHAIN=auto 下自动下载官方项目工具链，无需替换系统安装。部署时使用受支持的最新安全补丁版本。依赖锁定在 go.mod / go.sum。

```sh
go test -race ./...
go vet ./...
GOTOOLCHAIN=go1.27.3 go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
TEST_DATABASE_URL='postgres://gongming:gongming_dev@127.0.0.1:55432/gongming?sslmode=disable' go test -race ./...
```

测试覆盖会话摘要/过期/撤销、Origin/body/限流、隐藏动态、幂等点赞、频道发布权限、成员读取隔离、目录字段隐私、revision 冲突、管理员限制、封禁撤销会话、审核+审计原子性、账本幂等与并发余额守恒。真实 PostgreSQL 集成测试创建独立临时 schema，再连接两个 pool 验证持久性、并发事务和失败回滚；测试结束清理 schema，不修改应用 schema。未提供 TEST_DATABASE_URL/DATABASE_URL 时此项明确跳过，不表示已验证 PostgreSQL。

实现参考：[Go net/http](https://pkg.go.dev/net/http)、[pgxpool](https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool)、[bcrypt](https://pkg.go.dev/golang.org/x/crypto/bcrypt)。
