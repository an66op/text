# Schema 10：聊天图片、引用与作者撤回

API 为 `0.10.0`。迁移由 `migrateMessageMedia` 在现有迁移事务中执行，使用版本标记实现幂等；任何 DDL、约束或后续迁移错误都会回滚。运行升级前需停写并完成数据库与私有媒体目录的一致备份。

新增权威关系表 `gongming_message_media(message_id, media_id, position)`，位置为 0–8，消息内图片与位置分别唯一。消息增加 nullable `payload_hash/reply_to_id/retracted_at`；会话增加 fast-default `mutation_version=0`；资产增加 nullable `conversation_id` 并更新 world/circle/conversation 三域约束。迁移不 UPDATE 或回填旧消息、会话、资产行，不回填附件关系；旧列与行 xmin 保持。旧纯文本 hash 在重放时兼容计算，首次撤回时固化。

数据库触发器保护消息身份、永久墓碑、有序图片关系、同账号/会话/作用域与非空内容。物理删除消息被拒绝；已接受消息不能追加、改序或移除附件，只有消息先转为墓碑的同一事务可以移除关系。新附件仅能关联当前事务新建消息，比较当前事务 ID 的低 32 位与 xmin，适应 xid epoch。消息无变化 UPDATE 返回 NULL，避免用无变化写入伪造新建身份。旧消息的 seq/clientId/创建时间与 payload hash 始终保留，撤回不保存正文副本。

历史、详情、本人 clientId 查询、最多 200 ID 的 resolve、发送与盲撤均使用按会话 SQL；图片和单层引用按结果 ID 批量投影，读取事务采用 REPEATABLE READ，写入采用可重试 SERIALIZABLE。普通 State 只加载撤回时间与会话版本，不加载附件关系、引用或 hash；State writer 拒绝修改既有消息，并保留 SQL 专有列。会话管理写回执省略可选 lastMessage，由客户端重新 GET 权威详情。

写入锁序为账号/session → 会话 → 消息 → 排序资产 → outbox。发送与撤回串行化各自会话；媒体治理在 State 回调后、写资产前按 ID 锁相关会话，持久化后每会话只推进一次 mutation_version 并追加无正文失效事件。全局 outbox counter 仍是短事务共享串行点。任何后续错误使正文擦除、关系释放、版本、事件或治理状态整体回滚；未提交事件不会推送。

conversation 原图读取须当前 active 账号与会话成员资格，未引用图仅上传者本人可预览；其它成员须存在未撤回引用。staff 身份不授予私图阅读权。后台只返回聚合计数，URL/conversationId 脱敏且无 messageReferences；本人上传页保留最多十个本人 messageId 用于离群后盲撤。资产软删受世界、圈子、聊天三域引用约束，删除审计仅含资产 ID。撤回回执只有 `{ok:true,messageId}`，不向离群作者返回会话版本、时间或 ID，也不写含私聊定位符的全局审计。

图片沿用本机私有目录重编码与额度，不是对象存储或端到端加密。未知提交结果继续保留不可直接读取的候选文件供离线核对；本阶段不实现在线 GC。列表分页最多 100、resolve 最多 200，单条消息最多九图；未进行生产容量或高并发验收，State 兼容路径仍有全域快照开销。
