# Schema 11：私人联系策略与有向黑名单

API `0.11.0`，能力为 `contact-privacy`、`private-blocklist`、`contact-write-guards`、`permission-aware-discovery`。

迁移只新增 `gongming_contact_preferences` 和 `gongming_user_blocks` 两张私有表，不回填账户、不导入本机偏好/黑名单。前者按 user_id 存四项入站/查找设置、本人 CAS revision/updated_at 与独立内部 guard_version；后者以 owner_id/target_id 为主键、禁止自拉黑，具有本人分页与反向查询索引。数据库检查策略枚举、JS 安全 revision、不可变 block 身份、每人 500 条额度及 blocked pair 不得存在 pending 好友申请。accepted 好友关系不因 block 删除。

为支持零会话账号的定向通用刷新，既有 outbox.conversation_id 改为 nullable；严格 CHECK 要求 `contact.resync` 的 conversation_id/message_id 为 NULL 且 recipient_id 非空，其余事件仍必须有 conversation_id。所有读适配 NULL，wire 只输出 `resync` 与 eventId，不携带目标、原因或关系 ID。该 metadata ALTER 不重写旧行；42 张旧表全部源列/xmin、文件和旧 Cookie 保持。DDL 与版本标记位于同一迁移事务，失败完整回滚、重跑幂等。

GET 不建默认行，无行返回 everyone/everyone/true/true、revision0、updatedAt:null。依赖联系权限的写入才惰性建立默认 guard。私有实际变更才增加本人 revision；内部好友与账号状态变更只更新 guard_version。私有写先锁 guards/CAS，旧 revision 即使期望值相同也返回 privacy_conflict；当前 revision 的 noop 不增加版本/时间，也不重复取消申请或发刷新事件。

锁序为 actor/session → 按 userId 排序的 contact guards → conversation → message → 排序 media → outbox。正常联系操作持共享 guard，策略/block/好友/账号变更持排他 guard 并实际更新版本，确保旧 SERIALIZABLE 快照重试。State 适配层只保留 transient checks/results，按业务 diff 在 persist 前执行 SQL 护栏；不加载或写回私人表。窄 SQL 发送/上传复用同一护栏，提交前重验。已提交同编号消息/上传及既有 direct 复用属于结果确认，沿用会员/频道主授权后先确认，不受新联系副作用限制。

拉黑同事务取消双向 pending，不删除 accepted 好友、会话成员、历史或媒体；解除不恢复申请。已有 direct 的收件人停用也仅使新发送/上传返回 contact_restricted，而不使会话历史失权；新建会话/好友/邀请保留原 inactive 输入规则。用户仍可读当前成员历史、原图、已读和本人盲撤/作者清理。群/频道既有成员互动独立，新成员仅检查实际邀请者→新增目标，批次失败完整回滚。目录/资料按查找设置及当前真实好友例外投影；好友通知在双向 block 时动态脱敏而不删除事件证据。运营接口不增加私人设置、名单、关系计数或审计数据。

依旧使用本机 PostgreSQL 与既有 outbox 计数器，不是生产容量验收；部分会话/好友/账号写入仍经 State 快照。公开内容受众、对方已读、通知静音和联系人邀请工作流不在本阶段范围。私有操作没有代用户操作或平台反向名单入口。
