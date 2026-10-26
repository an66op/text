# 圈子服务

创建、成员、邀请、forum/announcement频道、帖子、评论/点赞及治理已接入Go/PostgreSQL；v0.7.0增加同事务站内通知与本人引用清理，本轮v0.8.0 / schema8实现圈级活动发布、报名候补、管理名单、举报与独立治理。本机圈子不自动导入，保留独立演示。语音、真实圈聊和资料库仍待接入，不使用虚假的在线人数或成功回执；运行验收见 [阶段记录](STACK_STATUS.md)。

## 路由与模型

前台真实目录 `/circles`，创建 `/circles/new`，圈子主页 `/circles/s/:circleId`；其下 `channels/:channelId`、`posts/:postId`、`compose?channel=ID`、`members`、`manage`、`join`、`invite`。后端前缀 `/api/v1`。本机目录 `/circles/demo`、创建 `/circles/demo/new`，旧本机ID详情路由继续保留；与真实服务互不替代。

真实活动位于同一圈详情下 `events`、`events/new`、`events/:eventId`、`events/:eventId/edit`、`events/:eventId/attendees`，不改变频道枚举或五个一级入口。后台圈子治理第三分区为 `/circles/events`。

所有ID为随机前缀加32位小写hex：circle_/cchannel_/cpost_/ccomment_/crequest_/cinvite_/cevent_。时间RFC3339；列表 `{items,total}`，limit1–100、offset0–100000。PublicUser沿用不含邮箱/角色的投影。

```ts
type CircleRole = 'owner' | 'admin' | 'member' | 'guest';
type Circle = {
  id: string;
  name: string;
  description: string;
  cover: string;
  icon: string;
  category: string;
  visibility: 'public' | 'private';
  joinPolicy: 'open' | 'approval';
  status: 'active' | 'suspended' | 'archived';
  owner: PublicUser;
  role: CircleRole;
  membership: 'active' | 'pending' | 'banned' | 'none';
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};
type Channel = {
  id: string;
  circleId: string;
  name: string;
  description: string;
  kind: 'forum' | 'announcement';
  access: 'members' | 'staff';
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};
type CircleMember = {
  user: PublicUser;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'removed' | 'banned';
  joinedAt: string;
};
type JoinRequest = {
  id: string;
  circle: Circle;
  user: PublicUser;
  note: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  createdAt: string;
  updatedAt: string;
};
type JoinResult = { status: 'joined' | 'pending'; circle: Circle; request?: JoinRequest };
type CirclePost = {
  id: string;
  circleId: string;
  channelId: string;
  author: PublicUser;
  title: string;
  body: string;
  images: string[];
  status: 'published' | 'pending' | 'hidden';
  featured: boolean;
  pinned: boolean;
  likeCount: number;
  liked: boolean;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
};
type CircleComment = {
  id: string;
  postId: string;
  author: PublicUser;
  body: string;
  createdAt: string;
};
type CircleInvite = {
  id: string;
  circleId: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revoked: boolean;
};
// 仅创建回执含token，列表/数据库/审计不保留原token。
type CreatedInvite = CircleInvite & { token: string };
type AdminCircle = Circle & {
  channelCount: number;
  postCount: number;
  moderationNote: string;
};
type AdminCirclePost = CirclePost & {
  circleName: string;
  channelName: string;
  moderationNote: string;
};
```

CircleInput：name最多40字，description最多600字，category最多30字，icon最多16字，cover为空或合法外站http(s)图片地址；visibility/joinPolicy显式提供。创建还需clientId（8–100位字母数字_-），按owner+clientId幂等，字段变化复用409。每账号最多20个未归档自有圈，每圈最多1000成员/50频道。新圈默认建立一个forum/members讨论频道。封面不使用待审托管图片URL，避免成为未授权的公开入口。

## 介绍、加入与成员权限

- `GET /circles?scope=discover|mine&q&category&limit&offset`：discover只返回active公开圈介绍，mine返回本人active成员圈（含归档/被暂停状态，便于理解）；不返回私圈正文或未加入的私圈介绍。
- `POST /circles` CircleInput+clientId → Circle；`GET /circles/{id}` → Circle。私圈仅当前成员或本人已有待处理申请可读介绍；其余404。公开圈可读介绍，内容仍要求成员。
- `PATCH /circles/{id}` CircleInput部分字段 → Circle，圈主/管理员可编辑。不能通过PATCH更改owner/status。
- `POST /circles/{id}/join` `{note?,inviteToken?}` → JoinResult。公开open直接加入，approval产生待审申请；私圈必须有效邀请，仍遵守approval。已是成员幂等，不重复消耗邀请次数。被封禁成员不能重新申请或用邀请绕过。
- `GET /circle-requests?status&limit&offset`：本人发出且本人当前仍可读取圈介绍的申请；私圈离开/被移除后，已处理历史仍留存但不借此返回最新私圈介绍。`GET /circles/{id}/requests?status&limit&offset`：圈主/管理员入站申请；`POST /circles/{id}/requests/{requestId}/respond` `{action:'accept'|'decline'|'cancel'}` → JoinRequest。前两项只圈主/管理员，cancel仅申请本人；权限仍有效时相同决定幂等、不同终态409。取消私圈申请后重复读取/取消不能绕过介绍权限。重放旧accept不能恢复已移除成员。
- `GET /circles/{id}/members?status&q&limit&offset`：active成员可看正常成员；只有圈主/管理员可筛removed/banned。PublicUser不泄漏邮箱或平台权限。
- `PATCH /circles/{id}/members/{userId}` `{role:'admin'|'member'}` → CircleMember，仅圈主，不能改当前owner。
- `POST /circles/{id}/members/{userId}/remove` `{ban:boolean}` → `{ok:true}`。圈主可移除非owner；管理员只能移除普通成员，不能移除owner/admin。ban=false移除后可重新申请；ban=true保留封禁证据，无法自行重入。重复相同目标状态幂等。
- `POST /circles/{id}/members/{userId}/unban` `{}` → `{ok:true}`，圈主/管理员按相同角色边界解禁，状态改removed，需重新申请，不自动加回。
- `POST /circles/{id}/owner` `{userId}` → Circle，仅当前owner转交给正常active成员；旧owner成为admin。`POST /circles/{id}/leave` `{}` → `{ok:true}`，非owner可离开，owner需先转交；已离开幂等。
- `DELETE /circles/{id}` → `{ok:true}`，只有owner归档，数据保留，目录不再发现，现有成员可读历史但不能新建内容。作者仍可删除自己的帖子用于清理上传引用。归档不等于平台暂停；归档后不再入圈/审批/邀请/改成员或频道。

平台admin/moderator在普通圈子API上不自动获得成员或圈主权限。账号停用、离开、移除、封禁和频道角色变化后，后端重新鉴权，客户端必须撤掉失效的私密内容，迟到读取或写入回执不能恢复。

## 邀请

- `POST /circles/{id}/invites` `{expiresInHours,maxUses}` → CreatedInvite，圈主/管理员；有效1–168小时，次数1–100，默认72小时/20次。
- `GET /circles/{id}/invites` → CircleInvite列表，圈主/管理员；`DELETE /circles/{id}/invites/{inviteId}` → `{ok:true}` 撤销，重复幂等。
- `POST /circle-invites/preview` `{token}` → Circle，仅已登录正常账号预览介绍，不返回频道或帖子。无效/过期/撤销/已满统一404。
- 邀请token随机256bit，只存摘要。前台分享链接使用 `/circles/s/{id}/join#invite=TOKEN`，token放fragment，不送到URL查询、日志或审计。只在显式加入/预览时通过POST body提交。
- token兑换记录对invite+user唯一，创建待审申请或完成加入时原子消耗一次，重复请求不重复耗次。撤销/到期不自动取消已提交申请，后续接受仍需圈方显式审批；取消申请不返还次数。私圈不依靠猜中ID获得访问权。

## 频道、内容与图片

- `GET /circles/{id}/channels` → 当前成员可见Channel列表；`POST ...` `{name,description,kind,access}` → Channel，圈主/管理员；`PATCH /circles/{id}/channels/{channelId}` 同字段部分更新+archived → Channel。名称最多40字、描述300字。staff频道只owner/admin可读，普通成员连标题/数量也不返回。归档频道可读历史，不允许发布/评论/点赞，已有帖子可由作者删除。
- `GET /circles/{id}/posts?channelId&view=all|featured|owner|photos&status&q&limit&offset` → 当前成员有频道权限的帖子；status默认published，pending/hidden仅圈owner/admin可查，普通成员不能通过筛选越权。author本人和圈staff可经详情读未公开帖。`GET /circles/{id}/posts/{postId}` → CirclePost。
- `POST /circles/{id}/posts` `{channelId,title,body,images?,clientId}` → CirclePost。title最多120、body最多5000、images最多9张；clientId必填，按作者+圈子+频道去重，相同内容重试返回原帖，不同内容409。forum成员可发，announcement仅圈staff可发。文字帖published，含上传图片先pending。
- `PATCH /circles/{id}/posts/{postId}` `{status?,featured?,pinned?}` → CirclePost，仅圈owner/admin按可访问频道审核；发布前重查图可用性。`DELETE ...` → `{ok:true}`，作者或当前有频道权限的圈staff可删除，保留幂等墓碑并解除图片引用。正常登录作者即使已退出/被移除、失去staff频道权限或圈/频道归档，仍可按已知ID删除本人帖用于清理上传；只返回成功状态，不恢复私密内容访问。原clientId重放仍409。
- `POST /circles/{id}/posts/{postId}/like` `{liked:boolean}` → CirclePost，目标状态幂等；`GET .../comments` → CircleComment列表；`POST .../comments` `{body}` → CircleComment，最多2000字。仅正常已发布帖子、正常圈子及未归档且本人可读频道可互动；announcement普通成员可点赞和评论，主帖仍只有圈staff可发布。
- `POST /reports` 新增 `{targetType:'circle-post',targetId,reason}`，要求本人当前可读该圈帖；平台举报接口不能使普通用户越权读取私圈。

圈内上传用 `POST /circles/{id}/media/images`，仍multipart仅file/clientId，当前正常成员才能上传。公开MediaAsset新增 `scope:'world'|'circle'` 和可选circleId；旧资产原子标为world，新的圈资产固定到一个圈，scope不可改。相同clientId跨scope冲突。前端复用上传组件时传circleId，必须验证回执scope/circleId相符。

圈帖只能引用本人且绑定该圈的可用图片，世界帖不能引用圈资产。图片GET/HEAD仍是原同源media URL：上传者可看自己的可用原图；其它圈成员只有当前能读已发布引用帖时可看；任何圈引用都不授予匿名/世界访问。平台图片审核可通过独立治理权限查看和屏蔽原图，屏蔽时同时隐藏世界/圈子的已发布引用帖。解除屏蔽不自动发布。

原AdminMediaAsset/本人媒体列表追加circleReferenceCount、circlePublishedReferenceCount、circlePosts（最多10条，含circleId/channelId/id/body/status）；referenceCount为世界+圈子未删除总引用，publishedReferenceCount仅世界公开引用，不把私圈称为公开。posts仍只世界帖子。scope/circleId在“我的上传”和后台明确显示。图库仅在全部引用为零时允许删除。

本人上传页的圈内引用可明确确认删除整篇本人圈帖，成功后刷新引用，原图另行清理；删除失败保留并可重试。通知的图片目标只跳 `/account/uploads?image=media_<32小写hex>`，按本人资产重新读取，不直接公开原图。

## 圈级活动

活动独立于讨论/公告频道，完整模型、10个API与时间、容量、候补规则集中在 [活动服务契约](CIRCLE_EVENTS_SERVICE.md)。当前圈owner/admin可创建、全量编辑和结束前取消，管理权来自当前角色；创建者身份不授予永久管理权限。编辑和后台治理使用revision防旧表单覆盖，取消是终态。活动不收费、不收报名附言或联系方式，地点仅纯文本。

普通列表、详情与数量只向当前active成员开放；公开圈介绍也不授予活动权限。hidden仅当前圈管理可读，创建者降为普通成员后也不能借旧创建回执读取；暂停圈普通端不可读，归档只保留历史。普通成员只通过myRegistration读取本人登记，名单独立分页且仅圈owner/admin可查，平台活动治理不请求名单。

join仅争取确认名额，满额409；waitlist明确同意候补，空位直接确认、满额进入队尾。成功操作收据按event/user/clientId绑定intent，重放只回当前本人状态，不能用旧join复活登记或旧leave取消后来登记。超时先刷新，手动重试保留原编号，不以本机人数替代服务器结果。

释放名额、容量增加或恢复圈/活动可见性时，同事务按顺序递补有效且未截止候补；不恢复cancelled登记，不重开报名窗口。退出/移除/封禁和账号停用在原事务释放未结束活动登记，重入/解禁不恢复旧报名。持有已知圈/活动ID且正常登录的本人，可经leave清理既有登记；前台清理入口在私密详情业务树外，只发本人清理操作，不预取标题、地点或名单。

活动举报使用 `POST /circles/{id}/events/{eventId}/report`，必须本人当前可读，写入现有举报表的circle-event类型。活动编辑/取消、实际候补递补和平台可见性变化生成受控站内通知；创建者独立收审核结果，离圈后通知上下文仍按当前权限脱敏。

## 独立平台治理

- `GET /admin/circles?q&status&limit&offset` → AdminCircle列表；`PATCH /admin/circles/{id}` `{status:'active'|'suspended',note}` → AdminCircle。仅平台staff，note必填1–1000字，同状态更新说明允许并审计。archived只读，不能用平台恢复冒充圈主解除归档。
- `GET /admin/circle-posts?circleId&status&q&limit&offset` → AdminCirclePost列表，包括私圈内容，界面明确为平台审核权限；`PATCH /admin/circle-posts/{id}` `{status:'published'|'hidden'|'pending',note}` → AdminCirclePost。须填说明并审计，发布重查圈子/频道状态和绑定图片，不能从暂停/归档圈发布新内容。
- `GET /admin/circle-events` / `PATCH /admin/circle-events/{eventId}` 是独立staff活动治理，仅显示内容和聚合数，无名单、收据或联系方式。PATCH带moderation/note/revision，说明必填，取消活动只读；任何visible提交须圈active，已结束可恢复历史阅读。恢复事务仅递补有效未截止候补，不恢复取消登记或改变原报名截止；同状态补说明仍推进版本并审计。
- 平台暂停圈后，普通端不再读频道/帖子/评论及他人的圈内图片，自己的圈介绍显示暂停状态便于申诉；平台审核入口仍可查。恢复不改成员或自动发布待审/隐藏帖。

## 验证与工程边界

schema6和原图scope迁移在一个事务，保留旧实体、Cookie与文件；schema7增加通知收件箱与每账号序号两表，schema8增加活动、本人登记和成功操作收据三表，并扩展通知/举报约束，不导入本机demo或回填旧活动/通知。圈子审批/身份/互动/治理、图帖、原图和活动结果依 [通知契约](NOTIFICATIONS_SERVICE.md) 同事务产生事件。历史通知每次按当前成员、圈状态及相应频道/活动权限动态投影；管理降权不能继续读申请附言，失权后actor/context/target均为空。公开圈的介绍类通知上下文也要求当前成员或本人pending申请，不能借历史记录追踪离圈后的介绍变更。

公开介绍不得携带邀请token、私频道名、私密正文、活动标题/数量或邮箱。关键验证包含幂等、角色竞态、最后名额邀请/审批、移除与图读取重查、通知动态脱敏、作者失权后仅删除本人内容，以及活动限额/FIFO/成功收据/取消与失权清理；另有真实PG隔离、迁移回滚、私圈/跨圈IDOR、媒体世界隔离和后台越权验证。圈子成员/频道/图文普通读写仍有State全域快照成本；活动、通知走按域SQL，活动历史不进入State，成员/账号变化在同事务末尾用窄域reconciliation协调登记。新建活动与报名发生在旧State快照之后的交错也属于必须验证的边界。本文不代替本轮全检/恢复证据，不声称高流量容量或实时语音已完成。
