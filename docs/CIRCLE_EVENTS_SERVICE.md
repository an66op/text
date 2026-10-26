# 圈子活动服务：v8实施契约

圈级活动独立于forum/announcement频道，不修改原频道枚举，不导入本机演示活动。五个主导航不变，真实圈首页「成员」旁增加「活动」。本轮完成活动发布/编辑/取消、限额报名、候补递补、管理名单、举报与独立平台治理；无收费、票务支付、签到定位、短信或定时任务。

## 模型与权限

活动ID `cevent_`+32小写hex，时间RFC3339/UTC微秒。容量1–1000，标题1–80字、介绍1–4000字、地点1–200字；地点只作纯文本。mode为online/offline，不自动打开外部会议链接。不收报名附言、联系方式或精确定位。所有人名只用PublicUser。

```ts
type EventRegistration = {
  status: 'registered' | 'waitlisted' | 'cancelled';
  reason: '' | 'user' | 'membership' | 'account' | 'event';
  queuePosition: number | null;
  createdAt: string;
  updatedAt: string;
};
type CircleEvent = {
  id: string;
  circleId: string;
  creator: PublicUser;
  title: string;
  description: string;
  mode: 'online' | 'offline';
  location: string;
  startsAt: string;
  endsAt: string;
  registrationClosesAt: string;
  capacity: number;
  registeredCount: number;
  waitlistedCount: number;
  lifecycle: 'published' | 'cancelled';
  moderation: 'visible' | 'hidden';
  phase: 'upcoming' | 'ongoing' | 'ended' | 'cancelled';
  registrationOpen: boolean;
  myRegistration: EventRegistration | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
type EventInput = {
  title: string;
  description: string;
  mode: 'online' | 'offline';
  location: string;
  startsAt: string;
  endsAt: string;
  registrationClosesAt: string;
  capacity: number;
};
type EventAttendee = { user: PublicUser; registration: EventRegistration };
type AdminCircleEvent = CircleEvent & {
  circleName: string;
  circleStatus: 'active' | 'suspended' | 'archived';
  moderationNote: string;
};
```

活动正文仅正常登录、当前active圈成员可读；公开圈也不向访客公开活动地点、标题或数量。圈暂停普通API不可读；圈归档保留历史可读但不可创建/编辑/报名。平台角色不绕过普通成员鉴权。hidden活动仅当前圈owner/admin可经详情读取，不向普通成员列表返回；创建者已降为普通成员也不能借旧回执读取hidden。取消为生命周期终态，仍按可见性规则保留记录，不删除报名历史。creator只记录创建者，管理权始终来自当前圈owner/admin。

phase、registrationOpen和候补顺序均由服务端当前时间/状态计算；服务器结束时间决定进行中/结束，无后台调度承诺。创建要求未来开始、endsAt>startsAt、持续不超过7天，报名截止不晚于开始且晚于当前时间；最长可提前365天。编辑必须活动尚未开始，重查同样时间约束；过去的报名截止可保持原值或改成未来，不允许伪装延长已过去的活动。容量不能低于已确认数。普通管理只能改内容/时间/容量，不能改creator、circleId、moderation或恢复取消活动。hidden不得通过编辑/取消绕过平台隐藏，但圈方仍可取消终止；取消后平台恢复不可复活。

## API

前缀 `/api/v1`，所有读写需要正常会话、预期账号；写入合法Origin。新API均使用按域SQL，不增加State的活动历史maps。默认limit20、范围1–100，offset0–100000。

- `GET /circles/{id}/events?view=upcoming|mine|all&limit&offset` → `{items:CircleEvent[],total}`。默认upcoming：未取消且endsAt>now的可见活动，startsAt升序；mine：本人当前registered/waitlisted，按startsAt升序；all：含可见取消/结束活动，startsAt降序。管理可见hidden，普通成员完全排除。count/页/myRegistration同一快照。
- `GET /circles/{id}/events/{eventId}` → CircleEvent。未知/不可见统一404；失去圈权限沿既有圈子403/404规则，无跨圈泄露。
- `POST /circles/{id}/events` `{...EventInput,clientId}` → CircleEvent，成功201。当前圈owner/admin且圈active。clientId沿现有8–100字符规则；creator+circle+clientId永久唯一，fingerprint绑定原载荷。相同重试返回当前可见状态，不能返回旧正文；不同载荷409，不存在先前创建回执则按实际时间校验；已失权重试不读取内容。新建即published/visible，不制造虚假待审。
- `PATCH /circles/{id}/events/{eventId}` `{...EventInput,revision}` → CircleEvent。全量编辑，revision必填，当前圈owner/admin、圈active且活动未取消/开始；旧revision409，提示刷新确认。有实际变化才revision+1/通知，同载荷无副作用但仍校验revision。
- `POST /circles/{id}/events/{eventId}/cancel` `{revision}` → CircleEvent。当前圈owner/admin、圈active，结束前允许取消；同revision第一次取消释放全部registered/waitlisted为cancelled/reason=event。已取消重复请求在仍有管理/阅读权时返回当前终态，不恢复。旧revision且尚未取消409。取消终态不能编辑/重开。
- `POST /circles/{id}/events/{eventId}/registration` `{intent:'join'|'waitlist'|'leave',clientId}` → `{ok:true,registration:EventRegistration|null}`。join只争取确认名额，满额409；waitlist愿意候补，空位时直接确认、满额时进入队尾。已registered/waitlisted重复参加意图不改顺序；leave取消本人的当前登记，可重复。每个成功操作保存event+user+clientId与intent，旧成功请求重放只回当前本人登记，不重新报名/取消后来的登记；复用ID不同intent409。失败不假成功，前端超时先刷新、手动同ID重试。join/waitlist须当前圈active成员、活动visible/published且未截止；leave允许在截止后、结束前取消，圈归档/暂停或失去身份后仅本人已有登记按已知ID清理，返回自身状态，不返回活动正文。没有本人历史且无圈访问权统一404。
- `GET /circles/{id}/events/{eventId}/attendees?status=all|registered|waitlisted|cancelled&limit&offset` → `{items:EventAttendee[],total}`。仅当前圈owner/admin；圈归档可读，暂停不可读；普通成员只通过myRegistration看到自己。顺序为登记顺序/稳定userID，waitlisted队列独立计算序位。无私密附言。
- `POST /circles/{id}/events/{eventId}/report` `{reason}` → 现有Report，201。本人当前可读目标，reason沿现有1–1000字；写入现有举报表targetType=circle-event，后台可审核结案。不接受任意目标ID或绕过成员资格。

报名与候补始终先锁活动行，在同一SERIALIZABLE事务验证成员/状态/截止/容量。名额释放或容量增加时，按先到先得顺序将有效候补自动递补到空位，仅限活动当前visible/published、圈active且未截止。失去圈成员身份、账号被禁用会在原操作同一事务取消其未结束活动登记，reason=membership/account；重新入圈/解禁不恢复旧报名。圈暂停/归档不批量抹掉成员已确认登记，也不自动候补递补；恢复圈或活动可见性时，在恢复事务中协调仍有效的候补，不恢复任何已取消登记，不能让新报名插队。截止后的释放不自动递补，以免临时替用户确认参加；候补仍如实显示已截止。活动取消释放所有登记并保留取消原因/历史。平台hidden不自动取消确认或候补，恢复也不重开报名窗口。

每圈最多20个尚未结束且未取消的活动（含hidden），在创建和改期时同事务校验，避免同步释放无界放大。数据库至少活动、本人登记、成功操作收据三表。SQL约束/触发器保护固定身份、创建幂等、revision递增、取消终态、单活动单用户唯一登记、确认数与容量一致；登记顺序由活动内序列产生。旧State持久化不能重写新域；成员/账号状态变化在事务末尾用窄域reconciliation释放登记，需验证两种快照交错及跨实例最后名额竞态。事件/登记/通知/审计全部同事务提交。死锁/serialization整体重试，未知提交保留clientId并提示刷新。

## 站内通知

扩展通知schema受控kind/outcome和target白名单，不改变既有14类语义：

| kind                      | category | outcome             | 受众                                                                                                        |
| ------------------------- | -------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| circle-event-update       | system   | updated / cancelled | 真实编辑或取消时，当时registered/waitlisted且当前active圈成员，排除操作者；同载荷不刷                       |
| circle-event-registration | system   | promoted            | 从候补实际递补的本人，排除由其本人操作直接取得名额；不为普通报名回执再发通知                                |
| circle-event-review       | system   | hidden / visible    | 平台实际改可见性→活动creator及当时registered/waitlisted当前active圈成员，去重且排除操作者；同状态改说明不刷 |

target新增 `{type:'circle-event',circleId,eventId}`，映射活动详情。读取时须当前成员+圈未暂停+活动可见；hidden只有当前圈管理能看到，取消可读。不可访问actor/context/target全null，system actor永远null。context当前活动title及地点/时间摘录，不存历史正文/圈名/审核说明。投影按本页引用IDs批量SQL，不能load普通State。失权导致释放的登记不额外制造可读私圈信息；已有通知在失权后动态脱敏。报名取消/事件取消等来源key以真实revision/登记变更为依据，不能反复重放刷通知。

## 独立平台治理

- `GET /admin/circle-events?q&circleId&lifecycle=published|cancelled&moderation=visible|hidden&limit&offset` → `{items:AdminCircleEvent[],total}`，仅staff。默认不限状态；q查ID/圈名/标题/创建者handle。返回聚合数但无名单、报名收据或联系方式。
- `PATCH /admin/circle-events/{eventId}` `{moderation:'visible'|'hidden',note,revision}` → AdminCircleEvent。note必填1–1000字，revision必填且旧值409，活动终态cancelled只读；恢复要求圈active，但已结束活动可恢复历史可见性，不重开报名。屏蔽可用于active/suspended/archived圈的未取消活动。实际变化revision+1并通知，同状态只改说明及审计（revision仍+1用于并发保护）。保留原登记；恢复时仅按上文规则递补仍有效且未截止的候补，不恢复已取消登记，不改变生命周期或原报名截止。
- 后台 `/circles/events` 在圈治理第三分区，支持筛选/分页、明确双状态、具体确认、必填说明、冲突刷新和审计入口。圈详情链接到此圈活动审核。普通端不显示内部note；平台页不请求报名名单。

## 前台与验收

新路由 `/circles/s/:circleId/events`、`/events/new`、`/events/:eventId`、`/events/:eventId/edit`、`/events/:eventId/attendees`。使用既有透明居中紧凑顶栏，不加宣传口号和白底悬浮外层。列表用「近期/我的/全部」，展示日期、标题、地点、名额/候补与本人状态；详情突出时间地点和介绍，报名/候补/取消由明确按钮和服务器回执驱动，不能本地加人数。候补按钮写明候补和自动递补；确认取消活动/取消报名明确后果。管理表单本地日期输入转换UTC，并展示时区；服务器时间决定状态。clientId在同意图手动重试时复用，修改意图或表单成功后的下一轮操作使用新ID。

利用CirclePage的账号/圈/路径代际与失权卸载；更换活动、筛选、账号、角色、会话和卸载后，旧读取/写入不能恢复私密内容，管理降权关闭确认。报名成功废止旧轮询，重新取服务器详情；403/404清私密业务树，409保留表单并提示刷新，不自动覆盖管理改动。名单独立分页，不塞入详情。loading/空态/失败重试、回退、窄屏长文安全区均需实现。

详情页的私密业务树外保留默认收起的本人登记清理入口。正常登录且持有已知圈/活动ID时，固定通用确认后仅发leave，不预取标题、地点或名单；只展示本人状态。它同样绑定账号/会话/活动代际，失权后不依靠旧正文恢复操作界面。

Go专项需真实PG：创建/旧回执失权、时间与revision、最后一个名额并发、候补顺序/释放/截止、旧成功请求重放不复活、成员退出/封禁/账号停用与SQL登记交错、取消终态、私圈跨圈IDOR/平台独立治理、通知回滚/动态脱敏、v7迁移旧数据/文件/Cookie及失败DDL回滚、无关域排他锁不挡活动路径。新空开发库保留明确示例活动/确认/候补，现有库不补种，真实HTTP脚本为示例账号生成可体验场景。前后台自动测试覆盖权限失效/迟到响应/确认/失败恢复/UTC转换，最终完整检查、离线备份与隔离恢复、重启持久性通过后提交Git。浏览器若仍禁用如实记录未做视觉验收。
