# 共鸣全栈 API 约定

前台 React / Vite / TypeScript（5173），运营后台 React / Vite / TypeScript（5174），Go API（8080），PostgreSQL（本地隔离实例 55432）。两套前端通过 Vite `/api` 代理调用服务，生产同源反向代理。

## 通用

- 前缀 `/api/v1`。成功 `{ "data": T }`；失败 `{ "error": { "code": "...", "message": "中文可读说明" } }`。
- 时间 RFC3339，ID 字符串。金额全部整数字符串，价格以分为单位；钱包仅测试账本。
- HttpOnly SameSite=Lax 会话 cookie；写请求校验 Origin，开发仅允许 5173/5174 的 localhost/127.0.0.1。密码 bcrypt，token 只存 SHA-256。管理员与成员强制角色授权。非登录/注册/查询会话请求可带 X-Gongming-Account，若与 cookie 身份不符则409 account_changed，防多标签页账号切换串写；该头不能授予权限。
- 列表统一 `{items: T[], total: number}`，支持 `q` / `limit` / `offset`（服务限制上限）。

## 账号

`User = {id, handle, name, email, avatar, bio, role: 'member'|'moderator'|'admin', status: 'active'|'suspended', createdAt}`。

- `POST /auth/register` `{email,password,name,handle}` → `{user,expiresAt}`。
- `POST /auth/login` `{email,password}` → `{user,expiresAt}`。
- `GET /auth/me` → `{user,expiresAt}`；`POST /auth/logout` → `{ok:true}`。
- `PATCH /me` `{name?,bio?,avatar?}` → User。
- 本地种子：成员 `demo@gongming.local` / `Demo2026!`；管理员 `admin@gongming.local` / `Admin2026!`。仅开发环境启用种子，生产禁止默认凭据。

## 全站社区

`PublicUser = {id,handle,name,avatar,bio}`，不包含邮箱或权限字段。

`Post = {id,author:PublicUser,body,images:string[],topic,status:'published'|'hidden'|'pending',createdAt,likeCount:number,liked:boolean,commentCount:number}`。
`Comment = {id,postId,author:PublicUser,body,createdAt}`。

- `GET /posts`（公开只返回 published，支持 topic / author用户名 精确筛选）→ 列表；`POST /posts` `{body,images?,topic?}` → Post。
- `GET /posts/{id}` → Post；`DELETE /posts/{id}` → `{ok:true}`（作者/管理员）。
- `POST /posts/{id}/like` `{liked:boolean}` → Post（幂等目标状态）。
- `GET /posts/{id}/comments` → Comment 列表；`POST ...` `{body}` → Comment。
- `POST /reports` `{targetType:'post'|'user',targetId,reason}` → Report。

## 通讯

`Conversation = {id,title,kind:'direct'|'group'|'channel',members:string[],ownerId,createdAt,lastMessage?:Message,unreadCount,readSeq,lastReadMessageId?}`。
`Message = {id,conversationId,sender:PublicUser,body,createdAt,seq:number,clientId?:string}`。

- `GET /conversations` → 用户已加入会话（附分页前 unreadTotal）；`POST /conversations` `{title,kind,memberIds:string[]}` → Conversation。
- `GET /conversations/{id}/messages` 支持 beforeSeq / afterSeq，兼容 beforeId；返回升序 items、total、hasMore、nextBeforeSeq / nextBeforeId。
- `POST /conversations/{id}/messages` `{body,clientId?}` → Message。clientId 按用户+会话去重，相同正文重复返回原消息、不同正文409；省略兼容旧客户端。仅成员可读写，频道仅频道主/已加入管理员可发布。
- `POST /conversations/{id}/read` `{messageId}` → `{conversationId,readSeq,lastReadMessageId,unreadCount}`。只能标记同会话现存消息，水位只前进。
- `GET /stream?after=eventId&account=userId` 升级 WebSocket。Cookie+精确Origin+成员鉴权；account可选，身份不符409。通知只含 type、eventId 和可选 conversationId/messageId；类型 ready / message.created / conversation.created / conversation.read / resync。通知不作为权威消息内容；客户端再GET。
- eventId 为十进制字符串的不透明游标。outbox事务提交后可推送、跨实例读取；最多保留2000事件/7天，过旧游标resync。每账号8连接、每实例256，15秒ping、30分钟重连，注销/封禁后关闭。
- `GET /directory` → 已登录成员目录 PublicUser 列表，支持 q/分页；`GET /users/{handle}` → active成员 PublicUser。

## 账号资料同步

- `GET /documents` → `{items: [{key,value:unknown,revision:number,updatedAt}],total}`。
- `PUT /documents/{key}` `{value:unknown,revision:number}` → Document；新建 revision=0，冲突409返回清楚错误。允许的 key 由服务端限定到现有前端业务域，禁止任意键或超大文档。
- 每账号隔离，只同步用户明确启用的本地状态。共享社区/通讯/订单/钱包的权威状态分别使用专用接口，不把客户端 JSON 当成服务端授权数据。

## 运营后台

- `GET /admin/overview` → `{users,posts,conversations,reports,pendingReports,hiddenPosts,dailyActive,series:[{date,users,posts,messages}],recentActivity:Audit[]}`。
- `GET /admin/users` → User 列表；`PATCH /admin/users/{id}` `{status?,role?}` → User。禁止降级/封禁自己及最后管理员。
- `GET /admin/posts` → 全部状态 Post 列表；`PATCH /admin/posts/{id}` `{status}` → Post。
- `GET /admin/reports` → Report 列表；`PATCH /admin/reports/{id}` `{status:'resolved'|'dismissed',note}` → Report，note 必填；只允许 open 工单处理，重复结案返回409。
- `GET /admin/audit` → Audit 列表。`Audit={id,actorId,actorName,action,targetId,detail,createdAt}`。
- `Report={id,reporterId,targetType,targetId,reason,status:'open'|'resolved'|'dismissed',note,createdAt}`。
- admin / moderator 可以读取运营并审核内容/处理举报；仅 admin 可变更用户角色和状态。用户列表支持 status/role，内容和举报支持 status。
- dailyActive 为当前有效会话用户数，series 按 UTC 日期统计，不作为严格 DAU 指标。
- 所有运营写操作在同一事务写审计。

## Web3 实验室 / 测试账本

- `GET /wallet` → `{network:'Gongming Testnet',assets:[{symbol,name,balance,decimals}],address,transactions:LedgerEntry[]}`。
- `POST /wallet/faucet` `{requestId}` → Wallet；每账号24小时一次1000测试GEM，重复requestId返回原结果。
- `POST /wallet/transfer` `{recipientHandle,amount,requestId}` → Wallet；金额为 GEM 最小单位整数字符串，decimals=2，同一事务扣款/入账，重复requestId不重扣。
- 不接入真实资产、不索取私钥。浏览器钱包连接后仅读取公开地址与链号，真实签名认证/链上交易在专用后续阶段实现并单独验证。

## 运维

- `GET /health` 公开最小健康状态；`GET /admin/system` → `{version,storage,environment,uptimeSeconds,features:string[]}`。
- 服务配置由环境变量提供。请求体限制、超时、参数校验、分页、登录限速、权限/账号隔离、测试账本原子性属于必需验收项。
