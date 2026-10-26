# 站内通知服务

站内收件箱覆盖好友、互动、圈子与审核；v0.8.0 / schema8加入活动更新、候补递补和活动审核，合计17种受控事件。保留五个主导航与二级 `/notifications`，社交顶部提供紧凑铃铛。消息未读仍属于聊天，不为每条聊天再制造通知；没有系统推送、短信或邮件。活动来源与报名事务规则见 [活动契约](CIRCLE_EVENTS_SERVICE.md)。

## 公开模型

所有ID随机，通知ID为 `notice_` 加32位小写hex。PublicUser沿用安全投影；时间RFC3339/UTC微秒。通知不向客户端提供自由填写HTML、任意跳转URL、审核note或邀请凭证。

```ts
type NotificationKind =
  | 'friend-request'
  | 'friend-decision'
  | 'circle-request'
  | 'circle-decision'
  | 'circle-membership'
  | 'circle-status'
  | 'world-comment'
  | 'world-like'
  | 'circle-comment'
  | 'circle-like'
  | 'world-review'
  | 'circle-review'
  | 'media-review'
  | 'report-review'
  | 'circle-event-update'
  | 'circle-event-registration'
  | 'circle-event-review';
type NotificationTarget =
  | { type: 'friend-requests' }
  | { type: 'user'; handle: string }
  | { type: 'circle-members'; circleId: string }
  | { type: 'circle'; circleId: string }
  | { type: 'world-post'; postId: string }
  | { type: 'circle-post'; circleId: string; postId: string }
  | { type: 'circle-event'; circleId: string; eventId: string }
  | { type: 'uploads'; mediaId: string };
type Notification = {
  id: string;
  kind: NotificationKind;
  category: 'requests' | 'interactions' | 'system';
  outcome: string;
  actor: PublicUser | null;
  available: boolean;
  context: { title: string; excerpt: string } | null;
  target: NotificationTarget | null;
  createdAt: string;
  readAt: string | null;
};
type NotificationsPage = {
  items: Notification[];
  total: number;
  unreadTotal: number;
  throughId: string | null;
};
```

outcome只允许下表受控值，不是可展示的自由文案。前台用kind/outcome的固定中文词句表达历史事件，不能把历史决定说成当前成员身份。context仅为读取时有权看到的当前内容，title最多120字、excerpt最多160字，不含图片/封面。available=false时actor/context/target均为null，展示通用“原内容当前不可访问”；outcome可保留本人历史结果。report-review为信息通知，available=true但actor/context/target均null，只展示固定处理状态。system类别始终actor=null，不暴露具体平台审核者身份。

## 事件与受众

| kind                      | category     | outcome                                              | 何时/发给谁                                                                              |
| ------------------------- | ------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| friend-request            | requests     | 空字符串                                             | 新待处理申请→接收者；重复待审申请不重复                                                  |
| friend-decision           | requests     | accepted / declined                                  | 实际接受/拒绝→发起者；取消不额外通知                                                     |
| circle-request            | requests     | 空字符串                                             | 新审核加入申请→当时圈owner/admin，不向新升任管理补造历史通知                             |
| circle-decision           | requests     | accepted / declined                                  | 实际审批→申请者；取消不通知，重放旧终态不通知/不恢复成员                                 |
| circle-membership         | system       | admin / member / owner / removed / banned / unbanned | 实际任免/转交/移除/封禁/解禁→受影响成员；本人主动退出不通知本人；转交只通知新owner       |
| circle-status             | system       | active / suspended / archived                        | 平台真实暂停/恢复或owner归档→当时active成员（排除操作者）；同状态只改说明不通知          |
| world-comment             | interactions | 空字符串                                             | 新评论→世界帖作者，排除自评                                                              |
| world-like                | interactions | 空字符串                                             | 第一次该actor赞该世界帖→作者，排除自己；取消再赞不刷通知                                 |
| circle-comment            | interactions | 空字符串                                             | 新评论→圈帖作者，排除自评；只有当前可互动才产生                                          |
| circle-like               | interactions | 空字符串                                             | 第一次该actor赞该圈帖→作者，排除自己；取消再赞不刷通知                                   |
| world-review              | system       | published / pending / hidden                         | 帖子真实审核状态变化→作者，排除操作者本人                                                |
| circle-review             | system       | published / pending / hidden                         | 圈方/平台帖子真实状态变化→作者，排除操作者本人                                           |
| media-review              | system       | ready / blocked                                      | 原图真实状态变化→上传者，排除操作者本人；同状态说明更新不通知                            |
| report-review             | system       | resolved / dismissed                                 | 举报首次结案→原举报者，排除操作者本人；不回显内部说明或被举报内容                        |
| circle-event-update       | system       | updated / cancelled                                  | 活动真实编辑/取消→当时registered/waitlisted且当前正常圈成员，排除操作者；同载荷不刷      |
| circle-event-registration | system       | promoted                                             | 有效候补实际递补→本人，排除本人操作直接取得名额；普通报名已有回执，不额外通知            |
| circle-event-review       | system       | hidden / visible                                     | 平台实际改活动可见性→活动创建者及当时正常确认/候补成员，去重并排除操作者；同态补说明不刷 |

媒体屏蔽导致世界/圈帖状态变化时，也在同一事务给相应作者产生审核结果通知。新建自己的待审帖已有发布回执，不另发通知给自己。圈staff审核自己的帖子不制造自通知。系统种子只在首次空开发库包含明确标注的新业务示例/真实操作生成的通知；升级不回填历史事件，不把本机原型同步为通知。

活动审核创建者是独立收件人，不要求其仍是圈成员；确认/候补受众则要求当时账号和成员正常。已离圈创建者可保留本人通用审核结果，但无法从通知取得已失去的活动内容。活动更新/取消按真实revision去重，候补递补按本次队列顺序标识去重；旧成功报名收据重放不产生新通知。恢复圈或活动可见性时，可在同一事务向实际递补者发通知；已取消登记不复活。普通报名/退出成功回执不再制造单独通知。

## API与已读边界

前缀 `/api/v1`，全部须正常登录及预期账号匹配；写入必须合法Origin。客户端不提供“创建通知”接口。

- `GET /notifications?category=all|requests|interactions|system&unread=true|false&limit&offset` → NotificationsPage；默认all/false/limit20，limit1–100、offset0–100000。unread=true只取未读，false包括已读；非法枚举400。按该收件人seq倒序。total是筛选后数量；unreadTotal是全收件箱未读数。
- `GET /notifications/unread` → `{unreadTotal,throughId}`，轻量真实徽标，不能加载业务State。
- `POST /notifications/{id}/read` `{}` → `{ok:true,unreadTotal,readAt}`。仅自己所有的通知；未知/他人统一404。重复已读保持原readAt，不刷新时间。
- `POST /notifications/read-all` `{throughId:string|null}` → `{ok:true,markedRead:number,unreadTotal}`。必须显式传字段，null为无副作用0；只改本账号seq不超过该ID的未读，跨账号/未知ID404，不能退化为请求到达时全读。重复可markedRead=0。

throughId是本次REPEATABLE READ列表快照内该账号全收件箱最高seq的ID，不受分类/未读/分页影响；空箱null。计数、items和throughId来自同一快照。列表读取后新到的通知不会被这次“截至当前全部已读”覆盖。删除/GC后仍须保留点赞终身去重证据；本轮不提供删除/GC或标为未读。

## 读取时权限与跳转

正文、标题、actor等投影不能按通知旧快照恢复。存储只保存引用ID、受控kind/outcome、eventKey和时间；没有帖子正文/标题、私圈名、审核note、图片或邀请token。

- 好友通知只本人申请参与者可读上下文；仍pending的新申请target friend-requests，对应 `/contacts?tab=requests`。已处理申请可在对方账号正常时target user（`/u/:handle`），不声称新申请仍待处理；停用/不存在的对象脱敏。
- circle-request要求当前圈管理及当前可访问该圈管理列表，context可投影当前圈名和申请附言；target circle-members → `/circles/s/:id/members?tab=requests`。普通成员/降权后不可借通知读取附言或圈介绍。
- circle-decision/circle-membership/circle-status按当前圈介绍权限读取当前圈名并target circle。移除/封禁后、私圈拒绝后等已无介绍权时统一脱敏；公开圈仍须有当前active成员或本人pending申请才投影通知上下文，避免已离开的成员借历史通知跟踪私圈后改名。
- 世界互动/审核仅当前可读目标帖子（含作者可读的待审/隐藏帖）时投影；删除后脱敏。context为当前帖子正文摘录，title为固定“世界动态”；target world-post → `/world/p/:postId`。
- 圈帖互动/审核仍要求当前圈成员、圈状态及频道/帖子权限，平台角色不绕过。context为当前帖title/body摘录；target circle-post。移除/封禁/降级、管理频道权限变化、暂停、删除后脱敏。
- 三类活动通知target circle-event → `/circles/s/:circleId/events/:eventId`。须当前active圈成员、圈未暂停且活动当前可见；hidden仅当前圈owner/admin可读，创建者身份或平台角色不旁路，取消活动仍按同一可见性规则保留。context取当前活动title及地点/开始时间摘录；失权后actor/context/target全部null，既有通用结果仍可保留。系统actor始终null，不载入名单、报名收据或内部审核说明。
- 媒体审核只该原图上传者本人，未软删时target uploads → `/account/uploads?image=:mediaId`；不把屏蔽图作为图片加载，context为固定“我的上传”及受控状态提示。已删后脱敏；圈原图上传者仍可清理本人记录，不因此获得其它私圈数据。
- 举报结案仅本人信息通知，固定结果、无原内容/内部note或目标私圈链接。

客户端只把已知target类型映射为本地路径，所有ID/handle编码；未知类型不渲染Link。通知列表收到脱敏项必须整体替换旧项，不能从旧对象合并保留context/actor/target；读写失败/账号变化/卸载/迟到回执不恢复旧私密内容。单条已读失败仍可手动查看原目标，但不能显示假已读；跳转页仍独立鉴权。

## 工程与验证

schema7新增独立通知表与每账号序号计数表，schema8扩展为17类kind/outcome及circle-event目标，不改变已有14类语义。State内仅 transient `NotificationDrafts`（json:"-"），普通域不load历史通知；业务真实变化后显式queue，persistNormalized之后、同一PG事务Commit前flush。活动专用SQL在本事务内生成draft并flush；成员/账号失权的State事务先reconciliation登记，再与来源业务和审计一起提交。recipient+eventKey唯一，跨多收件人按userID稳定锁计数器；点赞eventKey固定为域+post+actor，评论/requestID/真实revision或登记顺序变化分别防重。任一步失败全部回滚，未知提交不声称成功。通知列表/徽标/已读走专用SQL与窄会话鉴权，按本页所需域批量投影；活动引用也仅批量查本页IDs，不将活动历史装入State。

真实PG测试须覆盖：事件与业务回滚、并发去重/点赞反复切换、跨实例已读与read-all新到保护、跨账号/Origin/预期账号拒绝、私圈角色/成员/暂停及活动hidden后的动态脱敏、不回显note/token、外键与不可变事件身份、各版本迁移旧行/文件/cookie保留及DDL失败回滚；不锁无关域的badge/read仍完成。活动还需覆盖递补与来源同事务、离圈创建者收到脱敏审核结果、取消/重放不刷通知，以及v7→v8旧通知不回填/不改写。新空开发库要有真实可理解的示例，现有库不补造历史。前台完成加载/空错/重试、筛选/分页、铃铛真实徽标、权限失效/旧请求/账号切换与目标跳转测试；本轮实际HTTP、完整检查和备份/隔离恢复证据集中在 [运行记录](STACK_STATUS.md)，本文不预先声明通过。
