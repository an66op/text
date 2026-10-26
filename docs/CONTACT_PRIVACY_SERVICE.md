# 私人联系准入与黑名单（v0.11 / schema11）

本阶段把登录账号的隐私与黑名单接入真实服务，完善设置、成员资料、聊天信息、联系人与聊天写权限。保留五个主导航、紧凑透明页头、单行加号输入和外围透明布局。访客的本机演示仍独立，真实账号加载/失败不降级为演示，不自动导入旧本地设置或黑名单。

## 产品规则

- `directMessagePolicy` 与 `groupInvitePolicy` 各自为 `everyone|friends|nobody`，分别控制**别人发给我的新私信/私聊图片**和**别人将我加入群组/广播频道**。两者独立，均默认everyone。只校验收件人的入站policy；自己更严格的入站设置不阻止主动联系，但发送仍须符合对方设置。真实互为好友才满足friends，已有direct/同群/同圈不算好友。
- `allowFriendRequests:boolean` 独立控制新好友申请，默认true。系统始终双向确认，不把关闭验证解释为自动成为好友。关闭后已有pending仍可本人明确接受/拒绝；接受必须再查双方block。
- `discoverableByHandle:boolean` 默认true。关闭后不出现在陌生人的 `/directory` 或 `/users/{handle}` 查询；自己与现有真实好友仍可查询。公开世界/圈子/历史会话中的既有PublicUser投影沿用原权限，这个开关不承诺隐藏公开内容、历史参与者或已知ID。
- block为本人私有有向记录；**任一方向存在**则双方禁止新私聊发送/私聊上传、新好友申请/接受、邀请对方成为群组或频道的新成员。所有platform角色按相同规则。
- 拉黑保留已经accepted的好友关系，移除好友仍是独立动作；同事务将双方pending申请转cancelled，不向对方发送“被拉黑”通知。解除只删除本人block，不能恢复已取消申请或已独立删除的好友。旧accepted回执只返已有终态，不能重建关系。
- group/channel的既有成员发言、引用、图片和owner转交沿用现有权限；新增成员只检查**本次实际邀请者→新增目标**，不扫描全体成员间block。已在群的成员noop不重验邀请，批次任一新增目标失败则全部回滚。第三人可以将互相拉黑者加入共同空间（各自须允许该邀请者），界面明确共同空间独立。圈子自主加入/邀请兑换、世界/圈子公开互动与系统治理通知不改变。
- current-member历史、列表/详情/by-client/resolve/原图与已读继续可读；本人已知ID盲撤、MyUploads和world/circle作者清理继续允许。拉黑不移除会话成员，不清历史，不复活墓碑。策略门控仅针对新副作用：相同clientId/hash已提交消息/上传先返回当前对象/墓碑；既有direct创建复用可返回历史会话。原channel-owner/member权限仍先执行，不借旧编号绕过离群/频道转交。

## 私有 DTO 与接口

所有路由 `/api/v1`，要求有效active账号/session，沿用v9 browser context及预期账号边界；写入校验Origin。

```ts
type ContactPrivacy = {
  directMessagePolicy: 'everyone' | 'friends' | 'nobody';
  groupInvitePolicy: 'everyone' | 'friends' | 'nobody';
  allowFriendRequests: boolean;
  discoverableByHandle: boolean;
  revision: number; // 仅本人策略/block的CAS版本，不暴露内部guard version
  updatedAt: string | null;
};
type BlockEntry = {
  userId: string;
  user: PublicUser | null;
  available: boolean;
  createdAt: string;
};
type ContactCapabilities = {
  userId: string;
  blockedByMe: boolean;
  canMessage: boolean;
  canRequestFriend: boolean;
  canInvite: boolean;
  revision: number; // 当前请求者本人的配置版本，用于本人拉黑操作
};
```

| 路由                                 | 输入/输出                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET `/me/contact-privacy`            | ContactPrivacy；无行返回虚拟默认/revision0/updatedAt null，GET不写默认行                                                             |
| PUT `/me/contact-privacy`            | 完整四个策略字段+revision（字段必填），返回ContactPrivacy                                                                            |
| GET `/me/blocks`                     | q/userId精确筛选/limit/offset，RR快照 `{items:BlockEntry[],total,revision,updatedAt}`，默认20最多100；inactive target仅ID+不可用占位 |
| PUT `/me/blocks/{userId}`            | `{revision}`；新增或确认本人block，active新target/非本人/最多500；旧block即使target停用也可确认                                      |
| DELETE `/me/blocks/{userId}`         | `{revision}`；解除本人block，允许target停用/未知无记录，不泄露target是否存在                                                         |
| GET `/contact-capabilities/{userId}` | 当前请求者对目标的四项能力与本人revision；正常已知target，未知/停用404，自身四项能力false且blockedByMe=false                         |

block写回执严格 `{ok:true,userId,blocked:boolean,revision,updatedAt}`。所有私有写先CAS再比较目标值，旧revision一律409 `privacy_conflict`；同revision同值noop不推进版本/时间、不重复取消/通知/outbox。实际策略或block变更才推进本人revision；内部好友/账号变更护栏不推进用户可见revision。revision保留JS安全整数空间，达到上限受控409。

普通联系拒绝统一403 `contact_restricted`，固定中文“当前联系权限不允许此操作”，不返回是拉黑、对方哪项设置或哪个邀请目标失败。会话历史权限仍采用既有401/404，不能把联系写限制当作丢失成员。新直接会话/好友/邀请创建必须在提交事务执行门控；inactive/不存在成员按原输入/不存在规则，不借此泄露私有字段。capabilities只给布尔能力，不给blockedByThem、对方原始policy、反向名单或计数。

既有direct中的peer停用时，当前成员仍保留历史阅读，新发送/上传返回同一contact_restricted403，避免把对方停用误当作自己失去成员。新建会话/申请/邀请的停用对象仍沿用原输入规则；本人离群或失去会话读取权继续404。

## 持久化与提交边界

schema11新增两张表：稀疏 `gongming_contact_preferences` 和有向 `gongming_user_blocks`。preferences分别保存四策略、本人CAS revision/updatedAt，以及**不出DTO**的内部guard_version。block主键owner+target、禁止自拉黑、identity不可变，添加反向与本人分页索引。迁移不回填账户默认行、不导入本地演示或profile-preferences JSON；保留42张旧数据表所有源列+xmin、23文件及最早Cookie，新两表初始为空。普通State不加载/写回私有表。

既有outbox的conversation_id允许NULL，仅内部 `contact.resync` 可使用该形态，且必须有recipient、message为空；其余类型仍要求conversation。此DDL不重写旧事件。账号没有任何会话时也能获得本人策略刷新，wire始终只含resync/eventId。

所有影响联系的写入惰性建立需要的默认guard行；读取不建立。统一 actor/session→按userId排序的contact guards→conversation→message→排序media→outbox。普通发送/邀请/申请等持guard共享锁；策略/block、好友新增/删除/账号状态变更更新相应guard。guard实际变化使等待中的旧SERIALIZABLE快照重试，不能只拿advisory锁后继续用旧快照。懒建行也受唯一约束与完整事务重试，避免不存在block/preferences行的竞争。

State创建/管理会话、好友、账号路径通过transient checks/diff hook，在persist前调用相同窄SQL护栏并协调guard更新；窄SQL send/upload直接调用。State管理回执可省略optional lastMessage，并刷新权威GET。接受申请、拉黑取消pending、原业务/outbox/通知同事务；后续失败整体回滚。禁止旧State快照覆盖新私有策略或复活cancelled申请。发送/上传至少最终提交前重验；反向拉黑、设置、移除好友、账号停用与发送/邀请的交错必须两实例测试。

Conversation列表/详情/管理回执增加当前viewer的 `canSend:boolean`（发送和上传共同能力），含channel-owner与contact门控，字段来自同一快照，历史不会因此不可读。批量有限投影，不把所有block/偏好/私聊历史装进State。目录/资料读取对discoverable执行当前身份规则，既有admin用户管理仍只有原User字段。

## 刷新与隐私

- 私有策略/黑名单只本人可读改，无运营入口、反向查询、逐用户计数或管理员代改。`User/PublicUser`、admin users/overview/audit/q都不追加四策略、block关系或对方ID。本人操作不写含策略/关系的全局审计；它们以私有表/CAS作为权威。不发block通知。
- 使用原私有outbox通用resync，wire无会话ID/目标/原因：本人策略更新给本人，block增删给双方，用于刷新能力；不改变既有会话内容mutationVersion。好友申请/决定通知在双方block时动态将actor/context/target清空，历史eventKey仍保留。共同空间互动和治理通知沿用既有规则。
- UI区分readAllowed与canSend。`contact_restricted`只撤销写能力、取消上传/富pending/File/ObjectURL/引用/确认框；允许的历史与只读未知结果查询保留。轮询/WS/focus权威刷新canSend，不能由迟到管理/列表/发送回执恢复已被观察的限制。恢复写能力须新权威读取。A→B→A及认证代际切换清私有缓存/对话框/请求。
- 设置全量保存、拉黑和解除单飞、明确目标确认。成功写废止旧GET；409保留草稿并提示刷新。取消/超时/5xx/损坏2xx属于结果未知，先GET私有状态（blocks精确userId返回同快照revision）确认；未确认前锁住相反写操作，不自动重发。跨页面/关闭重开不能绕过未知状态；只在同账号认证代际内存中保存。
  如果确认GET仍为旧revision且目标值未达，不能据此断言原请求不会稍后提交；只允许人工同意图、同CAS重试，继续锁住相反写。读取已达到目标值或更高revision才结束未知状态。
- 原 `/settings/privacy`、`/settings/blocked` 登录后进入真实模块；checking/unavailable显式展示，访客才原本机演示。资料页与direct聊天信息提供同一个本人block/解除组件；陌生成员筛选器仍由服务端最终授权，不静默跳过失败成员。
- 不把真实策略、block和能力放入localStorage或六域个人备份；旧profile-preferences任意JSON永远不是策略来源。About本地导出改显式本机key白名单，恢复默认也只影响明确本机演示；安全页登录设备入口描述切真实身份，不再显示演示设备数量。

## 验收与演进

隔离PG/race验证双向block、三档两策略、真实好友例外、discoverable目录/资料、批次邀请原子、接受/取消与旧回执不复活、guard缺行和两实例并发、最终上传重验、只读确认/历史原图/作者清理、通知脱敏与全局运营/备份零泄露、CAS/未知写、失败outbox回滚、旧42表/xmin/Cookie/23文件与DDL回滚。前台验证账号/认证/目标切换、迟到GET/管理回执、未知block后相反动作、只能读的聊天仍可查旧结果、取消富草稿不丢历史、小屏确认与透明布局。

本轮后台仅增加版本与四能力中文标签：`contact-privacy`、`private-blocklist`、`contact-write-guards`、`permission-aware-discovery`。API0.11.0/schema11。真实HTTP/WS跨账号、全工程检查、停写完整备份/隔离恢复/重启通过后更新Git。成员示例保留明确的联系限制/解除可体验对象，不把仅本机开关称作服务器授权。公开内容受众、对方已读、通知静音与生产负载容量仍独立实施；本阶段不据此宣称综合产品完成。
