# 共鸣全栈 API 约定

前台 React / Vite / TypeScript（5173），运营后台 React / Vite / TypeScript（5174），Go API（8080），PostgreSQL（本地隔离实例 55432）。两套前端通过 Vite `/api` 代理调用服务，生产同源反向代理。

## 通用

- 前缀 `/api/v1`。成功 `{ "data": T }`；失败 `{ "error": { "code": "...", "message": "中文可读说明" } }`。
- 时间 RFC3339，ID 字符串。金额全部整数字符串，价格以分为单位；钱包仅测试账本。
- HttpOnly SameSite=Lax 会话 cookie；写请求校验 Origin，开发仅允许 5173/5174 的 localhost/127.0.0.1。密码 bcrypt，token 只存 SHA-256。管理员与成员强制角色授权。非登录/注册/查询会话请求可带 X-Gongming-Account，若与 cookie 身份不符则409 account_changed，防多标签页账号切换串写；该头不能授予权限。
- 列表统一 `{items: T[], total: number}`，支持 `q` / `limit` / `offset`（服务限制上限）。
- 前后台请求期限20秒，覆盖响应头与响应体读取；用户取消仍作为取消处理。写入超时不能据此认定事务失败，客户端提示刷新确认、不自动重发。

## 账号

`User = {id, handle, name, email, avatar, bio, role: 'member'|'moderator'|'admin', status: 'active'|'suspended', createdAt}`。

- `POST /auth/register` `{email,password,name,handle}` → `{user,expiresAt}`。
- `POST /auth/login` `{email,password}` → `{user,expiresAt}`。
- `GET /auth/me` → `{user,expiresAt}`；`POST /auth/logout` → `{ok:true}`。
- `PATCH /me` `{name?,bio?,avatar?}` → User。
- `GET /me/sessions` → `{items:DeviceSession[],total}`，仅本人未过期会话，当前优先，再按创建时间倒序和 ID 排序。
- `DeviceSession = {id,device,createdAt:string|null,lastSeenAt:string|null,expiresAt,current:boolean,legacy:boolean}`。ID 是独立非秘密随机定位符；device 仅为不可信的粗粒度系统/浏览器提示。旧会话时间未知为 null；lastSeenAt 当前仅记录登录验证，界面称「最近验证」，不代表在线或每次访问时间。不返回 token、摘要、IP、原始 UA。
- `DELETE /me/sessions/{id}` → `{ok:true,current:boolean}`。只能撤销本人有效会话，未知/过期/已撤销/其它账号统一404；成功撤销当前会话后清 Cookie，失败不能清。受影响 WebSocket 将关闭。
- `POST /me/sessions/revoke-others` `{}` → `{revoked:number}`，只撤销本人其它有效会话，保留当前会话；重复请求可返回0。上述写入仍要求 Origin、正常账号与预期账号匹配。
- 本地种子：成员 `demo@gongming.local` / `Demo2026!`；管理员 `admin@gongming.local` / `Admin2026!`。仅开发环境启用种子，生产禁止默认凭据。

## 全站社区

### 上传图片

`MediaAsset = {id,url,scope:'world'|'circle',circleId?,contentType:'image/jpeg'|'image/png',width,height,bytes,createdAt}`。ID 为 `media_` 加32位小写十六进制，URL 固定为同源相对路径 `/api/v1/media/images/{id}`。bytes 是处理后的文件大小；scope与circleId创建后不可更改，旧资产为world。

- `POST /media/images` 使用 multipart/form-data，且仅包含 `file` 与 `clientId` 两个字段。必须登录，来源与预期账号仍校验。clientId 为8–100位字母/数字/下划线/连字符；同账号同内容重试返回原资产，不同内容409，已删除资产不能用旧编号恢复。
- 仅 JPEG/PNG，输入与重编码输出均最多8MiB；单边8192像素、总像素16MP。服务端以实际解码结果判断，处理JPEG方向后重编码，移除原始元数据。最多9图/帖；每账号未删资产最多100张/100MiB，屏蔽图片也计入；新上传每小时30次，重复已提交请求不重复占额。单实例最多4个上传接纳、2个解码、每账号1个上传。
- `POST /circles/{circleId}/media/images` 使用相同上传契约，要求正常圈内成员，资产固定绑定该圈。世界帖子只接受本人world资产，圈帖只接受本人且绑定该圈的资产；同clientId跨scope冲突。
- `GET /media/images/{id}` 与 `HEAD` 返回二进制图片。本人和运营可读可用原图；world资产有已发布世界帖引用时才开放，circle资产要求当前圈成员、可读频道及已发布圈帖引用，暂停圈不向其它成员开放图片。公开圈介绍不授予图片权限。被屏蔽图片仅运营人员可读，删除后一律不可读。不存在/不可见统一404；响应 `no-store`，不能把它变成无鉴权的静态目录。
- `DELETE /media/images/{id}` → `{ok:true}`，仅本人且没有任何帖子引用时可删；已删除重复成功，未知/他人404，仍有引用409。逻辑删除提交后再清文件；存储失败可能留下不可访问文件，不能恢复软删资产。
- `GET /me/media` → 本人未删资产列表，支持 q/status/limit/offset；结构与下述运营媒体列表相同，仅本人可查。用于找回或清理取消、超时后可能已经保存的上传。
- `GET /admin/media` → `{items:AdminMediaAsset[],total}`，仅运营人员；status 为 ready/blocked，q 支持图片ID、上传者ID/用户名/昵称、引用帖子ID。
- `AdminMediaAsset = MediaAsset & {owner:PublicUser,status:'ready'|'blocked',note,referenceCount,publishedReferenceCount,circleReferenceCount,circlePublishedReferenceCount,posts:[{id,body,status}],circlePosts:[{circleId,channelId,id,body,status}],updatedAt}`。两个帖子预览数组各最多10条，按创建时间倒序，body最多200字；referenceCount为两域总引用，publishedReferenceCount仅世界公开引用，circle计数明确分列，不能称为公开。ready表示可引用，不能解释为已公开。
- `PATCH /admin/media/{id}` `{status:'ready'|'blocked',note}`，note 必填且最多1000字，允许同状态更新说明并记审计。屏蔽图片时，同事务隐藏全部已发布引用帖；解除屏蔽只恢复图片可用性，不自动恢复帖子。

创建含托管图片的帖子时，只能引用本人可用图片，初始状态为 pending；不能把托管相对路径改成本站绝对URL绕过引用记录。审核发布前重新验证全部托管图片，含已屏蔽/删除图片时拒绝发布。既有外站 http(s) 图片链接继续兼容，它们不受托管图片存储/审核服务控制。存储、恢复及故障边界见 [媒体说明](MEDIA_STORAGE.md)。

`PublicUser = {id,handle,name,avatar,bio}`，不包含邮箱或权限字段。

`Post = {id,author:PublicUser,body,images:string[],topic,status:'published'|'hidden'|'pending',createdAt,likeCount:number,liked:boolean,commentCount:number}`。
`Comment = {id,postId,author:PublicUser,body,createdAt}`。

- `GET /posts`（公开只返回 published，支持 topic / author用户名 精确筛选）→ 列表；`POST /posts` `{body,images?,topic?}` → Post。
- `GET /posts/{id}` → Post；`DELETE /posts/{id}` → `{ok:true}`（作者/管理员）。
- `POST /posts/{id}/like` `{liked:boolean}` → Post（幂等目标状态）。
- `GET /posts/{id}/comments` → Comment 列表；`POST ...` `{body}` → Comment。
- `POST /reports` `{targetType:'post'|'user'|'circle-post',targetId,reason}` → Report。圈帖举报必须由当前可读该帖的成员提交。

## 圈子社区

圈子目录、创建、加入审批、成员角色、转交/退出/封禁、邀请、讨论/公告频道、图文/评论/点赞及独立平台治理使用专用服务接口。公开介绍可先浏览，正文均要求当前成员；私圈介绍也受成员或待处理申请权限限制。平台运营身份不自动成为圈内成员；平台审核通过独立 `/admin/circles` 与 `/admin/circle-posts` 接口进行。

完整DTO、路由、媒体作用域和幂等规则见 [圈子服务契约](CIRCLES_SERVICE.md)。前台入口 `/circles`，详情 `/circles/s/:circleId`；本机演示目录 `/circles/demo`，不随登录导入服务器。

## 好友关系

好友关系必须双方确认，成员目录、私聊和群组成员关系都不会自动变成好友。

`FriendRequest = {id,from:PublicUser,to:PublicUser,note,status:'pending'|'accepted'|'declined'|'cancelled',createdAt,updatedAt}`。

- `GET /friends` → `{items:[{user:PublicUser,since}],total}`，支持 q/limit/offset，按 since 降序及用户 ID 稳定排序。
- `GET /friend-requests` 支持 `direction=incoming|outgoing`（默认 incoming）、`status=pending|accepted|declined|cancelled`（默认 pending）及通用分页；仅返回本人参与的申请，按创建时间降序及 ID 排序。
- `POST /friend-requests` `{userId,note?}` → FriendRequest，备注最多300字。同方向重复待处理申请返回原对象与原备注；反向已有待处理申请409，须先处理；自己或已成为好友的对象不能再申请。
- `POST /friend-requests/{id}/respond` `{action:'accept'|'decline'|'cancel'}` → FriendRequest。收件人接受/拒绝，发件人取消；重复相同终态幂等，不同决定409。接受与双向好友关系在同一事务提交。
- `GET /relationships/{userId}` → `{status:'self'|'none'|'friends'|'incoming'|'outgoing',request?:FriendRequest,since?:string}`。
- `DELETE /friends/{userId}` → `{ok:true}`，双向关系一起移除，重复幂等，原私聊与历史申请保留。再次成为好友需新申请并接受，重放旧接受结果不会恢复已移除的关系。
- 发起/接受要求双方账号正常；取消、拒绝、移除可清理涉及停用账号的旧关系。好友列表隐藏停用成员，申请历史只向双方显示 PublicUser。

## 通讯

`Conversation = {id,title,kind:'direct'|'group'|'channel',members:string[],ownerId,createdAt,lastMessage?:Message,unreadCount,readSeq,lastReadMessageId?}`。
`Message = {id,conversationId,sender:PublicUser,body,createdAt,seq:number,clientId?:string}`。

- `GET /conversations` → 用户已加入会话（附分页前 unreadTotal）；`POST /conversations` `{title,kind,memberIds:string[]}` → Conversation。
- `GET /conversations/{id}/messages` 支持 beforeSeq / afterSeq，兼容 beforeId；返回升序 items、total、hasMore、nextBeforeSeq / nextBeforeId。
- `POST /conversations/{id}/messages` `{body,clientId?}` → Message。clientId 按用户+会话去重，相同正文重复返回原消息、不同正文409；省略兼容旧客户端。仅成员可读写，频道仅当前频道主可发布，全站管理员身份不自动获得频道发布权。
- `GET /conversations/{id}` → `{conversation:Conversation,memberProfiles:PublicUser[]}`，仅当前成员可读，不依赖会话列表分页。
- `PATCH /conversations/{id}` `{title}` → Conversation；`POST /conversations/{id}/members` `{memberIds:string[]}` → Conversation，去重且总成员不超过200人，新成员可读原历史消息。
- `DELETE /conversations/{id}/members/{userId}` → Conversation，不能移除当前所有者，重复移除幂等；清理该成员的个人已读水位，保留其原消息。
- `POST /conversations/{id}/owner` `{userId}` → Conversation，只能转交给当前正常成员，旧所有者随即失去管理身份。
- 上述修改仅群组/频道当前所有者可操作，不因全站 admin 角色绕过；私聊禁止管理成员、改名和转交。
- `POST /conversations/{id}/leave` `{}` → `{ok:true}`，群组/频道的所有者需先转交，私聊不能退出；未知或已离开的会话统一返回无副作用成功，不泄露私有会话是否存在。
- `POST /conversations/{id}/read` `{messageId}` → `{conversationId,readSeq,lastReadMessageId,unreadCount}`。只能标记同会话现存消息，水位只前进。
- `GET /stream?after=eventId&account=userId` 升级 WebSocket。Cookie+精确Origin+成员鉴权；account可选，身份不符409。通知只含 type、eventId 和可选 conversationId/messageId；类型 ready / message.created / conversation.created / conversation.updated / conversation.read / resync。通知不作为权威消息内容；客户端再GET。
- 成员变更写事务 outbox；移出/退出后 API 按当前成员关系拒绝访问，WS 发送前再次检查。被移出者仅收到不含会话或消息 ID 的个人 resync，已有其它合法会话仍可继续收事件。
- eventId 为十进制字符串的不透明游标。outbox事务提交后可推送、跨实例读取；最多保留2000事件/7天，过旧游标resync。每账号8连接、每实例256，15秒ping、30分钟重连，注销/封禁后关闭。
- `GET /directory` → 已登录成员目录 PublicUser 列表，支持 q/分页；`GET /users/{handle}` → active成员 PublicUser。

PostgreSQL 的列表/详情/历史/发送/已读使用专用 SQL，不读取帖子、文档、钱包等全域 State；测试内存存储保留原处理器。权限、搜索、响应和幂等约定一致。读取使用 REPEATABLE READ，写入使用 SERIALIZABLE 与完整事务重试；消息和 outbox 原子提交。创建/管理会话等仍使用 State 适配层，全局事件游标仍是共享串行点。详细路径与实测见 [消息查询说明](../server/QUERY_PATHS.md)。

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
