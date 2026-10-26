# 聊天图片、引用与撤回（v0.10 / schema10）

本阶段完善真实私聊、群组与广播频道：托管聊天图片、单层引用、作者撤回和旧消息变更同步。保留现有五个一级导航、手机单行输入/加号面板、紧凑透明页头与外围透明布局。不接入语音/视频通话、任意文件、表情商店或对方已读回执；原有个人已读水位继续有效。

## 权限与范围

- 新增 `scope:'conversation'` 和不可变 `conversationId`。只能通过目标会话上传路径创建，不得在world/circle/其它会话之间改作用域。每条最多9张JPEG/PNG，复用8MiB/8192单边/16MP重编码、元数据剥离、私有目录、并发准入、账号100图/100MiB与每小时30上传限制。owner+clientId跨全部scope唯一，跨作用域重用冲突。
- 上传和新发送要求正常账号、有效session与当前成员资格；广播频道还要求当前owner。接收者不需要好友关系，沿用现有会话成员规则。添加成员会开放此会话原有历史和可用图片。
- **conversation原图独立分支授权**：只允许当前会话成员读取ready、未删除图片；非上传者还需有效未撤回消息引用。本人未引用图片的预览也须仍为当前成员。owner/admin/moderator均不能绕过当前成员检查。blocked、deleted、失权统一404，GET/HEAD/Range/条件请求不绕过。world/circle既有规则不变。
- 正常账号可按已知messageId盲撤自己的消息，无时间限制，不要求仍为成员/频道主；不能借此读取原会话。未知与他人消息统一404，不能代撤。离群后的本人上传页可清理引用/原图，但不能预览conversation原图。
- 运营媒体列表仍可查看资产ID、上传者、scope、状态、说明和聚合计数；conversation资产的URL和conversationId清空，不返回消息ID、会话名、参与者、正文或引用，也不把这些加入后台q搜索、审计或概览。staff若本身是当前成员，普通聊天入口只按成员权限读取。

## DTO

`Message` 保留原ID/conversationId/sender/body/createdAt/seq/clientId，追加：

```ts
{
  status: 'sent' | 'retracted';
  revision: number;
  retractedAt: string | null;
  canRetract: boolean;
  images: {
    id: string;
    url: string | null;
    contentType: 'image/jpeg' | 'image/png';
    width: number; height: number; bytes: number;
    available: boolean;
  }[];
  replyTo: {
    id: string;
    revision: number;
    available: boolean;
    sender: PublicUser | null;
    body: string | null; // 最多200个Unicode字符，不递归展开引用
    imageCount: number;
  } | null;
}
```

正常消息至少有正文或图片，不能只有引用。retracted为不可逆墓碑：body为空、images为空、replyTo为null、canRetract为false，原ID/seq/clientId/createdAt及sender保留。引用只存源ID，必须同会话较早且创建时未撤回；源已撤回/不可访问时available=false、sender/body=null、imageCount=0，不返回源图片URL。图片blocked时只将该附件available=false/url=null，不清其它图片或文字；解除blocked可恢复尚未撤回消息的附件，不能恢复墓碑。

## 路由

| 方法与路径                                              | 输入/输出                                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/conversations/{id}/media/images`                 | multipart(file,clientId)；返回现有MediaAsset并带scope=conversation/conversationId，201或既有重试200                                                        |
| POST `/conversations/{id}/messages`                     | `{body,clientId?,imageIds?:string[],replyToId?:string}`；返回Message。rich消息要求clientId，原纯文本旧客户端继续兼容                                       |
| GET `/conversations/{id}/messages/{messageId}`          | 当前成员单条Message；未知/其它会话统一404                                                                                                                  |
| GET `/conversations/{id}/messages/by-client/{clientId}` | 只查当前成员本人发送的编号；返回Message，未找到404，不查他人clientId                                                                                       |
| POST `/conversations/{id}/messages/resolve`             | `{ids:string[]}`，最多200且去重；同一RR快照返回`{items:Message[],missingIds:string[],mutationVersion:number}`。missing只回显请求ID，不泄露是否属于其它会话 |
| DELETE `/me/messages/{messageId}`                       | 作者盲撤；返回`{ok:true,messageId}`，不含conversationId/正文/时间/版本。重复成功且不推进版本，离群作者不能借重复清理观察会话变化                           |

既有消息历史查询继续before/afterSeq/cursor/分页；MessagePage追加 `mutationVersion`。会话列表/详情追加mutationVersion，lastMessage使用同一动态投影。State管理写回执可省略原本optional的lastMessage，客户端随后权威GET刷新；不能返回缺少附件/引用/撤回状态的旧摘要。所有读取仍按当前身份、当前会话成员授权；账号切换保护和v9浏览器认证边界继续覆盖。

400为输入格式/空消息/过长/附件重复等；401失去身份；404不可见会话/源/消息；频道当前成员无发布权403；同编号不同载荷409。引用源在发送前撤回则新发送404；若先发送成功后源撤回，既有引用动态变不可用。幂等重放须先找到原消息，允许返回已经撤回的墓碑，不能因原图后来清理而重新发送。

## 幂等、撤回与数据库

新增一张 `gongming_message_media(message_id,media_id,position)`，保证媒体/顺序不重复、本人资产、相同会话与scope。messages增加nullable payload_hash/reply_to_id/retracted_at；conversations增加mutation_version默认0；media增加nullable conversation_id并更新三scope约束/不可变身份触发器。迁移不回填旧payload_hash、不UPDATE旧行，保留41张旧表全部原列及xmin、最早Cookie和17个文件；新关系表为空。

payload hash以规范化body、有序imageIds和replyToId生成，不保存原正文副本。旧纯文本行hash为空时兼容计算，首次撤回先固化hash再擦除正文。新发送校验本人、同会话、ready、未删除托管图；拒绝外链、其它域、绝对化本站URL和query/hash。撤回同事务清正文/本条replyTo/附件关系，保留seq/clientId/hash/时间，禁止恢复及物理DELETE。seq仍单调，墓碑不计未读，但已读水位可以跨过墓碑；最新消息被撤回时摘要保留其顺序位置并显示撤回占位。

发送/单条/resolve/撤回/引用/附件投影均使用窄SQL，不加载普通State。图片状态变更在来源事务协调会话版本和outbox。锁序遵循actor/session→conversation→message→按ID排序media→outbox；媒体治理在State回调结束后、persistNormalized前按ID排序锁受影响会话，持久化后再按会话推进版本和outbox，避免资产→会话反序。业务与引用、版本、outbox原子提交，失败回滚不推事件、不消耗成功编号。只做有限批量投影，不把全站附件/引用关系加载到State。

State写入不得覆盖新增SQL元数据或复活墓碑，数据库检查终态/身份。历史会话管理回执省略lastMessage时保留其余成员/owner/个人已读信息，前端取详情更新。旧迁移测试夹具按对应源版本写入并冻结原列投影，不依赖当前写入器假装旧schema。

## 变更补漏与客户端合并

mutation_version只在撤回、conversation附件媒体可用性实际变化时推进，普通新消息不推进；同状态只更新审核说明也不推进。限制到JS安全整数范围并给revision=V+1留余量。一次状态变化按会话推进一次，避免同图多引用放大outbox。所有Message与其replyTo的revision取当前读取事务的 `mutation_version+1`，是读投影版本，不是编辑次数。MessagePage/resolve/会话DTO中的mutationVersion与内容必须来自同一快照。

outbox增加 `message.retracted`（conversationId/messageId）和 `conversation.messages.invalidated`（仅conversationId，用于图片block/unblock）；发送前依旧检查当前成员。离群作者盲撤只得到HTTP最小回执。前台普通afterSeq轮询发现版本前进、WS失效/resync或重新可见时，按最多200个ID分块resolve已加载消息；平常继续轻量增量，不每次扫描历史。分块期间新到的旧history也须加入待resolve，不能首块完成就把全部视为已同步。missed ID立即清除缓存和查看器。

客户端维持每会话已见mutationVersion作为整页/全部DTO的下界；低于下界的旧history/send响应即使包含此前未知ID也不得直接加入，应将ID加入resolve。盲撤HTTP成功后以已知ID记录终态、清正文/图片/输入引用；不需要伪造服务器revision，稍后由授权resolve获取版本。合并按revision，墓碑永远压过sent；replyTo源的较高revision/已知撤回状态覆盖所有迟到父消息中的旧预览，即使源本身不在已加载窗口。维护已见版本/读generation，撤回、屏蔽、权限撤销后取消旧history/resolve/发送结果，不能仅依到达顺序覆盖。已失权后重新授权必须新代际，不恢复旧树。会话列表最后消息与输入引用栏也遵循相同终态/版本规则。

未知发送先按本人clientId查权威结果，再由用户选择同编号完整载荷重试；不能自动重发。pending确认按账号/会话/clientId，已撤回结果不再要求body相同。未知撤回先读取消息详情/本人引用确认，不能假定成功。引用源撤回时清空预览并提示取消引用后发送，保留其余正文/图片，避免静默改变发送意图。

## 上传恢复、清理与手机界面

`GET /me/media` 增加精确clientId/scope/conversationId筛选，仍只本人；可恢复响应未知的上传，不因连接失败重造请求编号。本人投影增加 `previewAvailable:boolean`、`worldReferenceCount:number`、`messageReferenceCount:number`、`messageReferences:{messageId:string}[]`（最多10条），不返回消息正文/参与者/会话名称；不可预览时不提供可用原图URL。可按已知ID撤回本人消息，成功后重取引用；逐批清理超过10条引用，不根据本地猜计数，不自动删除原图。

后台增加worldReferenceCount/messageReferenceCount聚合计数，必须显式区分world/circle/message引用；publishedReferenceCount仍只世界公开引用。不得用总数减circle数推导世界数。作者撤回不写包含消息/会话ID的全局运营审计，以墓碑和私有outbox保持终态。后台绝不返回messageReferences；conversationId/URL抹空，且q只检索允许的媒体ID/上传者等原字段。媒体审核通知继续只指向本人上传，不携带会话关系。引用仍存在则三域原图都不能删除，解除blocked不恢复已撤回关系。

单行输入左侧加号展开图片/本人上传入口，引用与缩略图置于输入上方，纳入footer ResizeObserver/软键盘安全区。仅所有图片上传完成后可发送，逐张上传和发送/撤回同步单飞；照片移出草稿只取消请求/移除本地预览，不DELETE服务器资产。图片File/ObjectURL/引用快照/富消息pending只在账号+会话+认证代际内存保存；不混入旧localStorage纯文本草稿或个人备份。正文和纯文本pending保留原有兼容。

上传取消/超时/2xx损坏/5xx都可能已提交，先本人clientId查询确认，确认前锁住相关重试。账号/会话切换或卸载废弃晚结果；服务端未知COMMIT候选文件仍保留原安全策略。图片全屏查看器按messageId/mediaId读取当前状态；源撤回、媒体不可用、失权、missing或切账号立即关闭并释放ObjectURL。图片预留宽高比例，历史锚点、加号面板和已读观察互不遮挡；不会声称撤回能删除接收者已另存副本。

## 验收

隔离PG/race覆盖最后权限重验、移除/频道转交、引用与撤回、同clientId重放与擦除、源不可用/墓碑、图片block/unblock、三域引用/额度/删除约束、失权本人盲清理、State旧快照/回滚/outbox、后台DTO/q/审计隐私、旧41表源列+xmin/Cookie/17文件与DDL失败回滚。窄域测试在无关数据表排他锁下验证消息读取/发送/resolve等仍可完成。

前台覆盖迟到history/send不复活、超过200分块/期间新旧页、WS重连/缺失、引用源不在窗口、仅图片/图片+文、未知上传/发送/撤回、同编号同载荷、移除草稿不删图、权限/账号/会话/卸载隔离、全屏打开后撤回，以及手机加号/锚点/已读边界。后台与MyUploads验证私图无预览、只本人盲清理、计数真实与失败恢复。

运行库先停写完整备份/隔离恢复，再迁移比对；真实HTTP/WS跨账号、媒体上传/读取与清理、恢复/重启、全工程检查与依赖扫描通过后更新Git。保留可体验的文字+图片、引用和撤回示例，明确开发数据。浏览器控制禁用时记录扩展/真机视觉未验证，不把测试通过当作视觉通过。
